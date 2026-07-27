import { PROTOCOLS } from "../config/protocols";
import { slippageRegistry } from "./slippageRegistry";

export type ComponentName = 'depth' | 'spread' | 'stability' | 'withdrawalSensitivity';
export type HealthBand = 'healthy' | 'warning' | 'critical';

/** The weight each component contributes to the composite score (issue #1092). */
export const COMPONENT_WEIGHTS: Record<ComponentName, number> = {
  depth: 0.35,
  spread: 0.35,
  stability: 0.15,
  withdrawalSensitivity: 0.15,
};

export interface ComponentBreakdown {
  name: ComponentName;
  score: number; // 0-100
  weight: number; // contribution weight used in the composite (sums to 1 across all components)
  band: HealthBand;
}

export interface LiquidityAlertContext {
  /** The component(s) most responsible for the current health band, lowest score first. */
  primaryDrivers: ComponentName[];
  message: string;
}

export interface LiquidityHealthScore {
  strategyId: string;
  score: number; // 0-100
  status: HealthBand;
  components: {
    depth: number;
    spread: number;
    stability: number;
    withdrawalSensitivity: number;
  };
  /** Per-component health band + weight, so a report can explain the score
   * rather than just stating it (issue #1092). */
  breakdown: ComponentBreakdown[];
  /** Present whenever status is not "healthy" — identifies which component(s)
   * drove the drop and a human-readable explanation. */
  alertContext?: LiquidityAlertContext;
  thresholds: {
    warning: number;
    critical: number;
  };
  updatedAt: string;
}

const COMPONENT_LABELS: Record<ComponentName, string> = {
  depth: 'pool depth (TVL)',
  spread: 'withdrawal slippage',
  stability: 'price/volatility stability',
  withdrawalSensitivity: 'withdrawal sensitivity',
};

/** Same warning/critical thresholds used for the composite score, applied
 * per-component so each one can be diagnosed on its own band. */
export function bandForScore(score: number, warningThreshold: number, criticalThreshold: number): HealthBand {
  if (score < criticalThreshold) return 'critical';
  if (score < warningThreshold) return 'warning';
  return 'healthy';
}

export function buildComponentBreakdown(
  components: LiquidityHealthScore['components'],
  warningThreshold: number,
  criticalThreshold: number,
): ComponentBreakdown[] {
  return (Object.keys(components) as ComponentName[]).map((name) => ({
    name,
    score: components[name],
    weight: COMPONENT_WEIGHTS[name],
    band: bandForScore(components[name], warningThreshold, criticalThreshold),
  }));
}

/**
 * Builds the alert context for a non-healthy composite status: the lowest-
 * scoring component(s) are the "primary drivers" (ties included), with a
 * human-readable message a maintainer can act on without reading logs.
 */
export function buildAlertContext(
  breakdown: ComponentBreakdown[],
  status: HealthBand,
  strategyId: string,
): LiquidityAlertContext | undefined {
  if (status === 'healthy') return undefined;

  const minScore = Math.min(...breakdown.map((c) => c.score));
  const primaryDrivers = breakdown.filter((c) => c.score === minScore).map((c) => c.name);
  const driverLabels = primaryDrivers.map((name) => COMPONENT_LABELS[name]).join(' and ');

  return {
    primaryDrivers,
    message:
      `${strategyId} liquidity health is ${status} primarily due to ${driverLabels} ` +
      `(score ${minScore}/100).`,
  };
}

export class LiquidityHealthService {
  private readonly WARNING_THRESHOLD = 60;
  private readonly CRITICAL_THRESHOLD = 30;

  /**
   * Calculates a composite liquidity health score for a strategy.
   *
   * @param strategyId The ID of the strategy (protocol name lowercase)
   */
  async calculateScore(strategyId: string): Promise<LiquidityHealthScore> {
    const protocol = PROTOCOLS.find(p => p.protocolName.toLowerCase() === strategyId);
    if (!protocol) {
      throw new Error(`Protocol ${strategyId} not found`);
    }

    // 1. Depth Score (based on TVL)
    // Target TVL for "perfect" depth is $10M
    const depth = Math.min(1, protocol.baseTvlUsd / 10_000_000);

    // 2. Spread Score (based on slippage)
    // Calculate slippage for a $10,000 withdrawal
    const model = slippageRegistry.getModel(protocol.protocolName);
    const slippage = model.calculateSlippage(BigInt(10_000), BigInt(protocol.baseTvlUsd));
    // 0.1% slippage = 1.0 score, 2% slippage = 0 score
    const spread = Math.max(0, 1 - (slippage / 0.02));

    // 3. Stability Score (based on volatility)
    // 0% volatility = 1.0 score, 10% volatility = 0 score
    const stability = Math.max(0, 1 - (protocol.volatilityPct / 10));

    // 4. Withdrawal Sensitivity (based on protocol age and type)
    // Older protocols are assumed more stable against withdrawals
    const ageFactor = Math.min(1, protocol.protocolAgeDays / 365);
    // Withdrawal velocity if available, else derived
    const withdrawalSensitivity = ageFactor;

    // Composite Weighted Score
    const compositeScore = (
      (depth * COMPONENT_WEIGHTS.depth) +
      (spread * COMPONENT_WEIGHTS.spread) +
      (stability * COMPONENT_WEIGHTS.stability) +
      (withdrawalSensitivity * COMPONENT_WEIGHTS.withdrawalSensitivity)
    ) * 100;

    const roundedScore = Math.round(compositeScore);
    const status = bandForScore(roundedScore, this.WARNING_THRESHOLD, this.CRITICAL_THRESHOLD);

    const components = {
      depth: Math.round(depth * 100),
      spread: Math.round(spread * 100),
      stability: Math.round(stability * 100),
      withdrawalSensitivity: Math.round(withdrawalSensitivity * 100),
    };
    const breakdown = buildComponentBreakdown(components, this.WARNING_THRESHOLD, this.CRITICAL_THRESHOLD);

    return {
      strategyId,
      score: roundedScore,
      status,
      components,
      breakdown,
      alertContext: buildAlertContext(breakdown, status, strategyId),
      thresholds: {
        warning: this.WARNING_THRESHOLD,
        critical: this.CRITICAL_THRESHOLD,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async getAllScores(): Promise<LiquidityHealthScore[]> {
    const promises = PROTOCOLS.map(p => this.calculateScore(p.protocolName.toLowerCase()));
    return Promise.all(promises);
  }

  /**
   * Returns true if liquidity health is insufficient for safe execution.
   */
  async isSuppressed(strategyId: string): Promise<boolean> {
    const result = await this.calculateScore(strategyId);
    return result.score < this.CRITICAL_THRESHOLD;
  }
}

export const liquidityHealthService = new LiquidityHealthService();
