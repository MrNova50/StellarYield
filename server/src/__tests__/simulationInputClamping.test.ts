/**
 * Boundary/clamping tests for simulator inputs (issue #1053): extreme
 * deposits, negative APY assumptions, and fee/weight boundaries.
 */
import {
  simulateDeposit,
  validateRebalanceParams,
  simulateRebalance,
  MAX_SIMULATION_DEPOSIT,
  RebalanceParams,
} from '../services/simulationService';

describe('simulateDeposit — extreme deposit clamping', () => {
  it('rejects a negative amount', () => {
    const result = simulateDeposit({ strategyId: 'balanced', amount: -100, token: 'USDC' });
    expect(result.warnings[0]).toMatch(/greater than zero/);
    expect(result.allocations).toHaveLength(0);
  });

  it('rejects a zero amount', () => {
    const result = simulateDeposit({ strategyId: 'balanced', amount: 0, token: 'USDC' });
    expect(result.warnings[0]).toMatch(/greater than zero/);
  });

  it('rejects a non-finite amount (NaN / Infinity)', () => {
    expect(simulateDeposit({ strategyId: 'balanced', amount: NaN, token: 'USDC' }).warnings[0]).toMatch(
      /finite number/,
    );
    expect(simulateDeposit({ strategyId: 'balanced', amount: Infinity, token: 'USDC' }).warnings[0]).toMatch(
      /finite number/,
    );
  });

  it('rejects an amount over the maximum supported deposit', () => {
    const result = simulateDeposit({
      strategyId: 'balanced',
      amount: MAX_SIMULATION_DEPOSIT + 1,
      token: 'USDC',
    });
    expect(result.warnings[0]).toMatch(/exceeds the maximum/);
    expect(result.allocations).toHaveLength(0);
  });

  it('accepts an amount exactly at the maximum without numeric overflow', () => {
    const result = simulateDeposit({
      strategyId: 'balanced',
      amount: MAX_SIMULATION_DEPOSIT,
      token: 'USDC',
    });
    expect(result.warnings.some((w) => w.match(/exceeds the maximum/))).toBe(false);
    expect(Number.isFinite(result.expectedShares)).toBe(true);
    expect(Number.isFinite(result.postDepositExposure.expectedApy)).toBe(true);
  });
});

describe('validateRebalanceParams — negative APY and extreme value guards', () => {
  function baseParams(overrides: Partial<RebalanceParams> = {}): RebalanceParams {
    return {
      totalValueUsd: 10_000,
      allocations: [
        { label: 'Blend', currentWeight: 50, targetWeight: 50, apy: 5 },
        { label: 'Aggressive', currentWeight: 50, targetWeight: 50, apy: 8 },
      ],
      ...overrides,
    };
  }

  it('accepts valid, non-negative APY assumptions', () => {
    expect(validateRebalanceParams(baseParams())).toEqual([]);
  });

  it('rejects a negative APY assumption', () => {
    const errors = validateRebalanceParams(
      baseParams({
        allocations: [
          { label: 'Blend', currentWeight: 50, targetWeight: 50, apy: -5 },
          { label: 'Aggressive', currentWeight: 50, targetWeight: 50, apy: 8 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('apy for Blend'))).toBe(true);
  });

  it('rejects a non-finite APY assumption', () => {
    const errors = validateRebalanceParams(
      baseParams({
        allocations: [
          { label: 'Blend', currentWeight: 50, targetWeight: 50, apy: NaN },
          { label: 'Aggressive', currentWeight: 50, targetWeight: 50, apy: 8 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('apy for Blend'))).toBe(true);
  });

  it('rejects an implausibly large APY assumption', () => {
    const errors = validateRebalanceParams(
      baseParams({
        allocations: [
          { label: 'Blend', currentWeight: 50, targetWeight: 50, apy: 50_000 },
          { label: 'Aggressive', currentWeight: 50, targetWeight: 50, apy: 8 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('not a plausible assumption'))).toBe(true);
  });

  it('rejects an extreme totalValueUsd', () => {
    const errors = validateRebalanceParams(baseParams({ totalValueUsd: MAX_SIMULATION_DEPOSIT + 1 }));
    expect(errors.some((e) => e.includes('exceeds the maximum'))).toBe(true);
  });

  it('simulateRebalance throws a clear error for invalid inputs instead of producing a misleading chart', () => {
    expect(() =>
      simulateRebalance(
        baseParams({
          allocations: [
            { label: 'Blend', currentWeight: 50, targetWeight: 50, apy: -5 },
            { label: 'Aggressive', currentWeight: 50, targetWeight: 50, apy: 8 },
          ],
        }),
      ),
    ).toThrow(/Invalid rebalance parameters/);
  });
});
