import { Queue } from 'bullmq';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw job-state counts for a single queue.
 *
 * `pending`   — jobs waiting in the queue (BullMQ "waiting" state).
 * `delayed`   — jobs deferred until a future timestamp.
 * `active`    — jobs currently being processed by a worker.
 * `completed` — jobs that finished successfully.
 * `failed`    — jobs that threw an error on their last attempt (but may still
 *               be retried if `attempts` budget remains).
 * `poison`    — jobs that have permanently exhausted all retry attempts and
 *               will never be processed again without manual intervention.
 */
export interface QueueJobCounts {
  pending: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
  poison: number;
}

/**
 * Metrics that go beyond simple counts — these help operators understand
 * *how stale* the backlog is and *why* the most recent failure occurred.
 */
export interface QueueQualityMetrics {
  /**
   * Age in milliseconds of the oldest job currently in the `pending` state.
   * `null` when there are no pending jobs.
   */
  oldestPendingAgeMs: number | null;
  /**
   * The `failedReason` string from the most recently failed job.
   * `null` when no failed jobs exist in the queue.
   */
  latestFailureReason: string | null;
}

export interface QueueHealthEntry {
  name: string;
  counts: QueueJobCounts;
  metrics: QueueQualityMetrics;
  status: 'healthy' | 'warning';
  warnings: string[];
}

