/**
 * Centralized risk level configuration and explanations.
 * Used across dashboard and AI advisor components for consistent messaging.
 */

export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface RiskLevelConfig {
    color: string;
    bg: string;
    border: string;
    order: number;
    explanation: string;
}

export const RISK_EXPLANATIONS: Record<RiskLevel, RiskLevelConfig> = {
    Low: {
        color: 'text-green-400',
        bg: 'bg-green-500/15',
        border: 'border-green-500/30',
        order: 1,
        explanation: 'High TVL, battle-tested protocol, highly liquid.',
    },
    Medium: {
        color: 'text-yellow-400',
        bg: 'bg-yellow-500/15',
        border: 'border-yellow-500/30',
        order: 2,
        explanation: 'Moderate volatility or newer protocol with steady growth.',
    },
    High: {
        color: 'text-red-400',
        bg: 'bg-red-500/15',
        border: 'border-red-500/30',
        order: 3,
        explanation: 'Low TVL, highly volatile assets, or experimental protocol.',
    },
};

export function getRiskConfig(level: RiskLevel): RiskLevelConfig {
    return RISK_EXPLANATIONS[level];
}

export function getRiskExplanation(level: RiskLevel): string {
    return RISK_EXPLANATIONS[level].explanation;
}

/**
 * Oracle metadata types and configurations.
 */

export type OracleSource = 'fresh' | 'twap_fallback' | 'unavailable';

export interface OracleMetadata {
    source: OracleSource;
    ageSeconds: number | null;
    confidence: number; // 0-100
    sampleCount?: number;
}

export interface OracleStatusConfig {
    badge: string;
    color: string;
    bg: string;
    explanation: string;
}

export const ORACLE_STATUS_CONFIG: Record<OracleSource, OracleStatusConfig> = {
    fresh: {
        badge: '✓ Fresh Data',
        color: 'text-green-400',
        bg: 'bg-green-500/15',
        explanation: 'Real-time oracle data available.',
    },
    twap_fallback: {
        badge: '⚠ TWAP Fallback',
        color: 'text-yellow-400',
        bg: 'bg-yellow-500/15',
        explanation: 'Using time-weighted average price due to stale oracle data.',
    },
    unavailable: {
        badge: '✗ No Data',
        color: 'text-red-400',
        bg: 'bg-red-500/15',
        explanation: 'Oracle data unavailable. Operations may be restricted.',
    },
};

/**
 * Get oracle status configuration based on metadata.
 */
export function getOracleStatusConfig(metadata: OracleMetadata): OracleStatusConfig {
    return ORACLE_STATUS_CONFIG[metadata.source];
}

/**
 * Get confidence level badge color based on confidence score.
 */
export function getConfidenceBadgeColor(confidence: number): string {
    if (confidence >= 80) return 'text-green-400';
    if (confidence >= 60) return 'text-yellow-400';
    return 'text-red-400';
}

/**
 * Check if operations should be blocked based on oracle confidence.
 */
export function shouldBlockOperation(
    confidence: number,
    operationType: 'deposit' | 'withdraw' | 'rebalance' | 'liquidation'
): boolean {
    const minThresholds = {
        deposit: 60,
        withdraw: 60,
        rebalance: 75,
        liquidation: 85,
    };

    return confidence < minThresholds[operationType];
}

/**
 * Format oracle age for display.
 */
export function formatOracleAge(ageSeconds: number | null): string {
    if (ageSeconds === null) return 'Unknown';
    if (ageSeconds < 60) return `${ageSeconds}s`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
    return `${Math.floor(ageSeconds / 3600)}h`;
}

// ── Evidence-backed risk ─────────────────────────────────────────────────────

export type EvidenceSeverity = 'info' | 'warning' | 'critical';

/** A single piece of evidence contributing to a vault's risk assessment. */
export interface RiskEvidence {
    source: string;          // e.g. "DeFiLlama TVL", "oracle:bandprotocol"
    metric: string;          // human-readable metric name
    value: string;           // formatted current value, e.g. "$1.2M" or "8.4%"
    severity: EvidenceSeverity;
    /** ISO-8601 timestamp when this evidence was collected. */
    collectedAt: string;
    /** Age in seconds at the time of evaluation. Stale evidence lowers confidence. */
    ageSeconds: number;
    vaultId?: string;
    protocolId?: string;
}

export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface EvidenceBasedRiskLevel {
    level: RiskLevel;
    confidence: EvidenceConfidence;
    explanation: string;
    evidenceCount: number;
    staleSources: string[];
}

/** Evidence older than this threshold degrades confidence. */
const STALE_THRESHOLD_SECONDS = 3600; // 1 hour

/**
 * Derive a risk level and confidence from a set of evidence items.
 *
 * - No evidence → unknown confidence, fallback level.
 * - Any stale evidence → confidence degraded to 'low'.
 * - Any critical evidence → High risk.
 * - Any warning evidence → at least Medium risk.
 * - All info → Low risk.
 */
export function computeEvidenceBasedRisk(
    evidence: RiskEvidence[],
    fallbackLevel: RiskLevel = 'Medium',
): EvidenceBasedRiskLevel {
    if (evidence.length === 0) {
        return {
            level: fallbackLevel,
            confidence: 'unknown',
            explanation: 'No supporting evidence available. Risk level is a default estimate.',
            evidenceCount: 0,
            staleSources: [],
        };
    }

    const staleSources = evidence
        .filter((e) => e.ageSeconds > STALE_THRESHOLD_SECONDS)
        .map((e) => e.source);

    const hasCritical = evidence.some((e) => e.severity === 'critical');
    const hasWarning  = evidence.some((e) => e.severity === 'warning');

    const level: RiskLevel = hasCritical ? 'High' : hasWarning ? 'Medium' : 'Low';

    let confidence: EvidenceConfidence;
    if (staleSources.length === 0) {
        confidence = 'high';
    } else if (staleSources.length < evidence.length) {
        confidence = 'medium';
    } else {
        confidence = 'low';
    }

    const worstEvidence = evidence.find(
        (e) => e.severity === (hasCritical ? 'critical' : hasWarning ? 'warning' : 'info')
    );

    const explanation = worstEvidence
        ? `${worstEvidence.source}: ${worstEvidence.metric} is ${worstEvidence.value}.`
        : RISK_EXPLANATIONS[level].explanation;

    return { level, confidence, explanation, evidenceCount: evidence.length, staleSources };
}
