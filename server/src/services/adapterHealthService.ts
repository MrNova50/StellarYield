/**
 * Adapter Health Service (#937)
 *
 * Scores live protocol-adapter evidence (freshness, schema support,
 * latency, error rate) into a health snapshot, and derives compatibility
 * issues from that evidence instead of mock feature/breaking-change checks.
 * Snapshots are persisted in-memory for trend analysis.
 */

export interface AdapterEvidence {
  protocolName: string;
  component: string;
  /** ISO timestamp of the last successful adapter response. */
  lastSuccessAt: string;
  /** Latency of the most recent adapter call, in milliseconds. */
  latencyMs: number;
  /** Rolling error rate over the adapter's recent call window, 0-100. */
  errorRatePct: number;
  /** Schema version the adapter reported. */
  schemaVersion: string;
  /** Schema version the compatibility engine expects. */
  expectedSchemaVersion: string;
}

export type AdapterHealthStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "schema-mismatch";

export interface AdapterHealthSnapshot {
  protocolName: string;
  component: string;
  status: AdapterHealthStatus;
  /** 0 (worst) – 100 (best) composite health score. */
  score: number;
  freshnessMs: number;
  latencyMs: number;
  errorRatePct: number;
  schemaMatch: boolean;
  reasons: string[];
  capturedAt: string;
}

export interface DerivedHealthIssue {
  severity: "critical" | "high" | "medium" | "low";
  component: string;
  issue: string;
  impact: string;
  recommendation: string;
}

// ── Thresholds ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const UNAVAILABLE_STALE_MULTIPLIER = 6; // 30 minutes with no success => unavailable
const LATENCY_DEGRADED_MS = 2000;
const ERROR_RATE_DEGRADED_PCT = 5;
const ERROR_RATE_UNAVAILABLE_PCT = 100;
const DEGRADED_SCORE_THRESHOLD = 70;

// ── Snapshot persistence (in-memory; swap for a durable store later) ────

const MAX_HISTORY_PER_KEY = 500;
const snapshots: AdapterHealthSnapshot[] = [];

function snapshotKey(protocolName: string, component: string): string {
  return `${protocolName}::${component}`;
}

/**
 * Score adapter evidence into a health snapshot and persist it for
 * trend analysis. Pure scoring logic lives here so callers (route
 * handlers, keepers, tests) get identical results.
 */
export function scoreAdapterHealth(
  evidence: AdapterEvidence,
  now: number = Date.now(),
): AdapterHealthSnapshot {
  const reasons: string[] = [];
  const freshnessMs = Math.max(0, now - new Date(evidence.lastSuccessAt).getTime());
  const schemaMatch = evidence.schemaVersion === evidence.expectedSchemaVersion;

  if (!schemaMatch) {
    reasons.push(
      `schema mismatch: expected ${evidence.expectedSchemaVersion}, got ${evidence.schemaVersion}`,
    );
  }
  if (freshnessMs > STALE_THRESHOLD_MS) {
    reasons.push(`stale data: last success ${Math.round(freshnessMs / 1000)}s ago`);
  }
  if (evidence.latencyMs > LATENCY_DEGRADED_MS) {
    reasons.push(`elevated latency: ${evidence.latencyMs}ms`);
  }
  if (evidence.errorRatePct > ERROR_RATE_DEGRADED_PCT) {
    reasons.push(`elevated error rate: ${evidence.errorRatePct}%`);
  }

  let score = 100;
  score -= Math.min(40, (freshnessMs / STALE_THRESHOLD_MS) * 20);
  score -= Math.min(30, (evidence.latencyMs / LATENCY_DEGRADED_MS) * 15);
  score -= Math.min(30, evidence.errorRatePct * 3);
  if (!schemaMatch) score -= 40;
  score = Math.max(0, Math.round(score));

  const isUnavailable =
    evidence.errorRatePct >= ERROR_RATE_UNAVAILABLE_PCT ||
    freshnessMs > STALE_THRESHOLD_MS * UNAVAILABLE_STALE_MULTIPLIER;

  let status: AdapterHealthStatus;
  if (isUnavailable) {
    status = "unavailable";
    reasons.unshift("adapter unavailable");
  } else if (!schemaMatch) {
    status = "schema-mismatch";
  } else if (score < DEGRADED_SCORE_THRESHOLD) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  const snapshot: AdapterHealthSnapshot = {
    protocolName: evidence.protocolName,
    component: evidence.component,
    status,
    score,
    freshnessMs,
    latencyMs: evidence.latencyMs,
    errorRatePct: evidence.errorRatePct,
    schemaMatch,
    reasons,
    capturedAt: new Date(now).toISOString(),
  };

  snapshots.push(snapshot);
  const forKey = snapshots.filter(
    (s) => snapshotKey(s.protocolName, s.component) === snapshotKey(evidence.protocolName, evidence.component),
  );
  if (forKey.length > MAX_HISTORY_PER_KEY) {
    const excess = forKey.length - MAX_HISTORY_PER_KEY;
    let removed = 0;
    for (let i = 0; i < snapshots.length && removed < excess; ) {
      if (snapshotKey(snapshots[i].protocolName, snapshots[i].component) === snapshotKey(evidence.protocolName, evidence.component)) {
        snapshots.splice(i, 1);
        removed++;
      } else {
        i++;
      }
    }
  }

  return snapshot;
}

/** Retrieve persisted health snapshots for trend analysis, newest last. */
export function getHealthHistory(
  protocolName?: string,
  component?: string,
): AdapterHealthSnapshot[] {
  return snapshots.filter(
    (s) =>
      (!protocolName || s.protocolName === protocolName) &&
      (!component || s.component === component),
  );
}

/** Test-only: clear persisted snapshots between test cases. */
export function resetHealthHistory(): void {
  snapshots.length = 0;
}

/**
 * Convert an unhealthy snapshot into compatibility issues. Healthy
 * adapters produce no issues — only stale/failing/mismatched adapters
 * reduce compatibility confidence, per #937 acceptance criteria.
 */
export function deriveIssuesFromHealth(
  snapshot: AdapterHealthSnapshot,
): DerivedHealthIssue[] {
  if (snapshot.status === "healthy") return [];

  const severity: DerivedHealthIssue["severity"] =
    snapshot.status === "unavailable" || snapshot.status === "schema-mismatch"
      ? "critical"
      : snapshot.score < 40
        ? "high"
        : "medium";

  const recommendation =
    snapshot.status === "unavailable"
      ? "Investigate adapter connectivity; fail over to a backup data source if available"
      : snapshot.status === "schema-mismatch"
        ? "Update the adapter's schema mapping to match the protocol's current response format"
        : "Monitor adapter latency and error rate; consider throttling strategies that depend on this component";

  return [
    {
      severity,
      component: snapshot.component,
      issue: `Adapter ${snapshot.status} (health score ${snapshot.score}/100)`,
      impact: snapshot.reasons.join("; ") || "Adapter evidence indicates degraded reliability",
      recommendation,
    },
  ];
}