export interface QueueHealthSummary {
  /** One entry per queue passed to `getQueueHealth`. */
  queues: QueueHealthEntry[];
  /**
   * Per-worker queue entries keyed by worker name.
   * Provides the same structure as `queues` but scoped to named workers so
   * dashboards can render compound vs. liquidation metrics side-by-side.
   */
  workers: Record<string, QueueHealthEntry>;
  overallStatus: 'healthy' | 'warning';
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Thresholds (overridable via environment variables)
// ---------------------------------------------------------------------------

export const QUEUE_HEALTH_THRESHOLDS = {
  /** Maximum number of failed jobs before a `warning` is emitted. */
  failed: Number(process.env.QUEUE_FAILED_THRESHOLD ?? '10'),
  /** Maximum number of delayed jobs before a `warning` is emitted. */
  delayed: Number(process.env.QUEUE_DELAYED_THRESHOLD ?? '50'),
  /** Maximum number of pending (waiting) jobs before a `warning` is emitted. */
  pending: Number(process.env.QUEUE_PENDING_THRESHOLD ?? '100'),
  /** Maximum number of poison jobs before a `warning` is emitted. */
  poison: Number(process.env.QUEUE_POISON_THRESHOLD ?? '5'),
  /**
   * Maximum age (ms) of the oldest pending job before a `warning` is emitted.
   * Default: 30 minutes.
   */
  oldestPendingAgeMs: Number(process.env.QUEUE_OLDEST_PENDING_AGE_MS ?? String(30 * 60 * 1000)),
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count how many jobs in the failed set have permanently exhausted all
 * configured retry attempts — these are "poison" jobs.
 *
 * BullMQ does not have a first-class "poison" queue state; we derive it by
 * inspecting `job.attemptsMade` against `job.opts.attempts`.
 *
 * We inspect at most `maxScan` failed jobs to bound the cost of this check.
 */
async function getPoisonCount(queue: Queue, maxScan = 500): Promise<number> {
  try {
    const failed = await queue.getFailed(0, maxScan - 1);
    return failed.filter((job) => {
      const attempts = job.opts?.attempts ?? 1;
      return job.attemptsMade >= attempts;
    }).length;
  } catch {
    // If getFailed is unavailable (e.g. in tests with minimal mocks), default to 0.
    return 0;
  }
}

/**
 * Retrieve the oldest pending job's age in milliseconds by inspecting the
 * first job in the waiting list.  Returns `null` when there are no pending
 * jobs or when the timestamp cannot be determined.
 */
async function getOldestPendingAgeMs(queue: Queue, nowMs: number): Promise<number | null> {
  try {
    const waiting = await queue.getWaiting(0, 0); // first job only
    if (waiting.length === 0) return null;
    const job = waiting[0];
    const ts = job.timestamp; // BullMQ sets this at enqueue time (unix ms)
    if (typeof ts !== 'number' || ts <= 0) return null;
    return Math.max(0, nowMs - ts);
  } catch {
    return null;
  }
}

/**
 * Retrieve the `failedReason` from the most recently failed job.
 * BullMQ stores failed jobs in reverse-chronological order, so the first
 * result is the most recent failure.
 */
async function getLatestFailureReason(queue: Queue): Promise<string | null> {
  try {
    const failed = await queue.getFailed(0, 0); // most recent failure only
    if (failed.length === 0) return null;
    return (failed[0].failedReason as string | undefined) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Collect counts, quality metrics, and threshold-based warnings for every
 * queue in the supplied list, then return an aggregated summary.
 *
 * Also builds a `workers` map that mirrors the same data keyed by the
 * convention `"<queueName>Worker"` so callers can address metrics for the
 * compound and liquidation workers explicitly.
 */
export async function getQueueHealth(queues: Queue[]): Promise<QueueHealthSummary> {
  const nowMs = Date.now();
  const t = QUEUE_HEALTH_THRESHOLDS;

  const entries = await Promise.all(
    queues.map(async (queue): Promise<QueueHealthEntry> => {
      // ── Job counts ────────────────────────────────────────────────────────
      const raw = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );

      const poisonCount = await getPoisonCount(queue);

      const counts: QueueJobCounts = {
        pending: raw.waiting ?? 0,
        delayed: raw.delayed ?? 0,
        active: raw.active ?? 0,
        completed: raw.completed ?? 0,
        failed: raw.failed ?? 0,
        poison: poisonCount,
      };

      // ── Quality metrics ───────────────────────────────────────────────────
      const [oldestPendingAgeMs, latestFailureReason] = await Promise.all([
        counts.pending > 0 ? getOldestPendingAgeMs(queue, nowMs) : Promise.resolve(null),
        counts.failed > 0 ? getLatestFailureReason(queue) : Promise.resolve(null),
      ]);

      const metrics: QueueQualityMetrics = {
        oldestPendingAgeMs,
        latestFailureReason,
      };

      // ── Threshold warnings ────────────────────────────────────────────────
      const warnings: string[] = [];

      if (counts.failed > t.failed) {
        warnings.push(
          `failed jobs (${counts.failed}) exceed threshold (${t.failed})`,
        );
      }
      if (counts.delayed > t.delayed) {
        warnings.push(
          `delayed jobs (${counts.delayed}) exceed threshold (${t.delayed})`,
        );
      }
      if (counts.pending > t.pending) {
        warnings.push(
          `pending jobs (${counts.pending}) exceed threshold (${t.pending})`,
        );
      }
      if (counts.poison > t.poison) {
        warnings.push(
          `poison jobs (${counts.poison}) exceed threshold (${t.poison}) — manual intervention required`,
        );
      }
      if (
        oldestPendingAgeMs !== null &&
        oldestPendingAgeMs > t.oldestPendingAgeMs
      ) {
        warnings.push(
          `oldest pending job is ${Math.round(oldestPendingAgeMs / 1000)}s old (threshold ${Math.round(t.oldestPendingAgeMs / 1000)}s)`,
        );
      }

      return {
        name: queue.name,
        counts,
        metrics,
        status: warnings.length > 0 ? 'warning' : 'healthy',
        warnings,
      };
    }),
  );

  // ── Per-worker map ─────────────────────────────────────────────────────────
  // Convention: "liquidation" → "liquidationWorker", "compound" → "compoundWorker"
  const workers: Record<string, QueueHealthEntry> = {};
  for (const entry of entries) {
    const workerKey = `${entry.name}Worker`;
    workers[workerKey] = entry;
  }

  return {
    queues: entries,
    workers,
    overallStatus: entries.some((e) => e.status === 'warning') ? 'warning' : 'healthy',
    timestamp: new Date().toISOString(),
  };
}
