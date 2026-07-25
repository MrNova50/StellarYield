## Summary
This PR implements critical infrastructure hardening, oracle reliability enhancements, and robust data continuity checks across four key areas for the StellarYield platform:

1. **Oracle Staleness, TWAP Fallback, and Confidence Scoring (Issue #899)**:
   - Enhanced `contracts/yield_vault/src/oracle.rs` with confidence scoring (0-100 scale) based on price age and sample quality.
   - Implemented `get_secure_price_with_metadata()` returning price, confidence score, and fallback status.
   - Added minimum 2-sample requirement for TWAP calculation with volatility-based confidence penalties.
   - Emits `stale-oracle` and `twap-used` events for observability.
   - Exposed oracle metadata (source, age, confidence, samples) in `server/src/utils/riskScoring.ts`.
   - Added client-side oracle status UI configuration in `client/src/config/riskConfig.ts`.
   - Blocks sensitive operations (rebalances, liquidations) when confidence falls below 50%.

2. **Indexer Continuity Checks for Ledger Gaps (Issue #891)**:
   - Added `IndexerGapEvent` and `IndexerContinuityCheck` Prisma models for tracking ledger gaps, rollbacks, and network drift.
   - Implemented gap detection with severity classification (INFO, WARNING, CRITICAL).
   - Added recovery tracking with automatic retry mechanism and status monitoring (PENDING, IN_PROGRESS, RECOVERED, UNRECOVERABLE).
   - Network passphrase validation to prevent wrong-network contract ingestion.
   - Persistent error history surviving server restarts.
   - Enhanced indexer status endpoint with continuity metrics.

3. **Reconciliation Anomaly Workflow (Issue #895)**:
   - Added `ReconciliationEvent` and `ReconciliationAnomaly` Prisma models for durable anomaly tracking.
   - Implemented four anomaly types: ORPHANED, DUPLICATE, MISSING, DISCREPANCY.
   - Severity-based workflow with suggested remediation and resolution tracking.
   - Operator acknowledgment and resolution audit trail.
   - Anomaly grouping by account, vault, and ledger window.
   - Foundation for UI drill-down and automated remediation rules.

4. **Per-Contract Cursor Checkpointing for Soroban Events (Issue #888)**:
   - Added `ContractIndexerCursor` and `EventIngestionLog` Prisma models.
   - Implemented per-contract, per-network, per-stream-type cursor tracking.
   - Event identity-based idempotency preventing duplicate ingestion of legitimate duplicate events.
   - Raw XDR storage with decoder version tracking for replay compatibility.
   - Checkpoint age monitoring and per-contract error isolation.
   - Foundation for multi-contract parallel indexing.

## Linked Issues
- Closes #899
- Closes #891
- Closes #895
- Closes #888

## Change Type
- [x] Bug fix (non-breaking change which fixes an issue)
- [x] New feature (non-breaking change which adds functionality)
- [x] Breaking change (oracle.rs PricePoint struct now includes confidence field)
- [x] Documentation update
- [x] Refactor
- [x] Database migration (new Prisma models require migration)

## Testing
- **Smart Contracts**: Oracle confidence scoring logic with TWAP fallback scenarios.
- **Backend Services**: Risk scoring with oracle metadata integration.
- **Database Models**: New Prisma schemas for reconciliation, indexer gaps, and per-contract cursors.
- **Client UI**: Oracle status badges and confidence thresholds.

### Checklist
- [x] Frontend changes tested
- [x] Backend changes tested
- [x] Contracts changes tested
- [x] Documentation updated
- [x] Migrations required (Prisma schema updated)

## Deployment Notes
1. **Database Migration Required**: Run `npx prisma migrate dev` to create new tables:
   - `ReconciliationEvent`, `ReconciliationAnomaly`
   - `IndexerGapEvent`, `IndexerContinuityCheck`
   - `ContractIndexerCursor`, `EventIngestionLog`

2. **Contract Redeployment**: The `PricePoint` struct in `oracle.rs` now includes a `confidence` field. Existing contracts using the old struct will need redeployment.

3. **Breaking Change**: Any off-chain code directly reading `PricePoint` from contract storage will need to handle the new `confidence` field.

4. **Monitoring**: New event emissions (`stale-oracle`, `twap-used`, `fallback-used`) can be monitored for oracle health tracking.

5. **Indexer Enhancement**: Existing single-cursor indexer will continue working. Per-contract cursors are opt-in for multi-contract setups.
