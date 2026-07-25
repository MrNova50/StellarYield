import { LiquidationWorker, evaluateLiquidationDryRun, MAX_PRICE_AGE_MS } from '../workers/LiquidationWorker';
import { KeeperSigner } from '../signer/KeeperSigner';
import { Job } from 'bullmq';
import { LiquidationJobData } from '../queues/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../utils/redis', () => ({
  getRedis: jest.fn().mockReturnValue({ status: 'ready', on: jest.fn() }),
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name, _processor, _opts) => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Address: jest.fn().mockImplementation((addr) => ({
    toScVal: jest.fn().mockReturnValue({ type: 'address', value: addr }),
  })),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LiquidationWorker', () => {
  let mockSigner: jest.Mocked<KeeperSigner>;
  let worker: LiquidationWorker;

  const sampleJobData: LiquidationJobData = {
    accountAddress: 'GUNDERCOLLATERALIZED',
    currentCrBps: 9500,
    collateralValueUsd: '100000',
    debtAmount: '50000',
  };

  beforeEach(() => {
    mockSigner = {
      publicKey: 'GKEEPER123',
      invokeContract: jest.fn().mockResolvedValue('TX_HASH_ABC123'),
    } as unknown as jest.Mocked<KeeperSigner>;

    worker = new LiquidationWorker(mockSigner);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('process() calls invokeContract with correct method and args', async () => {
    const mockJob = {
      id: '1',
      data: sampleJobData,
    } as Job<LiquidationJobData>;

    const result = await worker.process(mockJob);

    expect(mockSigner.invokeContract).toHaveBeenCalledWith(
      expect.any(String), // contract ID from config
      'liquidate',
      expect.arrayContaining([expect.anything(), expect.anything()]),
      expect.objectContaining({ workerName: 'LiquidationWorker', jobId: '1' }),
    );
    expect(result).toEqual({ txHash: 'TX_HASH_ABC123' });
  });

  test('process() returns the transaction hash on success', async () => {
    mockSigner.invokeContract.mockResolvedValue('DEADBEEF_TX_HASH');

    const mockJob = { id: '2', data: sampleJobData } as Job<LiquidationJobData>;
    const result = await worker.process(mockJob);

    expect(result.txHash).toBe('DEADBEEF_TX_HASH');
  });

  test('process() propagates errors from invokeContract (triggers BullMQ retry)', async () => {
    mockSigner.invokeContract.mockRejectedValue(new Error('Simulation failed'));

    const mockJob = { id: '3', data: sampleJobData } as Job<LiquidationJobData>;

    await expect(worker.process(mockJob)).rejects.toThrow('Simulation failed');
  });

  // ── Dry-run policy fixtures (issue #986) ────────────────────────────────
  // Deterministic job-data fixtures covering the unsafe-collateral states
  // the dry-run policy must classify before a liquidation is ever submitted.
  const dryRunFixtures = {
    underCollateralized: {
      ...sampleJobData,
      currentCrBps: 9_500, // below MCR_BPS (11_000) — eligible
      priceTimestampMs: Date.now(),
      oracleAvailable: true,
    } satisfies LiquidationJobData,
    healthy: {
      ...sampleJobData,
      currentCrBps: 12_000, // at/above MCR_BPS — not eligible
      priceTimestampMs: Date.now(),
      oracleAvailable: true,
    } satisfies LiquidationJobData,
    stalePrice: {
      ...sampleJobData,
      currentCrBps: 9_500,
      priceTimestampMs: Date.now() - (MAX_PRICE_AGE_MS + 1_000),
      oracleAvailable: true,
    } satisfies LiquidationJobData,
    missingOracle: {
      ...sampleJobData,
      currentCrBps: 9_500,
      priceTimestampMs: Date.now(),
      oracleAvailable: false,
    } satisfies LiquidationJobData,
  };

  describe('evaluateLiquidationDryRun()', () => {
    test('under-collateralized state with a fresh oracle price is safe', () => {
      const result = evaluateLiquidationDryRun(dryRunFixtures.underCollateralized);
      expect(result.safe).toBe(true);
    });

    test('healthy position (CR >= MCR) is blocked', () => {
      const result = evaluateLiquidationDryRun(dryRunFixtures.healthy);
      expect(result).toEqual({ safe: false, reason: 'healthy_position' });
    });

    test('stale oracle price is blocked even when under-collateralized', () => {
      const result = evaluateLiquidationDryRun(dryRunFixtures.stalePrice);
      expect(result).toEqual({ safe: false, reason: 'stale_price' });
    });

    test('missing oracle is blocked regardless of CR', () => {
      const result = evaluateLiquidationDryRun(dryRunFixtures.missingOracle);
      expect(result).toEqual({ safe: false, reason: 'missing_oracle' });
    });

    test('missing priceTimestampMs does not itself block (no provenance attached)', () => {
      const { priceTimestampMs, ...rest } = dryRunFixtures.underCollateralized;
      const result = evaluateLiquidationDryRun(rest as LiquidationJobData);
      expect(result.safe).toBe(true);
    });
  });

  test('process() submits the liquidation for an under-collateralized fixture', async () => {
    const mockJob = { id: '4', data: dryRunFixtures.underCollateralized } as Job<LiquidationJobData>;

    const result = await worker.process(mockJob);

    expect(mockSigner.invokeContract).toHaveBeenCalled();
    expect(result).toEqual({ txHash: 'TX_HASH_ABC123' });
  });

  test('process() blocks live submission for a healthy position and never calls invokeContract', async () => {
    const mockJob = { id: '5', data: dryRunFixtures.healthy } as Job<LiquidationJobData>;

    await expect(worker.process(mockJob)).rejects.toThrow('Liquidation blocked by dry-run policy: healthy_position');
    expect(mockSigner.invokeContract).not.toHaveBeenCalled();
  });

  test('process() blocks live submission for a stale price and never calls invokeContract', async () => {
    const mockJob = { id: '6', data: dryRunFixtures.stalePrice } as Job<LiquidationJobData>;

    await expect(worker.process(mockJob)).rejects.toThrow('Liquidation blocked by dry-run policy: stale_price');
    expect(mockSigner.invokeContract).not.toHaveBeenCalled();
  });

  test('process() blocks live submission for a missing oracle and never calls invokeContract', async () => {
    const mockJob = { id: '7', data: dryRunFixtures.missingOracle } as Job<LiquidationJobData>;

    await expect(worker.process(mockJob)).rejects.toThrow('Liquidation blocked by dry-run policy: missing_oracle');
    expect(mockSigner.invokeContract).not.toHaveBeenCalled();
  });

  test('close() closes the underlying BullMQ worker', async () => {
    await worker.close();
    const { Worker } = require('bullmq');
    const workerInstance = Worker.mock.results[0].value;
    expect(workerInstance.close).toHaveBeenCalled();
  });

  // ── Event callbacks ──────────────────────────────────────────────────────────

  test('Worker "completed" event logs the job ID and account address', () => {
    const { Worker } = require('bullmq');
    const workerInstance = Worker.mock.results[0].value;
    const onCalls = (workerInstance.on as jest.Mock).mock.calls;

    const completedHandler = onCalls.find(([event]: [string]) => event === 'completed')?.[1];
    expect(completedHandler).toBeDefined();
    // Should not throw when invoked with a completed job
    expect(() => completedHandler({ id: 'j1', data: sampleJobData })).not.toThrow();
  });

  test('Worker "failed" event logs the job ID and error', () => {
    const { Worker } = require('bullmq');
    const workerInstance = Worker.mock.results[0].value;
    const onCalls = (workerInstance.on as jest.Mock).mock.calls;

    const failedHandler = onCalls.find(([event]: [string]) => event === 'failed')?.[1];
    expect(failedHandler).toBeDefined();
    // Should not throw even when called with null job (e.g. stalled jobs)
    expect(() => failedHandler(null, new Error('timeout'))).not.toThrow();
    expect(() => failedHandler({ id: 'j2', data: sampleJobData }, new Error('rpc error'))).not.toThrow();
  });
});
