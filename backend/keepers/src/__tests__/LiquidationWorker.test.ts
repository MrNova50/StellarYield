import { LiquidationWorker, evaluateLiquidationDryRun, MAX_PRICE_AGE_MS } from '../workers/LiquidationWorker';
import { KeeperSigner } from '../signer/KeeperSigner';
import { Job } from 'bullmq';
import { LiquidationJobData } from '../queues/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../utils/redis', () => ({
  getRedis: jest.fn().mockReturnValue({ status: 'ready', on: jest.fn() }),
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, _processor: unknown, _opts: unknown) => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: jest.fn().mockResolvedValue({ id: 'poison-job' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Address: jest.fn().mockImplementation((addr: string) => ({
    toScVal: jest.fn().mockReturnValue({ type: 'address', value: addr }),
  })),
  nativeToScVal: jest.fn().mockReturnValue({ type: 'i128', value: 0n }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LiquidationWorker', () => {
  let mockSigner: any;
  let worker: LiquidationWorker;

  const sampleJobData: LiquidationJobData = {
    accountAddress: 'GACCOUNT_123',
    currentCrBps: 10500,
    collateralValueUsd: '1000000000',
    debtAmount: '500000000',
    fencingToken: 0,
    requiredSequence: 42,
  };

  beforeEach(() => {
    mockSigner = {
      publicKey: 'GKEEPER123',
      invokeContract: jest.fn().mockResolvedValue('LIQUIDATION_TX_HASH'),
      server: {
        getAccount: jest.fn().mockResolvedValue({ sequence: '42' }),
      },
    };

    worker = new LiquidationWorker(mockSigner);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── process() ────────────────────────────────────────────────────────────────

  test('process() calls invokeContract with "liquidate" method and correct contract', async () => {
    const mockJob = {
      id: 'job-liq-1',
      data: sampleJobData,
      attemptsMade: 0,
    } as Job<LiquidationJobData>;

    const result = await worker.process(mockJob);

    expect(mockSigner.invokeContract).toHaveBeenCalledWith(
      expect.any(String),
      'liquidate',
      expect.arrayContaining([expect.anything(), expect.anything()]),
      expect.objectContaining({ workerName: 'LiquidationWorker', jobId: '1' }),
    );
    expect(result).toEqual({ txHash: 'LIQUIDATION_TX_HASH' });
  });

  test('process() passes keeper public key as first arg', async () => {
    const mockJob = { id: 'job-liq-2', data: sampleJobData, attemptsMade: 0 } as Job<LiquidationJobData>;
    await worker.process(mockJob);

    const { Address } = require('@stellar/stellar-sdk');
    expect(Address).toHaveBeenCalledWith('GKEEPER123');
  });

  test('process() verifies Stellar sequence before submission', async () => {
    const mockJob = {
      id: 'job-liq-4',
      data: { ...sampleJobData, requiredSequence: 999 },
      attemptsMade: 0,
    } as Job<LiquidationJobData>;

    mockSigner.server.getAccount = jest.fn().mockResolvedValue({ sequence: '42' });

    await expect(worker.process(mockJob)).rejects.toThrow('SEQUENCE_MISMATCH');
  });

  test('process() propagates errors from invokeContract (triggers retry/quarantine)', async () => {
    mockSigner.invokeContract.mockRejectedValue(new Error('Contract reverted: liquidation error'));

    await expect(
      worker.process({ id: 'job-liq-5', data: sampleJobData, attemptsMade: 0 } as Job<LiquidationJobData>),
    ).rejects.toThrow('Contract reverted: liquidation error');
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

  test('Worker "failed" event logs job ID and error without throwing', () => {
    const { Worker } = require('bullmq');
    const workerInstance = Worker.mock.results[0].value;
    const onCalls = (workerInstance.on as any).mock.calls;

    const failedHandler = onCalls.find(([event]: [string]) => event === 'failed')?.[1];
    expect(failedHandler).toBeDefined();
    expect(() => failedHandler(null, new Error('liquidation failed'))).not.toThrow();
    expect(() => failedHandler({ id: 'lj2', data: sampleJobData }, new Error('undercollateralized'))).not.toThrow();
  });
});