import { getProviderRetryMetadata, RetryBudgetMetadata } from "../agents/resilientFetch";

/**
 * Source freshness and health classification (#1107, #1041).
 *
 * Classifies how trustworthy a data source's last fetch is:
 *   - "fresh"     — fetched within the fresh window
 *   - "stale"     — fetched, but longer ago than the fresh window
 *   - "exhausted" — provider fetch failed and exhausted its retry budget
 *   - "unknown"   — no fetch timestamp available at all
 */

export type FreshnessStatus = "fresh" | "stale" | "unknown" | "exhausted";

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
  /** Structured retry budget metadata if available. */
  retryBudget?: RetryBudgetMetadata;
}

/**
 * Classify a source's freshness from its last-fetched timestamp and retry status.
 *
 * @param fetchedAt ISO-8601 timestamp of the last successful fetch, or
 *   null/undefined if the source has never reported one.
 * @param now Reference "current" time (defaults to `new Date()`).
 * @param thresholds Freshness threshold configuration.
 * @param providerId Optional provider key to inspect for retry budget exhaustion.
 * @param isExhausted Explicit override flag indicating retry budget exhaustion.
 */
export function computeFreshnessStatus(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
  providerId?: string,
  isExhausted?: boolean,
): FreshnessResult {
  const retryBudget = providerId ? getProviderRetryMetadata(providerId) : undefined;
  const exhausted = isExhausted ?? retryBudget?.exhausted ?? false;

  if (exhausted) {
    const parsed = fetchedAt ? new Date(fetchedAt) : null;
    const validDate = parsed && !Number.isNaN(parsed.getTime());
    const ageSeconds = validDate ? Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 1000)) : null;
    return {
      status: "exhausted",
      ageSeconds,
      fetchedAt: validDate ? parsed.toISOString() : null,
      retryBudget,
    };
  }

  if (!fetchedAt) {
    return { status: "unknown", ageSeconds: null, fetchedAt: null, retryBudget };
  }

  const parsed = new Date(fetchedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { status: "unknown", ageSeconds: null, fetchedAt: null, retryBudget };
  }

  const ageMs = now.getTime() - parsed.getTime();
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
  const status: FreshnessStatus = ageMs <= thresholds.freshWindowMs ? "fresh" : "stale";

  return { status, ageSeconds, fetchedAt: parsed.toISOString(), retryBudget };
}