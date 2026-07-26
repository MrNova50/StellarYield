import { PrismaClient } from '@prisma/client';

export type RiskPreference = 'conservative' | 'balanced' | 'aggressive';

export interface UserRiskProfile {
  userId: string;
  statedPreference: RiskPreference;
  maxConcentrationPct: number;
  maxVolatilityPct: number;
  minLiquidityUsd: number;
}

export interface PortfolioBehavior {
  currentConcentrationPct: number;
  currentVolatilityPct: number;
  currentLiquidityUsd: number;
  positions: Array<{
    protocol: string;
    weightPct: number;
    volatilityPct: number;
    liquidityUsd: number;
  }>;
}

export interface DriftDimension {
  dimension: 'concentration' | 'volatility' | 'liquidity';
  actualValue: number;
  thresholdValue: number;
  deviationPct: number;
  isDrifting: boolean;
}

export interface DriftResult {
  id?: string;
  userId: string;
  statedPreference: RiskPreference;
  overallDriftPct: number;
  isDrifting: boolean;
  dimensions: DriftDimension[];
  message: string;
  detectedAt: string;
}

export interface DriftSnapshot {
  id: string;
  userId: string;
  statedPreference: string;
  overallDriftPct: number;
  isDrifting: boolean;
  dimensionData: string;
  reason: string;
  createdAt: string;
}

const PREFERENCE_THRESHOLDS: Record<RiskPreference, {
  maxConcentrationPct: number;
  maxVolatilityPct: number;
  minLiquidityUsd: number;
}> = {
  conservative: { maxConcentrationPct: 25, maxVolatilityPct: 8, minLiquidityUsd: 500_000 },
  balanced: { maxConcentrationPct: 40, maxVolatilityPct: 18, minLiquidityUsd: 200_000 },
  aggressive: { maxConcentrationPct: 60, maxVolatilityPct: 35, minLiquidityUsd: 50_000 },
};

function computeConcentration(positionWeights: number[]): number {
  if (positionWeights.length === 0) return 0;
  return Math.max(...positionWeights);
}

function computeWeightedVolatility(positions: PortfolioBehavior['positions']): number {
  if (positions.length === 0) return 0;
  const totalWeight = positions.reduce((s, p) => s + p.weightPct, 0);
  if (totalWeight === 0) return 0;
  return positions.reduce((s, p) => s + p.volatilityPct * (p.weightPct / totalWeight), 0);
}

function computeWeightedLiquidity(positions: PortfolioBehavior['positions']): number {
  if (positions.length === 0) return 0;
  const totalWeight = positions.reduce((s, p) => s + p.weightPct, 0);
  if (totalWeight === 0) return 0;
  return positions.reduce((s, p) => s + p.liquidityUsd * (p.weightPct / totalWeight), 0);
}

function deviationPct(actual: number, threshold: number): number {
  if (threshold === 0) return actual > 0 ? 100 : 0;
  return ((actual - threshold) / threshold) * 100;
}

function evaluateDimension(
  dimension: 'concentration' | 'volatility' | 'liquidity',
  actualValue: number,
  thresholdValue: number,
  isUpperBound: boolean,
): DriftDimension {
  const dev = deviationPct(actualValue, thresholdValue);
  const isDrifting = isUpperBound
    ? actualValue > thresholdValue
    : actualValue < thresholdValue;
  return {
    dimension,
    actualValue: Math.round(actualValue * 100) / 100,
    thresholdValue,
    deviationPct: Math.round(dev * 100) / 100,
    isDrifting,
  };
}

export class RiskPreferenceDriftService {
  constructor(private prisma?: PrismaClient) {}

  async detectDrift(
    profile: UserRiskProfile,
    behavior: PortfolioBehavior,
    reason: string = 'auto_detected',
  ): Promise<DriftResult> {
    const thresholds = PREFERENCE_THRESHOLDS[profile.statedPreference];

    const actualConcentration = behavior.positions.length > 0
      ? computeConcentration(behavior.positions.map(p => p.weightPct))
      : 0;
    const actualVolatility = computeWeightedVolatility(behavior.positions);
    const actualLiquidity = computeWeightedLiquidity(behavior.positions);

    let result: DriftResult;

    if (behavior.positions.length === 0) {
      result = {
        userId: profile.userId,
        statedPreference: profile.statedPreference,
        overallDriftPct: 0,
        isDrifting: false,
        dimensions: [],
        message: `Portfolio aligns with ${profile.statedPreference} risk preference.`,
        detectedAt: new Date().toISOString(),
      };
    } else {
      const dimensions: DriftDimension[] = [
        evaluateDimension('concentration', actualConcentration, thresholds.maxConcentrationPct, true),
        evaluateDimension('volatility', actualVolatility, thresholds.maxVolatilityPct, true),
        evaluateDimension('liquidity', actualLiquidity, thresholds.minLiquidityUsd, false),
      ];

      const driftingDims = dimensions.filter(d => d.isDrifting);
      const overallDriftPct = dimensions.length > 0
        ? Math.round((driftingDims.length / dimensions.length) * 100)
        : 0;
      const isDrifting = driftingDims.length > 0;

      let message: string;
      if (!isDrifting) {
        message = `Portfolio aligns with ${profile.statedPreference} risk preference.`;
      } else {
        const driftNames = driftingDims.map(d => d.dimension).join(', ');
        message = `Detected drift in ${driftNames}. Portfolio no longer matches ${profile.statedPreference} profile.`;
      }

      result = {
        userId: profile.userId,
        statedPreference: profile.statedPreference,
        overallDriftPct,
        isDrifting,
        dimensions,
        message,
        detectedAt: new Date().toISOString(),
      };
    }

    // Persist snapshot
    if (this.prisma) {
      const snapshot = await this.recordDrift(result, reason);
      result.id = snapshot.id;
    }

    return result;
  }

  async recordDrift(drift: DriftResult, reason: string): Promise<DriftSnapshot> {
    if (!this.prisma) {
      throw new Error('Prisma client not initialized');
    }

    const record = await this.prisma.riskPreferenceDriftSnapshot.create({
      data: {
        userId: drift.userId,
        statedPreference: drift.statedPreference,
        overallDriftPct: drift.overallDriftPct,
        isDrifting: drift.isDrifting,
        dimensionData: JSON.stringify(drift.dimensions),
        reason,
      },
    });

    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      dimensionData: record.dimensionData,
    };
  }

  async resetDrift(
    userId: string,
    preference: RiskPreference,
    reason: string,
  ): Promise<DriftSnapshot> {
    return this.recordDrift(
      {
        userId,
        statedPreference: preference,
        overallDriftPct: 0,
        isDrifting: false,
        dimensions: [],
        message: `Risk preference reset to ${preference}: ${reason}`,
        detectedAt: new Date().toISOString(),
      },
      reason,
    );
  }

  async getDriftHistory(userId: string, limit: number = 10): Promise<DriftSnapshot[]> {
    if (!this.prisma) {
      return [];
    }

    const records = await this.prisma.riskPreferenceDriftSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return records.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  getThresholdsForPreference(preference: RiskPreference) {
    return PREFERENCE_THRESHOLDS[preference];
  }
}

export const riskPreferenceDriftService = new RiskPreferenceDriftService();
