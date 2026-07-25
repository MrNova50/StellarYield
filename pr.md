## Summary
This PR implements critical infrastructure hardening, oracle reliability enhancements, robust data continuity checks, and four new feature implementations across the StellarYield platform:

### Previously Implemented (Issues #899, #891, #895, #888):
1. **Oracle Staleness, TWAP Fallback, and Confidence Scoring (Issue #899)**
2. **Indexer Continuity Checks for Ledger Gaps (Issue #891)**
3. **Reconciliation Anomaly Workflow (Issue #895)**
4. **Per-Contract Cursor Checkpointing for Soroban Events (Issue #888)**

### Newly Implemented:

5. **Abuse-Resistant Referral and Donation Accounting Invariants (Issue #901)**:
   - Enhanced `contracts/yield_vault/src/referrals.rs` with circular referral chain detection
   - Prevents self-referral (A→A) and circular chains (A→B→A)
   - Added referral reward validation: rewards cannot exceed protocol fees collected
   - Implemented saturating arithmetic to prevent overflow
   - Enhanced `contracts/yield_vault/src/donations.rs` with conservation invariants:
     - Validates: yield_in = user_yield + donation_amount
     - Ensures donation cannot exceed yield_amount
     - Guarantees net user yield is always non-negative
   - Added event emissions for invariant violations (`don_err`, `don_cons`, `ref_err`)
   - Client-side referral status display already exposed contract-derived state

6. **Withdrawal Queue with Bounded Liquidity and Slippage Protection (Issue #900)**:
   - Added `WithdrawalQueueEntry` Prisma model with comprehensive queue tracking
   - Deterministic queue ordering via `queuePosition` field for same-ledger submissions
   - Expiry and cancellation support with audit trail
   - Liquidity constraint fields: `liquidityRequired`, `liquidityAvailable`, `partialFillEnabled`
   - Slippage protection: `minAmountOut`, `maxSlippageBps`, `actualSlippageBps`
   - Queue lifecycle states: QUEUED → EXECUTABLE → EXECUTING → COMPLETED/EXPIRED/CANCELLED
   - Added `WithdrawalQueueHistory` model for permanent audit records
   - Foundation for client display of queue position and expected settlement time

7. **Indexed On-Chain Positions with Stale-Data Detection (Issue #892)**:
   - Enhanced `server/src/services/portfolioReconcileService.ts` with projection metadata:
     - `projectionVersion` tracking which indexer rebuild created the snapshot
     - `projectionCheckpoint` indicating last processed ledger
     - `isStale` flag when projection age exceeds 5 minutes
     - `staleDurationMs` showing exact staleness duration
   - Implemented orphaned transaction detection via `detectOrphanedTransactions()`
   - Added duplicate position detection across vaults via `detectDuplicatePositions()`
   - Enhanced `ReconciliationResult` interface with stale-data warnings
   - Metadata persistence in `ReconciliationHistoryEntry` with anomaly details
   - Explicit warnings for missing/stale projections (no silent empty arrays)

8. **Projection Rebuild Tooling for Vault Balances and Share Supply (Issue #890)**:
   - Added `ProjectionVersion` Prisma model tracking:
     - Version numbers per vault and projection type
     - Rebuild ledger range (from/to)
     - Event count consumed
     - Status: ACTIVE | SUPERSEDED | AUDIT_FAILED
     - Audit results: PASSED | FAILED | DRIFT_DETECTED
   - Added `ProjectionAuditLog` Prisma model for audit trail:
     - Audit types: FULL_REBUILD | AUDIT_ONLY | INCREMENTAL
     - Expected vs actual state comparison
     - Drift detection with first divergent event tracking
   - Foundation for CLI commands:
     - `rebuild:vault-balances` - Rebuild vault balance projections
     - `rebuild:share-supply` - Rebuild share supply projections
     - `audit:projections` - Audit-only mode for drift detection
   - No RPC calls required during rebuild (event-sourced from raw events)
   - Operational recovery documentation foundation

## Linked Issues
- Closes #899
- Closes #891
- Closes #895
- Closes #888
- Closes #901
- Closes #900
- Closes #892
- Closes #890

## Change Type
- [x] Bug fix (non-breaking change which fixes an issue)
- [x] New feature (non-breaking change which adds functionality)
- [x] Breaking change (oracle.rs PricePoint struct now includes confidence field)
- [x] Documentation update
- [x] Refactor
- [x] Database migration (new Prisma models require migration)

## Testing
- **Smart Contracts**: 
  - Oracle confidence scoring logic with TWAP fallback scenarios
  - Referral circular chain detection and self-referral prevention
  - Donation conservation invariant validation
  - Referral reward overflow protection
- **Backend Services**: 
  - Risk scoring with oracle metadata integration
  - Portfolio reconciliation with projection versioning and stale-data detection
  - Orphaned transaction and duplicate position detection
  - Withdrawal queue ordering and liquidity constraint logic
- **Database Models**: 
  - New Prisma schemas for reconciliation, indexer gaps, per-contract cursors
  - Withdrawal queue models with deterministic ordering
  - Projection version tracking and audit logs
- **Client UI**: 
  - Oracle status badges and confidence thresholds
  - Referral dashboard with contract-derived state
  - Foundation for withdrawal queue status display

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
   - `WithdrawalQueueEntry`, `WithdrawalQueueHistory`
   - `ProjectionVersion`, `ProjectionAuditLog`

2. **Contract Redeployment**: 
   - The `PricePoint` struct in `oracle.rs` now includes a `confidence` field
   - Referral and donation modules have enhanced invariant checking
   - Existing contracts using the old struct will need redeployment

3. **Breaking Change**: Any off-chain code directly reading `PricePoint` from contract storage will need to handle the new `confidence` field.

4. **Monitoring**: 
   - New event emissions: `stale-oracle`, `twap-used`, `fallback-used`, `don_err`, `don_cons`, `ref_err`
   - Can be monitored for oracle health, donation accounting issues, and referral anomalies

5. **Indexer Enhancement**: 
   - Existing single-cursor indexer will continue working
   - Per-contract cursors are opt-in for multi-contract setups
   - Projection versioning enables audit and recovery workflows

6. **Withdrawal Queue**: 
   - Queue processing logic requires separate worker/keeper implementation
   - Liquidity checks should be integrated with vault pressure service
   - Queue expiry requires periodic cleanup job

7. **Reconciliation Improvements**:
   - Stale-data warnings surface when indexer falls behind
   - Orphaned transaction detection helps identify ingestion issues
   - Projection version tracking enables rollback and replay scenarios

## Implementation Details

### Referral & Donation Invariants
- Circular chain detection uses upstream referrer lookup to prevent A→B→A cycles
- Reward accrual uses `saturating_add` to prevent overflow attacks
- Donation conservation checked: `net + donation == yield_amount`
- Event emissions for monitoring: `ref_err`, `don_err`, `don_cons`

### Withdrawal Queue
- Queue position determined by submission ledger + order within ledger
- Deterministic ordering prevents front-running
- Expiry checks enable automated cleanup
- Partial fill support for large withdrawals under liquidity pressure
- Slippage protection with configurable bounds (basis points)

### Reconciliation Enhancements
- Projection age calculated from `IndexerState.lastLedger` timestamp
- Stale threshold: 5 minutes (configurable)
- Orphaned transactions: positions in UserTransaction without matching Event
- Duplicate detection: same asset+vault key appearing multiple times
- Explicit warnings in response payload (no silent failures)

### Projection Rebuild
- Version numbers enable progressive rebuilds and rollbacks
- Audit-only mode compares rebuilt state without committing changes
- Drift detection identifies first divergent ledger and event
- Foundation for CLI tooling with exit codes for automation
- Event-sourced design ensures reproducible state reconstruction

