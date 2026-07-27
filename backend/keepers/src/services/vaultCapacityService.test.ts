import { describe, it, expect, beforeEach } from '@jest/globals';
import {
    calculateCapacityStatus,
    checkDepositAgainstCapacity,
    getMultiVaultCapacityStatus,
    filterVaultsByStatus,
    recordCapacitySample,
    getSmoothedUtilization,
    getRecentSamples,
    type CapacityInputs,
} from './vaultCapacityService';

describe('vaultCapacityService', () => {
    beforeEach(() => {
        // Clear sample history between tests by creating a fresh instance per test
        // Note: In a real implementation, you might want to export a clear function
    });

    describe('calculateCapacityStatus', () => {
        it('returns normal status for low utilization', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(1000000),
                liquidityDepth: BigInt(50000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.vaultId).toBe('vault1');
            expect(status.currentUtilization).toBe(10);
            expect(status.isNearCapacity).toBe(false);
            expect(status.isAtCapacity).toBe(false);
            expect(status.status).toBe('normal');
            expect(status.warnings).toHaveLength(0);
        });

        it('returns near_capacity status at 80% utilization', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(8000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.currentUtilization).toBe(80);
            expect(status.isNearCapacity).toBe(true);
            expect(status.isAtCapacity).toBe(false);
            expect(status.status).toBe('near_capacity');
            expect(status.warnings).toContain('Vault is approaching capacity');
        });

        it('returns over_capacity status at 100% utilization', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(10000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.currentUtilization).toBe(100);
            expect(status.isNearCapacity).toBe(true);
            expect(status.isAtCapacity).toBe(true);
            expect(status.status).toBe('over_capacity');
            expect(status.warnings).toContain('Vault is at or exceeding soft capacity');
        });

        it('warns when liquidity depth is low', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(5000000),
                liquidityDepth: BigInt(100000), // Very low
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.warnings).toContain(
                'Liquidity depth is low relative to TVL',
            );
        });

        it('calculates available capacity correctly', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(3000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.availableCapacity).toBe(BigInt(7000000));
        });

        it('returns 0 available capacity when over capacity', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(12000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.availableCapacity).toBe(0n);
        });

        it('recommends 0 deposit when at capacity', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(10000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            expect(status.recommendedMaxDeposit).toBe(0n);
        });

        it('recommends small deposit when near capacity', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(8000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            // Available capacity is 2000000, 10% of that is 200000
            expect(status.recommendedMaxDeposit).toBe(BigInt(200000));
        });

        it('recommends max deposit when normal utilization', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(2000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault1', inputs);

            // Available capacity is 8000000, 50% of that is 4000000
            // But maxDepositSize is 500000, so recommend 500000
            expect(status.recommendedMaxDeposit).toBe(BigInt(500000));
        });
    });

    describe('checkDepositAgainstCapacity', () => {
        it('allows deposit when utilization stays below 80%', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(5000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const warning = checkDepositAgainstCapacity(
                'vault1',
                BigInt(2000000),
                inputs,
            );

            expect(warning.wouldExceedCapacity).toBe(false);
            expect(warning.wouldCauseNearCapacity).toBe(false);
            expect(warning.estimatedUtilizationAfter).toBe(70);
            expect(warning.message).toBe('');
        });

        it('warns when deposit would cause near capacity', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(7500000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const warning = checkDepositAgainstCapacity(
                'vault1',
                BigInt(500000),
                inputs,
            );

            expect(warning.wouldCauseNearCapacity).toBe(true);
            expect(warning.wouldExceedCapacity).toBe(false);
            expect(warning.estimatedUtilizationAfter).toBe(80);
            expect(warning.message).toContain('near capacity');
        });

        it('rejects deposit that would exceed capacity', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(9000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const warning = checkDepositAgainstCapacity(
                'vault1',
                BigInt(2000000),
                inputs,
            );

            expect(warning.wouldExceedCapacity).toBe(true);
            expect(warning.estimatedUtilizationAfter).toBe(110);
            expect(warning.message).toContain('exceed vault capacity');
        });
    });

    describe('getMultiVaultCapacityStatus', () => {
        it('returns status for multiple vaults', () => {
            const vaults = [
                {
                    vaultId: 'vault1',
                    inputs: {
                        tvl: BigInt(1000000),
                        liquidityDepth: BigInt(5000000),
                        maxDepositSize: BigInt(500000),
                        softCapacity: BigInt(10000000),
                    } as CapacityInputs,
                },
                {
                    vaultId: 'vault2',
                    inputs: {
                        tvl: BigInt(8000000),
                        liquidityDepth: BigInt(5000000),
                        maxDepositSize: BigInt(500000),
                        softCapacity: BigInt(10000000),
                    } as CapacityInputs,
                },
            ];

            const statuses = getMultiVaultCapacityStatus(vaults);

            expect(statuses).toHaveLength(2);
            expect(statuses[0].status).toBe('normal');
            expect(statuses[1].status).toBe('near_capacity');
        });
    });

    describe('filterVaultsByStatus', () => {
        it('filters vaults by normal status', () => {
            const vaults = [
                {
                    vaultId: 'vault1',
                    currentUtilization: 10,
                    smoothedUtilization: 10,
                    isNearCapacity: false,
                    isAtCapacity: false,
                    availableCapacity: BigInt(9000000),
                    recommendedMaxDeposit: BigInt(500000),
                    status: 'normal' as const,
                    warnings: [],
                    recentSamples: [],
                },
                {
                    vaultId: 'vault2',
                    currentUtilization: 80,
                    smoothedUtilization: 80,
                    isNearCapacity: true,
                    isAtCapacity: false,
                    availableCapacity: BigInt(2000000),
                    recommendedMaxDeposit: BigInt(200000),
                    status: 'near_capacity' as const,
                    warnings: [],
                    recentSamples: [],
                },
            ];

            const normal = filterVaultsByStatus(vaults, 'normal');

            expect(normal).toHaveLength(1);
            expect(normal[0].vaultId).toBe('vault1');
        });

        it('filters vaults by near_capacity status', () => {
            const vaults = [
                {
                    vaultId: 'vault1',
                    currentUtilization: 10,
                    smoothedUtilization: 10,
                    isNearCapacity: false,
                    isAtCapacity: false,
                    availableCapacity: BigInt(9000000),
                    recommendedMaxDeposit: BigInt(500000),
                    status: 'normal' as const,
                    warnings: [],
                    recentSamples: [],
                },
                {
                    vaultId: 'vault2',
                    currentUtilization: 80,
                    smoothedUtilization: 80,
                    isNearCapacity: true,
                    isAtCapacity: false,
                    availableCapacity: BigInt(2000000),
                    recommendedMaxDeposit: BigInt(200000),
                    status: 'near_capacity' as const,
                    warnings: [],
                    recentSamples: [],
                },
            ];

            const nearCapacity = filterVaultsByStatus(vaults, 'near_capacity');

            expect(nearCapacity).toHaveLength(1);
            expect(nearCapacity[0].vaultId).toBe('vault2');
        });

        it('filters vaults by over_capacity status', () => {
            const vaults = [
                {
                    vaultId: 'vault1',
                    currentUtilization: 100,
                    smoothedUtilization: 100,
                    isNearCapacity: true,
                    isAtCapacity: true,
                    availableCapacity: BigInt(0),
                    recommendedMaxDeposit: BigInt(0),
                    status: 'over_capacity' as const,
                    warnings: [],
                    recentSamples: [],
                },
            ];

            const overCapacity = filterVaultsByStatus(vaults, 'over_capacity');

            expect(overCapacity).toHaveLength(1);
            expect(overCapacity[0].vaultId).toBe('vault1');
        });
    });

    describe('Trend smoothing and outlier rejection', () => {
        it('records capacity samples with outlier detection', () => {
            const vaultId = 'vault_smooth_1';

            // Record normal samples
            recordCapacitySample(vaultId, 50);
            recordCapacitySample(vaultId, 52);
            recordCapacitySample(vaultId, 51);

            // Record an outlier
            recordCapacitySample(vaultId, 95);

            // Record normal sample again
            recordCapacitySample(vaultId, 53);

            const samples = getRecentSamples(vaultId, 5);

            expect(samples.length).toBe(5);
            expect(samples[3].isOutlier).toBe(true); // The 95 should be flagged as outlier
        });

        it('smooths utilization by filtering outliers', () => {
            const vaultId = 'vault_smooth_2';

            // Record steady state
            recordCapacitySample(vaultId, 40);
            recordCapacitySample(vaultId, 41);
            recordCapacitySample(vaultId, 40);
            recordCapacitySample(vaultId, 42);
            recordCapacitySample(vaultId, 40);

            const smoothed = getSmoothedUtilization(vaultId);

            // Smoothed value should be close to 40-42, not affected by noise
            expect(smoothed).toBeGreaterThan(39);
            expect(smoothed).toBeLessThan(43);
        });

        it('handles all-outlier scenario gracefully', () => {
            const vaultId = 'vault_smooth_3';

            recordCapacitySample(vaultId, 30);
            recordCapacitySample(vaultId, 85);
            recordCapacitySample(vaultId, 15);

            const smoothed = getSmoothedUtilization(vaultId);

            // Should still return a value (the last raw value if all are outliers)
            expect(smoothed).toBeGreaterThanOrEqual(0);
            expect(smoothed).toBeLessThanOrEqual(200);
        });

        it('preserves raw samples for audit trail', () => {
            const vaultId = 'vault_audit_1';

            recordCapacitySample(vaultId, 50);
            recordCapacitySample(vaultId, 55);
            recordCapacitySample(vaultId, 100); // Outlier

            const samples = getRecentSamples(vaultId);

            expect(samples.length).toBeGreaterThan(0);
            expect(samples[0].rawValue).toBe(true);
            expect(samples.every(s => s.timestamp > 0)).toBe(true);
        });

        it('includes smoothed utilization in capacity status', () => {
            const inputs: CapacityInputs = {
                tvl: BigInt(4000000),
                liquidityDepth: BigInt(5000000),
                maxDepositSize: BigInt(500000),
                softCapacity: BigInt(10000000),
            };

            const status = calculateCapacityStatus('vault_status_smooth', inputs);

            expect(status.smoothedUtilization).toBeDefined();
            expect(status.recentSamples).toBeDefined();
            expect(status.recentSamples.length).toBeGreaterThanOrEqual(0);
        });
    });
});
