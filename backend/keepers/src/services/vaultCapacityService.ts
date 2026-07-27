/**
 * Vault Capacity Service
 * Models vault capacity and soft deposit limits
 * Includes trend smoothing and outlier rejection for noisy capacity signals
 */

export interface CapacityInputs {
    tvl: bigint; // Total Value Locked in stroops
    liquidityDepth: bigint; // Available liquidity in stroops
    maxDepositSize: bigint; // Maximum single deposit in stroops
    softCapacity: bigint; // Soft capacity threshold in stroops
}

export interface CapacitySample {
    timestamp: number;
    utilization: number;
    isOutlier: boolean;
    rawValue: true; // Always true - signals this is preserved raw
}

export interface CapacityStatus {
    vaultId: string;
    currentUtilization: number; // 0-100 percentage (smoothed)
    smoothedUtilization: number; // 0-100 percentage (after filtering)
    isNearCapacity: boolean; // > 80% utilization
    isAtCapacity: boolean; // >= 100% utilization
    availableCapacity: bigint;
    recommendedMaxDeposit: bigint;
    status: 'normal' | 'near_capacity' | 'over_capacity';
    warnings: string[];
    recentSamples: CapacitySample[]; // Raw samples for audit trail
}

export interface DepositLimitWarning {
    vaultId: string;
    depositAmount: bigint;
    wouldExceedCapacity: boolean;
    wouldCauseNearCapacity: boolean;
    estimatedUtilizationAfter: number;
    message: string;
}

const NEAR_CAPACITY_THRESHOLD = 0.8; // 80%
const CAPACITY_THRESHOLD = 1.0; // 100%
const SMOOTHING_WINDOW_SIZE = 5; // Rolling window for EMA
const OUTLIER_THRESHOLD_STDDEV = 2.0; // Standard deviations for outlier detection

// Per-vault sample history for trend analysis
const vaultSamples = new Map<string, CapacitySample[]>();

/**
 * Calculate exponential moving average for trend smoothing
 */
function calculateEMA(values: number[], window: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    const k = 2 / (window + 1);
    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }

    return ema;
}

/**
 * Detect outliers using interquartile range method
 */
function isOutlier(value: number, samples: number[]): boolean {
    if (samples.length < 3) return false;

    const sorted = [...samples].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return value < lowerBound || value > upperBound;
}

/**
 * Record a capacity sample for trend analysis
 */
export function recordCapacitySample(vaultId: string, utilization: number): void {
    if (!vaultSamples.has(vaultId)) {
        vaultSamples.set(vaultId, []);
    }

    const samples = vaultSamples.get(vaultId)!;
    const recentValues = samples.slice(-10).map(s => s.utilization);
    const outlierFlag = isOutlier(utilization, recentValues);

    samples.push({
        timestamp: Date.now(),
        utilization,
        isOutlier: outlierFlag,
        rawValue: true,
    });

    // Keep only recent samples (last 100)
    if (samples.length > 100) {
        samples.shift();
    }
}

/**
 * Get smoothed utilization for a vault
 */
export function getSmoothedUtilization(vaultId: string): number {
    const samples = vaultSamples.get(vaultId);
    if (!samples || samples.length === 0) return 0;

    // Filter out outliers from recent window
    const recentWindow = samples.slice(-SMOOTHING_WINDOW_SIZE);
    const nonOutlierValues = recentWindow
        .filter(s => !s.isOutlier)
        .map(s => s.utilization);

    if (nonOutlierValues.length === 0) {
        // All recent samples are outliers, use oldest non-outlier
        const nonOutliers = samples.filter(s => !s.isOutlier);
        if (nonOutliers.length === 0) return samples[samples.length - 1].utilization;
        return nonOutliers[nonOutliers.length - 1].utilization;
    }

    return calculateEMA(nonOutlierValues, SMOOTHING_WINDOW_SIZE);
}

/**
 * Get recent samples for audit trail
 */
export function getRecentSamples(vaultId: string, count: number = 10): CapacitySample[] {
    const samples = vaultSamples.get(vaultId) || [];
    return samples.slice(-count);
}

/**
 * Calculate vault capacity status
 */
