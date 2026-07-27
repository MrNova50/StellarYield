/**
 * Governance forecast checkpoints (issue #1091).
 *
 * A checkpoint models a scheduled change window a maintainer needs to
 * prepare for (lining up signers, drafting notes) ahead of a governance
 * proposal taking effect. This module is deliberately independent of
 * governanceForecastService.ts's yield/exposure modeling — checkpoints are
 * a scheduling concern, not a forecast-math concern — so either can change
 * without the other.
 */

export type CheckpointStatus = "completed" | "overdue" | "due_soon" | "upcoming";

export interface GovernanceForecastCheckpoint {
  id: string;
  label: string;
  /** When the change window this checkpoint prepares for begins. */
  changeWindowStart: Date;
  /** Set once a maintainer has completed the prep work for this checkpoint. */
  completedAt?: Date;
}

export interface CheckpointReminder extends GovernanceForecastCheckpoint {
  status: CheckpointStatus;
  /** Milliseconds until changeWindowStart; negative once it has passed. */
  msUntilChangeWindow: number;
}

/** Change windows within this many ms are surfaced as "due_soon" rather than "upcoming". */
export const DEFAULT_DUE_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export function checkpointStatus(
  checkpoint: GovernanceForecastCheckpoint,
  now: Date,
  dueSoonWindowMs: number = DEFAULT_DUE_SOON_WINDOW_MS,
): CheckpointStatus {
  if (checkpoint.completedAt) return "completed";

  const msUntil = checkpoint.changeWindowStart.getTime() - now.getTime();
  if (msUntil < 0) return "overdue";
  if (msUntil <= dueSoonWindowMs) return "due_soon";
  return "upcoming";
}

/**
 * Attaches a reminder status to each checkpoint, sorted so overdue
 * checkpoints surface first, then due-soon, then upcoming, then completed —
 * within each group, the earliest change window comes first.
 */
export function summarizeCheckpoints(
  checkpoints: GovernanceForecastCheckpoint[],
  now: Date = new Date(),
  dueSoonWindowMs: number = DEFAULT_DUE_SOON_WINDOW_MS,
): CheckpointReminder[] {
  const statusRank: Record<CheckpointStatus, number> = {
    overdue: 0,
    due_soon: 1,
    upcoming: 2,
    completed: 3,
  };

  return checkpoints
    .map((checkpoint) => ({
      ...checkpoint,
      status: checkpointStatus(checkpoint, now, dueSoonWindowMs),
      msUntilChangeWindow: checkpoint.changeWindowStart.getTime() - now.getTime(),
    }))
    .sort((a, b) => {
      const rankDiff = statusRank[a.status] - statusRank[b.status];
      if (rankDiff !== 0) return rankDiff;
      return a.changeWindowStart.getTime() - b.changeWindowStart.getTime();
    });
}

/** Convenience filter for surfacing only checkpoints that need attention now. */
export function overdueCheckpoints(reminders: CheckpointReminder[]): CheckpointReminder[] {
  return reminders.filter((r) => r.status === "overdue");
}
