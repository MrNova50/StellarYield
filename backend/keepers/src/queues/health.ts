import { Queue } from 'bullmq';
import { getRedisConnectionStatus } from './index';
import { QUEUE_NAMES } from './types';

export interface QueueJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  /** #907: Count of jobs quarantined to the poison queue */
  poison: number;
}

export interface QueueHealthEntry {
  name: string;
  counts: QueueJobCounts;
  status: 'healthy' | 'degraded' | 'outage';
  warnings: string[];
}

export interface QueueHealthSummary {
  queues: QueueHealthEntry[];
  overallStatus: 'healthy' | 'degraded' | 'outage';
  timestamp: string;
  /** #909: Redis connection state derived from latency and errors */
  redisStatus: 'healthy' | 'degraded' | 'outage';
}

export const QUEUE_HEALTH_THRESHOLDS = {
  failed: Number(process.env.QUEUE_FAILED_THRESHOLD ?? '10'),
  delayed: Number(process.env.QUEUE_DELAYED_THRESHOLD ?? '50'),
  /** #907: Retry budget exhaustion warning threshold */
  poison: Number(process.env.QUEUE_POISON_THRESHOLD ?? '5'),
} as const;

export async function getQueueHealth(queues: Queue[]): Promise<QueueHealthSummary> {
  const redisStatus = await getRedisConnectionStatus();

  const entries = await Promise.all(
    queues.map(async (queue): Promise<QueueHealthEntry> => {
      const raw = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      const counts: QueueJobCounts = {
        waiting: raw.waiting ?? 0,
        active: raw.active ?? 0,
        completed: raw.completed ?? 0,
        failed: raw.failed ?? 0,
        delayed: raw.delayed ?? 0,
        poison: 0,
      };

      // Best-effort poison count from the dedicated poison queue
      // Uses BullMQ's internal Queue constructor to avoid type issues with client
      try {
        const { Queue: BullQueue } = require('bullmq');
        const poisonQueue = new BullQueue(QUEUE_NAMES.POISON, { connection: queue.opts?.connection });
        const poisonCounts = await poisonQueue.getJobCounts('waiting', 'active', 'failed');
        counts.poison = (poisonCounts.waiting ?? 0) + (poisonCounts.active ?? 0) + (poisonCounts.failed ?? 0);
      } catch {
        // Ignore if poison queue is unavailable
      }

      const warnings: string[] = [];

      if (counts.failed > QUEUE_HEALTH_THRESHOLDS.failed) {
        warnings.push(
          `failed jobs (${counts.failed}) exceed threshold (${QUEUE_HEALTH_THRESHOLDS.failed})`,
        );
      }
      if (counts.delayed > QUEUE_HEALTH_THRESHOLDS.delayed) {
        warnings.push(
          `delayed jobs (${counts.delayed}) exceed threshold (${QUEUE_HEALTH_THRESHOLDS.delayed})`,
        );
      }
      if (counts.poison > QUEUE_HEALTH_THRESHOLDS.poison) {
        warnings.push(
          `poison jobs (${counts.poison}) exceed threshold (${QUEUE_HEALTH_THRESHOLDS.poison})`,
        );
      }

      // #909: Degrade queue status if Redis is not healthy
      let status: QueueHealthEntry['status'] = 'healthy';
      if (redisStatus === 'outage') {
        status = 'outage';
      } else if (redisStatus === 'degraded' || warnings.length > 0) {
        status = 'degraded';
      }

      return {
        name: queue.name,
        counts,
        status,
        warnings,
      };
    }),
  );

  const overallStatus = redisStatus === 'outage'
    ? 'outage'
    : entries.some((e) => e.status === 'outage')
      ? 'outage'
      : entries.some((e) => e.status === 'degraded')
        ? 'degraded'
        : 'healthy';

  return {
    queues: entries,
    overallStatus,
    timestamp: new Date().toISOString(),
    redisStatus,
  };
}