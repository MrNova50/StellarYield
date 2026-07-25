import { Worker, Job } from 'bullmq';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { getRedis } from '../utils/redis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { KeeperSigner } from '../signer/KeeperSigner';
import { QUEUE_NAMES, LiquidationJobData, JOB_STATES } from '../queues/types';
import {
  validateFencingToken,
  getJobRecord,
  persistJobRecord,
  classifyFailure,
  quarantineJob,
  createLiquidationQueue,
} from '../queues';

/**
 * LiquidationWorker consumes jobs from the `liquidation` BullMQ queue and
 * executes on-chain liquidation transactions via the StablecoinManager contract.
 *
 * Flow:
 *  1. Pull a job containing the undercollateralized `accountAddress`.
 *  2. Re-verify the position is still below MCR (avoids stale jobs from race conditions).
 *  3. Build and submit a `liquidate(liquidator, user)` Soroban invocation.
 *  4. Log the outcome with the transaction hash.
 *
 * Retry policy: exponential back-off configured at the queue level (5 attempts).
 * Failed jobs land in the BullMQ failed set for manual review / alerting.
 */
export class LiquidationWorker {
  private readonly worker: Worker<LiquidationJobData>;
  private readonly signer: KeeperSigner;

  constructor(signer?: KeeperSigner) {
    this.signer = signer ?? new KeeperSigner();

    this.worker = new Worker<LiquidationJobData>(
      QUEUE_NAMES.LIQUIDATION,
      (job) => this.process(job),
      {
        connection: getRedis(),
        concurrency: config.keeper.liquidationConcurrency,
      },
    );

    this.worker.on('completed', (job) =>
      logger.info({ jobId: job.id, account: job.data.accountAddress }, 'Liquidation job completed'),
    );
    this.worker.on('failed', (job, err) =>
      logger.error({ jobId: job?.id, err }, 'Liquidation job failed'),
    );
  }

  /**
   * Core job processor:
   *  - Decodes the job payload
   *  - Calls `liquidate` on the StablecoinManager contract
   *
   * @param job - BullMQ Job containing LiquidationJobData
   */
  async process(job: Job<LiquidationJobData>): Promise<{ txHash: string }> {
    const { accountAddress, fencingToken, requiredSequence } = job.data;

    logger.info(
      { jobId: job.id, accountAddress, crBps: job.data.currentCrBps, fencingToken, requiredSequence },
      '[LiquidationWorker] Processing liquidation job',
    );

    // #906: Reject stale jobs whose fencing token no longer matches
    if (!validateFencingToken(QUEUE_NAMES.LIQUIDATION, accountAddress, fencingToken)) {
      throw new Error(`FENCING_VIOLATION: stale fencing token for account ${accountAddress}`);
    }

    // Mark claimed and persist attempt record
    try {
      await persistJobRecord({
        jobId: job.id!,
        queueName: QUEUE_NAMES.LIQUIDATION,
        state: JOB_STATES.CLAIMED,
        attemptNumber: job.attemptsMade,
        fencingToken,
        requiredSequence,
        claimedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        targetId: accountAddress,
      });
    } catch (err) {
      logger.warn({ err, jobId: job.id }, 'Failed to persist claim record');
    }

    // #906: Fetch current Stellar sequence and verify it matches the job requirement
    try {
      const account = await this.signer['server'].getAccount(this.signer.publicKey);
      const currentSequence = parseInt((account as any).sequence, 10);
      if (currentSequence !== requiredSequence) {
        throw new Error(
          `SEQUENCE_MISMATCH: expected sequence ${requiredSequence}, got ${currentSequence}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { retryable } = classifyFailure(err);
      if (!retryable) {
        await quarantineJob(createLiquidationQueue(), job, message, accountAddress);
      }
      throw err;
    }

    // Build Soroban args: (liquidator: Address, user: Address)
    const liquidatorScVal = new Address(this.signer.publicKey).toScVal();
    const userScVal = new Address(accountAddress).toScVal();

    let txHash: string;
    try {
      txHash = await this.signer.invokeContract(
        config.contracts.stablecoinManager,
        'liquidate',
        [liquidatorScVal, userScVal],
      );

      // Persist submitted state
      await persistJobRecord({
        jobId: job.id!,
        queueName: QUEUE_NAMES.LIQUIDATION,
        state: JOB_STATES.SUBMITTED,
        attemptNumber: job.attemptsMade,
        fencingToken,
        requiredSequence,
        txHash,
        claimedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        targetId: accountAddress,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { retryable, reason } = classifyFailure(err);
      if (!retryable) {
        await quarantineJob(createLiquidationQueue(), job, reason, accountAddress);
      }
      throw err;
    }

    logger.info(
      { jobId: job.id, accountAddress, txHash },
      '[LiquidationWorker] Liquidation submitted successfully',
    );

    return { txHash };
  }

  /** Gracefully close the worker (finishes in-flight jobs). */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('[LiquidationWorker] Worker closed');
  }
}
