import { getProductionReadinessHealth } from '../health/productionReadiness';
import { getRedis } from '../utils/redis';

jest.mock('../utils/redis', () => ({
  getRedis: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../../contracts/registry.json', () => ({
  testnet: {
    vault: 'CCW67TSB3SSSBDGRGBXMORAX6P4CBGQLGLKXMFFBVD7OH5VO5BTV6U2M',
    zap: 'CZAP111111111111111111111111111111111111111111111111111111',
    token: 'CTOK111111111111111111111111111111111111111111111111111111',
    governance: 'CGOV111111111111111111111111111111111111111111111111111111',
    strategy: 'CSTR111111111111111111111111111111111111111111111111111111',
    emissionController: 'CEMI111111111111111111111111111111111111111111111111111111',
    liquidStaking: 'CLIQ111111111111111111111111111111111111111111111111111111',
    stableswap: 'CSWA111111111111111111111111111111111111111111111111111111',
    vesting: 'CVES111111111111111111111111111111111111111111111111111111',
  },
  mainnet: {},
  local: {},
}), { virtual: true });

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

function makeMockRedis(overrides: Partial<{ ping: () => Promise<string>; get: (k: string) => Promise<string | null>; llen: (k: string) => Promise<number> }> = {}) {
  return {
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue('500000'),
    llen: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('getProductionReadinessHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STELLAR_NETWORK = 'testnet';
    // Reset fetch mock
    global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as any;
  });

  it('returns healthy when all checks pass', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis() as any);

    const report = await getProductionReadinessHealth();
    expect(report.overallStatus).toBe('healthy');
    expect(report.checks).toHaveLength(6);
    expect(report.timestamp).toBeTruthy();
  });

  it('returns unavailable when redis ping fails', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis({
      ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }) as any);

    const report = await getProductionReadinessHealth();
    const redisCheck = report.checks.find((c) => c.name === 'redis');
    expect(redisCheck?.status).toBe('unavailable');
    expect(report.overallStatus).toBe('unavailable');
  });

  it('returns degraded when indexer ledger key is missing', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis({
      get: jest.fn().mockResolvedValue(null),
    }) as any);

    const report = await getProductionReadinessHealth();
    const indexerCheck = report.checks.find((c) => c.name === 'indexer-lag');
    expect(indexerCheck?.status).toBe('degraded');
    expect(report.overallStatus).toBe('degraded');
  });

  it('returns degraded when queue backlog exceeds threshold', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis({
      llen: jest.fn().mockResolvedValue(300),
    }) as any);

    const report = await getProductionReadinessHealth();
    const queueCheck = report.checks.find((c) => c.name === 'keeper-queues');
    expect(queueCheck?.status).toBe('degraded');
    expect(queueCheck?.detail?.total).toBe(600);
  });

  it('returns unavailable when RPC times out', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' })) as any;
    mockGetRedis.mockReturnValue(makeMockRedis() as any);

    const report = await getProductionReadinessHealth();
    const rpcCheck = report.checks.find((c) => c.name === 'rpc-reachability');
    expect(rpcCheck?.status).toBe('unavailable');
  });

  it('returns unavailable when required env vars are missing', async () => {
    const savedKey = process.env.VAULT_CONTRACT_ID;
    delete process.env.VAULT_CONTRACT_ID;
    mockGetRedis.mockReturnValue(makeMockRedis() as any);

    const report = await getProductionReadinessHealth();
    const configCheck = report.checks.find((c) => c.name === 'client-config');
    expect(configCheck?.status).toBe('unavailable');

    process.env.VAULT_CONTRACT_ID = savedKey;
  });

  it('contract-registry check is healthy when all contracts are in registry', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis() as any);

    const report = await getProductionReadinessHealth();
    const registryCheck = report.checks.find((c) => c.name === 'contract-registry');
    expect(registryCheck?.status).toBe('healthy');
  });

  it('aggregates to worst-of-all-checks overall status', async () => {
    mockGetRedis.mockReturnValue(makeMockRedis({
      ping: jest.fn().mockRejectedValue(new Error('down')),
      get: jest.fn().mockResolvedValue(null),
    }) as any);

    const report = await getProductionReadinessHealth();
    expect(report.overallStatus).toBe('unavailable');
  });
});