export function calculateCapacityStatus(
    vaultId: string,
    inputs: CapacityInputs,
): CapacityStatus {
    const currentUtilization = inputs.softCapacity > 0n
        ? Number(inputs.tvl * BigInt(100)) / Number(inputs.softCapacity)
        : 0;

    // Record the sample for trend analysis
    recordCapacitySample(vaultId, currentUtilization);

    // Get smoothed utilization for decision-making
    const smoothedUtilization = getSmoothedUtilization(vaultId);

    const isNearCapacity = smoothedUtilization >= NEAR_CAPACITY_THRESHOLD * 100;
    const isAtCapacity = smoothedUtilization >= CAPACITY_THRESHOLD * 100;

    const availableCapacity = inputs.softCapacity > inputs.tvl
        ? inputs.softCapacity - inputs.tvl
        : 0n;

    const recommendedMaxDeposit = calculateRecommendedMaxDeposit(
        inputs,
        smoothedUtilization,
    );

    const warnings: string[] = [];

    if (isAtCapacity) {
        warnings.push('Vault is at or exceeding soft capacity');
    } else if (isNearCapacity) {
        warnings.push('Vault is approaching capacity');
    }

    if (inputs.liquidityDepth < inputs.tvl * BigInt(10)) {
        warnings.push('Liquidity depth is low relative to TVL');
    }

    return {
        vaultId,
        currentUtilization: Math.min(currentUtilization, 200), // Cap at 200% for display
        smoothedUtilization: Math.min(smoothedUtilization, 200), // Smoothed value
        isNearCapacity,
        isAtCapacity,
        availableCapacity,
        recommendedMaxDeposit,
        status: isAtCapacity ? 'over_capacity' : isNearCapacity ? 'near_capacity' : 'normal',
        warnings,
        recentSamples: getRecentSamples(vaultId, 10),
    };
}

/**
 * Calculate recommended maximum deposit based on capacity
 */
function calculateRecommendedMaxDeposit(
    inputs: CapacityInputs,
    currentUtilization: number,
): bigint {
    // If over capacity, recommend 0
    if (currentUtilization >= CAPACITY_THRESHOLD * 100) {
        return 0n;
    }

    // If near capacity, recommend small deposits
    if (currentUtilization >= NEAR_CAPACITY_THRESHOLD * 100) {
        const availableCapacity = inputs.softCapacity > inputs.tvl
            ? inputs.softCapacity - inputs.tvl
            : 0n;
        // Recommend 10% of available capacity
        return availableCapacity / BigInt(10);
    }

    // Otherwise, recommend up to max deposit size or 50% of available capacity
    const availableCapacity = inputs.softCapacity > inputs.tvl
        ? inputs.softCapacity - inputs.tvl
        : 0n;

    const maxRecommended = availableCapacity / BigInt(2);
    return maxRecommended < inputs.maxDepositSize
        ? maxRecommended
        : inputs.maxDepositSize;
}

/**
 * Check if a deposit would violate capacity limits
 */
export function checkDepositAgainstCapacity(
    vaultId: string,
    depositAmount: bigint,
    inputs: CapacityInputs,
): DepositLimitWarning {
    const newTvl = inputs.tvl + depositAmount;
    const newUtilization = inputs.softCapacity > 0n
        ? Number(newTvl * BigInt(100)) / Number(inputs.softCapacity)
        : 0;

    const wouldExceedCapacity = newUtilization > CAPACITY_THRESHOLD * 100;
    const wouldCauseNearCapacity = newUtilization >= NEAR_CAPACITY_THRESHOLD * 100;

    let message = '';

    if (wouldExceedCapacity) {
        message = `Deposit of ${depositAmount} stroops would exceed vault capacity. Current utilization: ${newUtilization.toFixed(1)}%`;
    } else if (wouldCauseNearCapacity) {
        message = `Deposit of ${depositAmount} stroops would bring vault near capacity. Utilization would be ${newUtilization.toFixed(1)}%`;
    }

    return {
        vaultId,
        depositAmount,
        wouldExceedCapacity,
        wouldCauseNearCapacity,
        estimatedUtilizationAfter: newUtilization,
        message,
    };
}

/**
 * Get capacity status for multiple vaults
 */
export function getMultiVaultCapacityStatus(
    vaults: Array<{ vaultId: string; inputs: CapacityInputs }>,
): CapacityStatus[] {
    return vaults.map(({ vaultId, inputs }) =>
        calculateCapacityStatus(vaultId, inputs),
    );
}

/**
 * Filter vaults by capacity status
 */
export function filterVaultsByStatus(
    vaults: CapacityStatus[],
    status: 'normal' | 'near_capacity' | 'over_capacity',
): CapacityStatus[] {
    return vaults.filter(v => v.status === status);
}
