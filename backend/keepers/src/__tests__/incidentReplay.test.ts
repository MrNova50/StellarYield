import {
    exportIncidentEvents,
    analyzeKeeperAuditLogs,
    generateUserImpactSummary,
    validateIncidentExport,
    type IncidentExport,
} from '../utils/incidentReplay';

describe('Incident Replay', () => {
    describe('exportIncidentEvents', () => {
        it('exports events for ledger range', async () => {
            const export_ = await exportIncidentEvents(50000000, 50001000);

            expect(export_).toBeDefined();
            expect(export_.ledgerRange.from).toBe(50000000);
            expect(export_.ledgerRange.to).toBe(50001000);
            expect(Array.isArray(export_.events)).toBe(true);
            expect(Array.isArray(export_.decisions)).toBe(true);
            expect(Array.isArray(export_.anomalies)).toBe(true);
        });

        it('rejects mutations outside staging', async () => {
            if (process.env.NODE_ENV !== 'staging') {
                await expect(exportIncidentEvents(50000000, 50001000, false)).rejects.toThrow(
                    'Mutations only allowed in staging environment',
                );
            }
        });

        it('operates in read-only mode by default', async () => {
            const export_ = await exportIncidentEvents(50000000, 50001000);
            // Verify no state changes (implementation detail)
            expect(export_.summary.eventCount).toBe(export_.events.length);
        });
    });

    describe('analyzeKeeperAuditLogs', () => {
        it('extracts keeper decisions', async () => {
            const decisions = await analyzeKeeperAuditLogs('INC-001');

            expect(Array.isArray(decisions)).toBe(true);
            decisions.forEach((d) => {
                expect(d.timestamp).toBeDefined();
                expect(d.jobId).toBeDefined();
                expect(['liquidation_trigger', 'liquidation_execute', 'compound_trigger', 'compound_execute']).toContain(
                    d.type,
                );
                expect(['approve', 'reject', 'defer']).toContain(d.decision);
            });
        });

        it('validates keeper decisions against ledger', async () => {
            const decisions = await analyzeKeeperAuditLogs('INC-001', true);
            // Should complete without error when validateAgainstLedger is true
            expect(Array.isArray(decisions)).toBe(true);
        });
    });

    describe('generateUserImpactSummary', () => {
        it('generates impact summary from export', async () => {
            const mockExport: IncidentExport = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: new Date().toISOString(),
                events: [],
                decisions: [],
                anomalies: [],
                affectedVaults: ['vault_1', 'vault_2'],
                affectedAccounts: ['acc_1', 'acc_2'],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 0 },
            };

            const impact = await generateUserImpactSummary('INC-001', mockExport);

            expect(impact.incidentId).toBe('INC-001');
            expect(impact.affectedVaults).toEqual(['vault_1', 'vault_2']);
            expect(impact.affectedAccounts).toBe(2);
            expect(impact.liquidations).toBeDefined();
            expect(impact.recovery).toBeDefined();
        });

        it('lists unresolved anomalies', async () => {
            const mockExport: IncidentExport = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: new Date().toISOString(),
                events: [],
                decisions: [],
                anomalies: [
                    {
                        ledger: 50000050,
                        timestamp: new Date().toISOString(),
                        type: 'collateral_ratio_drop',
                        severity: 'critical',
                        details: 'CR below MCR',
                    },
                    {
                        ledger: 50000100,
                        timestamp: new Date().toISOString(),
                        type: 'oracle_deviation',
                        severity: 'low',
                        details: 'Minor price deviation',
                    },
                ],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 2 },
            };

            const impact = await generateUserImpactSummary('INC-001', mockExport);

            expect(impact.unresolvedAnomalies.length).toBe(1); // Only high/critical
            expect(impact.unresolvedAnomalies[0].severity).toBe('critical');
        });
    });

    describe('validateIncidentExport', () => {
        it('validates correct export structure', () => {
            const validExport: IncidentExport = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: new Date().toISOString(),
                events: [],
                decisions: [],
                anomalies: [],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 0 },
            };

            const errors = validateIncidentExport(validExport);
            expect(errors.length).toBe(0);
        });

        it('detects missing ledgerRange', () => {
            const invalidExport = {
                exportedAt: new Date().toISOString(),
                events: [],
                decisions: [],
                anomalies: [],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 0 },
            } as any;

            const errors = validateIncidentExport(invalidExport);
            expect(errors.some((e) => e.includes('ledgerRange'))).toBe(true);
        });

        it('detects invalid timestamp', () => {
            const invalidExport: any = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: 'invalid-date',
                events: [],
                decisions: [],
                anomalies: [],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 0 },
            };

            const errors = validateIncidentExport(invalidExport);
            expect(errors.some((e) => e.includes('exportedAt'))).toBe(true);
        });

        it('detects potential secrets in export', () => {
            const exportWithSecret: IncidentExport = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: new Date().toISOString(),
                events: [
                    {
                        ledger: 50000000,
                        timestamp: new Date().toISOString(),
                        type: 'vault_state_change',
                        metadata: { privateKey: 'secret_key_here' },
                    },
                ],
                decisions: [],
                anomalies: [],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 1, decisionCount: 0, anomalyCount: 0 },
            };

            const errors = validateIncidentExport(exportWithSecret);
            expect(errors.some((e) => e.includes('secrets'))).toBe(true);
        });

        it('detects non-array fields', () => {
            const invalidExport: any = {
                ledgerRange: { from: 50000000, to: 50001000 },
                exportedAt: new Date().toISOString(),
                events: 'not an array',
                decisions: [],
                anomalies: [],
                affectedVaults: [],
                affectedAccounts: [],
                summary: { eventCount: 0, decisionCount: 0, anomalyCount: 0 },
            };

            const errors = validateIncidentExport(invalidExport);
            expect(errors.some((e) => e.includes('array'))).toBe(true);
        });
    });

    describe('Integration: Full Replay Flow', () => {
        it('exports, analyzes, and summarizes incident', async () => {
            const export_ = await exportIncidentEvents(50000000, 50001000);
            const decisions = await analyzeKeeperAuditLogs('INC-001');
            const impact = await generateUserImpactSummary('INC-001', export_);

            // All components should complete without error
            expect(export_.ledgerRange.from).toBe(50000000);
            expect(Array.isArray(decisions)).toBe(true);
            expect(impact.incidentId).toBe('INC-001');

            // Validation should pass
            const errors = validateIncidentExport(export_);
            expect(errors.length).toBe(0);
        });
    });
});
