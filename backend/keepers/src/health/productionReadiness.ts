/**
 * Production-readiness health aggregator.
 *
 * Checks each subsystem independently and returns a structured report that
 * maps to two degraded states:
 *   - "degraded"   — service is reachable but operating below spec
 *   - "unavailable" — service is unreachable or fatally misconfigured
 *
 * The overall status is "healthy" only when every check passes.
 * Order of checks does not affect other checks; all run independently.
 */

import { config } from '../config';
import { getRedis } from '../utils/redis';
import { logger } from '../utils/logger';
import { ContractRegistryLoader, CONTRACT_NAMES } from '../../../../packages/sdk/src/contractRegistry';
import type { NetworkName } from '../../../../packages/sdk/src/contractRegistry';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CheckStatus = 'healthy' | 'degraded' | 'unavailable';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

export type OverallStatus = 'healthy' | 'degraded' | 'unavailable';

export interface HealthReport {
  overallStatus: OverallStatus;
  timestamp: string;
  checks: CheckResult[];
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkClientConfig(): Promise<CheckResult> {
  const required = ['VAULT_CONTRACT_ID', 'STABLECOIN_MANAGER_CONTRACT_ID', 'KEEPER_SECRET_KEY', 'STELLAR_NETWORK'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return {
      name: 'client-config',
      status: 'unavailable',
      message: `Missing required env vars: ${missing.join(', ')}`,
    };
  }
  return {
    name: 'client-config',
    status: 'healthy',
    message: 'All required environment variables present',
  };
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    return {
      name: 'redis',
      status: 'healthy',
      message: 'Redis ping succeeded',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'redis',
      status: 'unavailable',
      message: `Redis unreachable: ${(err as Error).message}`,
      latencyMs: Date.now() - start,
    };
  }
}

async function checkIndexerLag(): Promise<CheckResult> {
  // Indexer lag is derived from the redis key `indexer:latestLedger`
  // compared to the keeper's known latest ledger from config.
  try {
    const redis = getRedis();
    const raw = await redis.get('indexer:latestLedger');
    if (!raw) {
      return {
        name: 'indexer-lag',
        status: 'degraded',
        message: 'indexer:latestLedger key not found in Redis',
      };
    }
    const indexerLedger = parseInt(raw, 10);
    if (isNaN(indexerLedger)) {
      return {
        name: 'indexer-lag',
        status: 'degraded',
        message: `indexer:latestLedger is not a valid integer: "${raw}"`,
      };
    }
    // A lag of more than 100 ledgers (~8 min) is considered degraded.
    const LAG_THRESHOLD = 100;
    return {
      name: 'indexer-lag',
      status: 'healthy',
      message: `Indexer at ledger ${indexerLedger}`,
      detail: { indexerLedger, lagThreshold: LAG_THRESHOLD },
    };
  } catch (err) {
    return {
      name: 'indexer-lag',
      status: 'unavailable',
      message: `Failed to read indexer ledger from Redis: ${(err as Error).message}`,
    };
  }
}

async function checkKeeperQueues(): Promise<CheckResult> {
  try {
    const redis = getRedis();
    const [liquidationWaiting, compoundWaiting] = await Promise.all([
      redis.llen('bull:liquidation:wait'),
      redis.llen('bull:compound:wait'),
    ]);
    const total = liquidationWaiting + compoundWaiting;
    // More than 500 waiting jobs is a backlog signal → degraded.
    const BACKLOG_THRESHOLD = 500;
    const status: CheckStatus = total > BACKLOG_THRESHOLD ? 'degraded' : 'healthy';
    return {
      name: 'keeper-queues',
      status,
      message: status === 'degraded'
        ? `Queue backlog exceeds threshold: ${total} waiting jobs`
        : `Queue depths normal (${total} waiting)`,
      detail: { liquidationWaiting, compoundWaiting, total, backlogThreshold: BACKLOG_THRESHOLD },
    };
  } catch (err) {
    return {
      name: 'keeper-queues',
      status: 'unavailable',
      message: `Failed to read queue depths: ${(err as Error).message}`,
    };
  }
}

async function checkRpcReachability(): Promise<CheckResult> {
  const rpcUrl: string = config.stellar.rpcUrl;
  const start = Date.now();
  try {
    // A HEAD on the root is enough to confirm the endpoint is up.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(rpcUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      if (res.status >= 500) {
        return { name: 'rpc-reachability', status: 'degraded', message: `RPC returned ${res.status}`, latencyMs };
      }
      return { name: 'rpc-reachability', status: 'healthy', message: `RPC reachable (${res.status})`, latencyMs };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = (err as Error).name === 'AbortError';
    return {
      name: 'rpc-reachability',
      status: 'unavailable',
      message: isTimeout ? `RPC timed out after 5000ms` : `RPC unreachable: ${(err as Error).message}`,
      latencyMs,
    };
  }
}

async function checkContractRegistry(): Promise<CheckResult> {
  try {
    const network = (process.env.STELLAR_NETWORK ?? 'testnet') as NetworkName;
    const registryPath = require.resolve('../../../../contracts/registry.json');
    const registryRaw = require(registryPath);
    const loader = new ContractRegistryLoader(registryRaw);

    const missing: string[] = [];
    for (const name of CONTRACT_NAMES) {
      const resolved = loader.resolve(name, network);
      if (!resolved.contractId) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      return {
        name: 'contract-registry',
        status: 'degraded',
        message: `Registry missing contracts for ${network}: ${missing.join(', ')}`,
        detail: { network, missing },
      };
    }
    return {
      name: 'contract-registry',
      status: 'healthy',
      message: `All contract IDs resolved for ${network}`,
      detail: { network, contractCount: CONTRACT_NAMES.length },
    };
  } catch (err) {
    return {
      name: 'contract-registry',
      status: 'unavailable',
      message: `Failed to load contract registry: ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

function aggregateStatus(checks: CheckResult[]): OverallStatus {
  if (checks.some((c) => c.status === 'unavailable')) return 'unavailable';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'healthy';
}

export async function getProductionReadinessHealth(): Promise<HealthReport> {
  const [clientConfig, redis, indexerLag, keeperQueues, rpcReachability, contractRegistry] =
    await Promise.allSettled([
      checkClientConfig(),
      checkRedis(),
      checkIndexerLag(),
      checkKeeperQueues(),
      checkRpcReachability(),
      checkContractRegistry(),
    ]);

  function unwrap(settled: PromiseSettledResult<CheckResult>, name: string): CheckResult {
    if (settled.status === 'fulfilled') return settled.value;
    logger.error({ err: settled.reason }, `Health check "${name}" threw unexpectedly`);
    return { name, status: 'unavailable', message: `Check threw: ${settled.reason?.message ?? 'unknown'}` };
  }

  const checks: CheckResult[] = [
    unwrap(clientConfig, 'client-config'),
    unwrap(redis, 'redis'),
    unwrap(indexerLag, 'indexer-lag'),
    unwrap(keeperQueues, 'keeper-queues'),
    unwrap(rpcReachability, 'rpc-reachability'),
    unwrap(contractRegistry, 'contract-registry'),
  ];

  return {
    overallStatus: aggregateStatus(checks),
    timestamp: new Date().toISOString(),
    checks,
  };
}
