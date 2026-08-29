/**
 * Source freshness classification (#1107).
 *
 * Classifies how trustworthy a data source's last fetch is, so portfolio
 * holdings rows and exported reports can show a consistent badge. Three
 * states:
 *   - "fresh"   — fetched within the fresh window
 *   - "stale"   — fetched, but longer ago than the fresh window
 *   - "unknown" — no fetch timestamp available at all (never fetched, or
 *                 an unparseable timestamp)
 */

export type FreshnessStatus = "fresh" | "stale" | "unknown";

export interface FreshnessThresholds {
  /** Age (ms) at or below which a source counts as fresh. */
  freshWindowMs: number;
}

/** 5 minutes — matches the stale convention already used in ApyHistoryChart. */
export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  freshWindowMs: 5 * 60 * 1000,
};

export interface FreshnessResult {
  status: FreshnessStatus;
  /** Age of the data in seconds, or null when fetchedAt is unknown. */
  ageSeconds: number | null;
  /** The evaluated fetchedAt timestamp (normalized to ISO-8601), or null if absent/invalid. */
  fetchedAt: string | null;
}

/**
 * Classify a source's freshness from its last-fetched timestamp.
 *
 * @param fetchedAt ISO-8601 timestamp of the last successful fetch, or
 *   null/undefined if the source has never reported one.
 * @param now Reference "current" time (defaults to `new Date()`).
 */
export function computeFreshnessStatus(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessResult {
  if (!fetchedAt) {
    return { status: "unknown", ageSeconds: null, fetchedAt: null };
  }

  const parsed = new Date(fetchedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { status: "unknown", ageSeconds: null, fetchedAt: null };
  }

  const ageMs = now.getTime() - parsed.getTime();
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
  const status: FreshnessStatus = ageMs <= thresholds.freshWindowMs ? "fresh" : "stale";

  return { status, ageSeconds, fetchedAt: parsed.toISOString() };
}