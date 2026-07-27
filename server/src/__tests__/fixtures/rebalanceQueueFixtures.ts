/**
 * Replayable fixtures for the rebalance queue processor job (issue #1049).
 *
 * Each fixture is a plain `RebalanceQueueEntryDTO`-shaped object with no
 * external dependencies (no DB, no RPC), so the processor job can be
 * replayed against them entirely offline by mocking
 * `rebalanceQueueService`/`rebalanceExecutorService` to return them. Add a
 * new fixture here (and a matching case in
 * `server/src/jobs/__tests__/rebalanceQueueProcessorJob.fixtures.test.ts`)
 * whenever a new queue edge case needs a regression test.
 */

export const NOW = new Date('2026-01-15T12:00:00.000Z');

function baseEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'entry-base',
    poolId: 'pool-1',
    status: 'PENDING',
    executionType: 'FULL',
    attemptCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A retry that has already failed many times — should still be attempted
 * again (there is no attempt cap in the current job), not silently dropped. */
export const stuckEntryFixture = baseEntry({
  id: 'entry-stuck',
  status: 'FAILED',
  attemptCount: 12,
  lastError: 'TRANSIENT: RPC timeout',
});

/** An entry already locked in-flight by the executor (e.g. a prior worker
 * tick that hasn't finished) — the job must skip it rather than double-submit. */
export const duplicateEntryFixture = baseEntry({
  id: 'entry-duplicate',
  status: 'PROCESSING',
  attemptCount: 1,
});

/** A deferred entry whose window has passed — exercises the
 * getDeferredEntries() path rather than getPendingRetries(). */
export const expiredEntryFixture = baseEntry({
  id: 'entry-expired',
  status: 'PENDING',
  executionType: 'DEFERRED',
  deferredUntil: new Date(NOW.getTime() - 60_000),
  attemptCount: 0,
});

/** An entry whose execution fails because a dependency (e.g. an allocation
 * constraint breach) was not met — must be classified and recorded, not
 * retried blindly the same way a transient network error would be. */
export const dependencyFailedEntryFixture = baseEntry({
  id: 'entry-dependency-failed',
  status: 'PENDING',
  attemptCount: 2,
});
