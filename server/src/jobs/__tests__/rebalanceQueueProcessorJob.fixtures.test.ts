/**
 * Replays fixture rebalance-queue entries through the real processor job
 * (issue #1049), with `rebalanceQueueService`/`rebalanceExecutorService`
 * mocked so no DB or Soroban RPC is needed. Covers: a stuck/repeatedly-failed
 * job, duplicate-in-flight suppression, an expired/deferred job, and a
 * dependency (constraint) failure.
 */
import { runRebalanceQueueProcessorJob } from '../rebalanceQueueProcessorJob';
import {
  stuckEntryFixture,
  duplicateEntryFixture,
  expiredEntryFixture,
  dependencyFailedEntryFixture,
} from '../../__tests__/fixtures/rebalanceQueueFixtures';

const mockGetPendingRetries = jest.fn();
const mockGetDeferredEntries = jest.fn();
const mockMarkAsProcessing = jest.fn();
const mockRecordPartialExecution = jest.fn();
const mockRecordFailedAttempt = jest.fn();

jest.mock('../../services/rebalanceQueueService', () => ({
  rebalanceQueueService: {
    getPendingRetries: (...args: any[]) => mockGetPendingRetries(...args),
    getDeferredEntries: (...args: any[]) => mockGetDeferredEntries(...args),
    markAsProcessing: (...args: any[]) => mockMarkAsProcessing(...args),
    recordPartialExecution: (...args: any[]) => mockRecordPartialExecution(...args),
    recordFailedAttempt: (...args: any[]) => mockRecordFailedAttempt(...args),
  },
}));

const mockExecute = jest.fn();
const mockClassifyError = jest.fn();
const mockIsLocked = jest.fn().mockReturnValue(false);

jest.mock('../../services/rebalanceExecutorService', () => ({
  rebalanceExecutorService: {
    execute: (...args: any[]) => mockExecute(...args),
    classifyError: (...args: any[]) => mockClassifyError(...args),
    isLocked: (...args: any[]) => mockIsLocked(...args),
  },
}));

function baseConfig(overrides: Partial<Record<string, any>> = {}) {
  return {
    enabled: true,
    batchSize: 10,
    enableRetries: true,
    enableDeferredProcessing: true,
    logResults: false,
    ...overrides,
  };
}

describe('runRebalanceQueueProcessorJob — fixture replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPendingRetries.mockResolvedValue([]);
    mockGetDeferredEntries.mockResolvedValue([]);
    mockMarkAsProcessing.mockResolvedValue(undefined);
    mockRecordPartialExecution.mockResolvedValue(undefined);
    mockRecordFailedAttempt.mockResolvedValue(undefined);
    mockIsLocked.mockReturnValue(false);
  });

  it('retries a stuck (repeatedly-failed) entry rather than dropping it', async () => {
    mockGetPendingRetries.mockResolvedValue([stuckEntryFixture]);
    mockExecute.mockResolvedValue({ transactionHash: 'tx-stuck', filledPercentage: 100 });

    const result = await runRebalanceQueueProcessorJob(baseConfig());

    expect(mockMarkAsProcessing).toHaveBeenCalledWith(stuckEntryFixture.id);
    expect(mockExecute).toHaveBeenCalled();
    expect(result.processedRetries).toBe(1);
    expect(result.failedProcessing).toBe(0);
  });

  it('deterministically produces the same outcome across repeated replays', async () => {
    mockGetPendingRetries.mockResolvedValue([stuckEntryFixture]);
    mockExecute.mockResolvedValue({ transactionHash: 'tx-stuck', filledPercentage: 100 });

    const first = await runRebalanceQueueProcessorJob(baseConfig());
    jest.clearAllMocks();
    mockGetPendingRetries.mockResolvedValue([stuckEntryFixture]);
    mockExecute.mockResolvedValue({ transactionHash: 'tx-stuck', filledPercentage: 100 });
    const second = await runRebalanceQueueProcessorJob(baseConfig());

    expect(second).toMatchObject({
      success: first.success,
      processedRetries: first.processedRetries,
      processedDeferred: first.processedDeferred,
      failedProcessing: first.failedProcessing,
    });
  });

  it('skips an entry already locked in-flight instead of double-submitting', async () => {
    mockGetPendingRetries.mockResolvedValue([duplicateEntryFixture]);
    mockIsLocked.mockReturnValue(true);

    const result = await runRebalanceQueueProcessorJob(baseConfig());

    expect(mockMarkAsProcessing).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.processedRetries).toBe(1); // counted as processed (no-op skip), not failed
    expect(result.failedProcessing).toBe(0);
  });

  it('processes an expired/deferred entry via the deferred-entries path', async () => {
    mockGetDeferredEntries.mockResolvedValue([expiredEntryFixture]);
    mockExecute.mockResolvedValue({ transactionHash: 'tx-expired', filledPercentage: 100 });

    const result = await runRebalanceQueueProcessorJob(baseConfig());

    expect(mockMarkAsProcessing).toHaveBeenCalledWith(expiredEntryFixture.id);
    expect(result.processedDeferred).toBe(1);
  });

  it('records a dependency/constraint failure without crashing the batch', async () => {
    mockGetPendingRetries.mockResolvedValue([dependencyFailedEntryFixture]);
    const constraintError = new Error('Allocation constraint breached: max slippage exceeded');
    mockExecute.mockRejectedValue(constraintError);
    mockClassifyError.mockReturnValue('CONSTRAINT');

    const result = await runRebalanceQueueProcessorJob(baseConfig());

    // execute()'s rejection is caught and recorded *inside* processQueueEntry
    // rather than propagating — so the job counts this as a processed retry
    // (a failure was recorded for it), not a job-level `failedProcessing`.
    expect(mockClassifyError).toHaveBeenCalledWith(constraintError);
    expect(mockRecordFailedAttempt).toHaveBeenCalledWith(
      dependencyFailedEntryFixture.id,
      expect.stringContaining('[CONSTRAINT]'),
      undefined,
    );
    expect(result.processedRetries).toBe(1);
    expect(result.failedProcessing).toBe(0);
  });
});
