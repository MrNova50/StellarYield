import { logger } from './logger';
import { config } from '../config';

/**
 * Represents an exported incident event for replay purposes.
 */
export interface IncidentEvent {
    ledger: number;
    timestamp: string;
    type: 'vault_state_change' | 'liquidation_trigger' | 'compound_execution' | 'price_update' | 'error';
    vaultId?: string;
    accountAddress?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

/**
 * Represents a keeper audit decision.
 */
export interface KeeperAuditDecision {
    timestamp: string;
    jobId: string;
    type: 'liquidation_trigger' | 'liquidation_execute' | 'compound_trigger' | 'compound_execute';
    accountAddress?: string;
    vaultId?: string;
    decision: 'approve' | 'reject' | 'defer';
    evidence: string;
    confidence: number;
    transactionHash?: string;
    error?: string;
}

/**
 * Represents a detected anomaly.
 */
export interface DetectedAnomaly {
    ledger: number;
    timestamp: string;
    type: 'collateral_ratio_drop' | 'fee_spike' | 'oracle_deviation' | 'queue_stall' | 'liquidation_failure';
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedVaults?: string[];
    details: string;
    threshold?: number;
    observed?: number;
}

/**
 * Exported incident data structure.
 */
export interface IncidentExport {
    ledgerRange: { from: number; to: number };
    exportedAt: string;
    events: IncidentEvent[];
    decisions: KeeperAuditDecision[];
    anomalies: DetectedAnomaly[];
    affectedVaults: string[];
    affectedAccounts: string[];
    summary: {
        eventCount: number;
        decisionCount: number;
        anomalyCount: number;
    };
}

/**
 * User impact summary for an incident.
 */
export interface UserImpactSummary {
    incidentId: string;
    duration: string;
    affectedVaults: string[];
    affectedAccounts: number;
    liquidations: {
        triggered: number;
        successful: number;
        partial: number;
        failed: number;
    };
    recovery: {
        collateralRecovered: string;
        totalAtRisk: string;
        recoveryPercentage: number;
    };
    unresolvedAnomalies: DetectedAnomaly[];
}

/**
 * Exports incident events from a ledger range.
 * Reads from keeper queue history and vault state snapshots.
 * Operates in read-only mode by default.
 *
 * @param fromLedger - Starting ledger sequence
 * @param toLedger - Ending ledger sequence
 * @param readOnly - If true, don't mutate any state (default: true)
 */
export async function exportIncidentEvents(
    fromLedger: number,
    toLedger: number,
    readOnly = true,
): Promise<IncidentExport> {
    logger.info(
        { fromLedger, toLedger, readOnly },
        '[IncidentReplay] Exporting events for ledger window',
    );

    if (readOnly === false && process.env.NODE_ENV !== 'staging') {
        throw new Error('Mutations only allowed in staging environment');
    }

    // TODO: Implement event export from queue history
    // 1. Query Redis sorted sets for completed/failed jobs in ledger range
    // 2. Query vault state snapshots
    // 3. Cross-reference with on-chain ledger entries
    // 4. Collect all anomalies

    const events: IncidentEvent[] = [];
    const decisions: KeeperAuditDecision[] = [];
    const anomalies: DetectedAnomaly[] = [];
    const affectedVaults = new Set<string>();
    const affectedAccounts = new Set<string>();

    // Placeholder: return empty export structure
    return {
        ledgerRange: { from: fromLedger, to: toLedger },
        exportedAt: new Date().toISOString(),
        events,
        decisions,
        anomalies,
        affectedVaults: Array.from(affectedVaults),
        affectedAccounts: Array.from(affectedAccounts),
        summary: {
            eventCount: events.length,
            decisionCount: decisions.length,
            anomalyCount: anomalies.length,
        },
    };
}

/**
 * Analyzes keeper audit logs for an incident.
 * Extracts decision timeline and validates against on-chain state.
 *
 * @param incidentId - Incident identifier
 * @param validateAgainstLedger - Cross-reference with on-chain state
 */
export async function analyzeKeeperAuditLogs(
    incidentId: string,
    validateAgainstLedger = false,
): Promise<KeeperAuditDecision[]> {
    logger.info(
        { incidentId, validateAgainstLedger },
        '[IncidentReplay] Analyzing keeper audit logs',
    );

    // TODO: Implement audit log analysis
    // 1. Query Pino logs for keeper service records
    // 2. Filter by incident ID and timeframe
    // 3. Extract decision records (liquidation, compound)
    // 4. If validateAgainstLedger: verify decisions match outcomes

    const decisions: KeeperAuditDecision[] = [];

    return decisions;
}

/**
 * Generates user impact summary from incident data.
 * Does not include sensitive data (addresses, keys).
 *
 * @param incidentId - Incident identifier
 * @param export_ - Incident export data
 */
export async function generateUserImpactSummary(
    incidentId: string,
    export_: IncidentExport,
): Promise<UserImpactSummary> {
    logger.info({ incidentId }, '[IncidentReplay] Generating user impact summary');

    // TODO: Implement impact summary
    // 1. Count affected vaults and accounts (sanitized)
    // 2. Aggregate liquidation outcomes
    // 3. Calculate recovery percentage
    // 4. Identify unresolved anomalies

    const summary: UserImpactSummary = {
        incidentId,
        duration: 'unknown',
        affectedVaults: export_.affectedVaults,
        affectedAccounts: export_.affectedAccounts.length,
        liquidations: {
            triggered: 0,
            successful: 0,
            partial: 0,
            failed: 0,
        },
        recovery: {
            collateralRecovered: '0',
            totalAtRisk: '0',
            recoveryPercentage: 0,
        },
        unresolvedAnomalies: export_.anomalies.filter((a) => a.severity === 'high' || a.severity === 'critical'),
    };

    return summary;
}

/**
 * Validates incident replay export against schema.
 * Ensures no sensitive data leaks.
 *
 * @param export_ - Incident export to validate
 */
export function validateIncidentExport(export_: IncidentExport): string[] {
    const errors: string[] = [];

    // Validate structure
    if (!export_.ledgerRange || !export_.ledgerRange.from || !export_.ledgerRange.to) {
        errors.push('Missing or invalid ledgerRange');
    }

    if (!export_.exportedAt || isNaN(new Date(export_.exportedAt).getTime())) {
        errors.push('Invalid or missing exportedAt timestamp');
    }

    if (!Array.isArray(export_.events)) {
        errors.push('events must be an array');
    }

    if (!Array.isArray(export_.decisions)) {
        errors.push('decisions must be an array');
    }

    if (!Array.isArray(export_.anomalies)) {
        errors.push('anomalies must be an array');
    }

    // Check for sensitive data in export
    const exportJson = JSON.stringify(export_);
    if (/[Ss]ecret|[Pp]rivate[Kk]ey|[Aa]pi[Kk]ey/.test(exportJson)) {
        errors.push('Export contains potential secrets (secret, privateKey, apiKey)');
    }

    // Validate vault and account count
    if (export_.affectedVaults.length !== export_.summary.eventCount && export_.summary.eventCount > 0) {
        logger.warn('[IncidentReplay] Vault count mismatch with event count');
    }

    return errors;
}
