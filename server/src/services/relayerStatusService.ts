// ── Relayer Status Service ─────────────────────────────────────────────────
// Tracks bridge relayer health metrics: queue depth, replay protection,
// relay failures, and recent activity for the read-only status page.
// Includes backoff visibility and failure type differentiation.

export type FailureType = "temporary" | "terminal";

export interface RelayEvent {
  id: string;
  timestamp: string;
  status: "success" | "failed" | "pending";
  innerTxHash?: string;
  feeBumpHash?: string;
  error?: string;
  durationMs: number;
  failureType?: FailureType; // "temporary" (network) or "terminal" (unrecoverable)
}

export interface ReplayProtectionStatus {
  enabled: boolean;
  trackedHashes: number;
  oldestHashAge: string | null;
  deduplicationWindow: string;
}

export interface BackoffStatus {
  isBackingOff: boolean;
  currentStep: number; // Retry attempt count
  maxSteps: number;
  nextRetryAt: string | null; // ISO timestamp when next retry will occur
  retryDelayMs: number; // Current delay in milliseconds
  lastFailureAt: string | null;
}

export interface RelayerStatus {
  isOnline: boolean;
  network: string;
  queueDepth: number;
  totalRelayed: number;
  successCount: number;
  failureCount: number;
  temporaryFailureCount: number;
  terminalFailureCount: number;
  successRate: number; // 0-100
  avgDurationMs: number;
  lastRelayAt: string | null;
  recentEvents: RelayEvent[];
  replayProtection: ReplayProtectionStatus;
  backoff: BackoffStatus;
  uptime: string;
  checkedAt: string;
}

// ── In-memory state ───────────────────────────────────────────────────────

const MAX_EVENTS = 100;
const DEDUP_WINDOW_HOURS = 24;
const BACKOFF_BASE_MS = 1000; // 1 second base delay
const BACKOFF_MAX_STEPS = 5; // Maximum retry attempts
const BACKOFF_MULTIPLIER = 2; // Exponential backoff

const events: RelayEvent[] = [];
const seenHashes = new Map<string, number>(); // hash -> timestamp ms
const startedAt = Date.now();

let pendingCount = 0;
let backoffStep = 0;
let lastFailureTime: number | null = null;
let lastFailureType: FailureType | null = null;

/**
 * Determine if a failure is temporary (network) or terminal (unrecoverable)
 */
function classifyFailure(error: string): FailureType {
  const lowerError = error.toLowerCase();

  // Terminal errors
  if (lowerError.includes("invalid") ||
      lowerError.includes("unauthorized") ||
      lowerError.includes("forbidden") ||
      lowerError.includes("not found") ||
      lowerError.includes("bad request")) {
    return "terminal";
  }

  // Temporary errors (network-related)
  if (lowerError.includes("timeout") ||
      lowerError.includes("connection") ||
      lowerError.includes("econnrefused") ||
      lowerError.includes("enotfound") ||
      lowerError.includes("temporary") ||
      lowerError.includes("unavailable") ||
      lowerError.includes("retry")) {
    return "temporary";
  }

  // Default to temporary for unknown errors
  return "temporary";
}

/**
 * Calculate next retry time based on current backoff step
 */
function calculateNextRetryTime(): number {
  const delayMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, backoffStep);
  return Date.now() + delayMs;
}

/**
 * Format milliseconds as human-readable delay
 */
function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

// ── Public API ────────────────────────────────────────────────────────────

export function recordRelayStart(): string {
  const id = `relay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingCount++;
  return id;
}

export function recordRelaySuccess(
  id: string,
  durationMs: number,
  innerTxHash?: string,
  feeBumpHash?: string,
): void {
  pendingCount = Math.max(0, pendingCount - 1);

  if (innerTxHash) {
    seenHashes.set(innerTxHash, Date.now());
  }
  if (feeBumpHash) {
    seenHashes.set(feeBumpHash, Date.now());
  }

  events.unshift({
    id,
    timestamp: new Date().toISOString(),
    status: "success",
    innerTxHash,
    feeBumpHash,
    durationMs,
  });

  // Reset backoff on success
  backoffStep = 0;
  lastFailureTime = null;
  lastFailureType = null;

  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  pruneSeenHashes();
}

export function recordRelayFailure(id: string, durationMs: number, error: string): void {
  pendingCount = Math.max(0, pendingCount - 1);

  const failureType = classifyFailure(error);
  lastFailureTime = Date.now();
  lastFailureType = failureType;

  // For terminal failures, don't increase backoff (they won't resolve with retry)
  // For temporary failures, increment backoff up to max
  if (failureType === "temporary" && backoffStep < BACKOFF_MAX_STEPS) {
    backoffStep++;
  }

  events.unshift({
    id,
    timestamp: new Date().toISOString(),
    status: "failed",
    error,
    durationMs,
    failureType,
  });

  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

/**
 * Check if we're currently in backoff period
 */
export function isInBackoff(): boolean {
  if (lastFailureTime === null || lastFailureType !== "temporary") {
    return false;
  }

  const delayMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, backoffStep - 1);
  const retryTime = lastFailureTime + delayMs;
  return Date.now() < retryTime;
}

/**
 * Get the next retry time
 */
export function getNextRetryTime(): Date | null {
  if (backoffStep === 0 || lastFailureTime === null) {
    return null;
  }

  const delayMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, backoffStep - 1);
  return new Date(lastFailureTime + delayMs);
}

/**
 * Reset backoff state (e.g., after manual intervention)
 */
export function resetBackoff(): void {
  backoffStep = 0;
  lastFailureTime = null;
  lastFailureType = null;
}

export function isHashSeen(hash: string): boolean {
  return seenHashes.has(hash);
}

export function getRelayerStatus(): RelayerStatus {
  pruneSeenHashes();

  const successCount = events.filter((e) => e.status === "success").length;
  const failureCount = events.filter((e) => e.status === "failed").length;
  const temporaryFailureCount = events.filter((e) => e.status === "failed" && e.failureType === "temporary").length;
  const terminalFailureCount = events.filter((e) => e.status === "failed" && e.failureType === "terminal").length;
  const totalRelayed = successCount + failureCount;
  const successRate = totalRelayed > 0 ? Math.round((successCount / totalRelayed) * 100) : 100;

  const durations = events
    .filter((e) => e.status === "success")
    .map((e) => e.durationMs);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  const lastRelayAt = events.length > 0 ? events[0].timestamp : null;

  // Uptime since service started
  const uptimeMs = Date.now() - startedAt;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  // Replay protection
  const now = Date.now();
  const cutoff = now - DEDUP_WINDOW_HOURS * 60 * 60 * 1000;
  let oldestHashAge: string | null = null;
  let oldestTs = now;

  for (const [, ts] of seenHashes) {
    if (ts < oldestTs) oldestTs = ts;
  }

  if (seenHashes.size > 0) {
    const ageMs = now - oldestTs;
    const ageMinutes = Math.floor(ageMs / (1000 * 60));
    oldestHashAge = ageMinutes < 60 ? `${ageMinutes}m` : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m`;
  }

  // Backoff status
  const nextRetry = getNextRetryTime();
  const currentDelayMs = backoffStep > 0
    ? BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, backoffStep - 1)
    : 0;

  return {
    isOnline: true,
    network: process.env.NETWORK_PASSPHRASE?.includes("TESTNET") ? "testnet" : "mainnet",
    queueDepth: pendingCount,
    totalRelayed,
    successCount,
    failureCount,
    temporaryFailureCount,
    terminalFailureCount,
    successRate,
    avgDurationMs,
    lastRelayAt,
    recentEvents: events.slice(0, 20),
    replayProtection: {
      enabled: true,
      trackedHashes: seenHashes.size,
      oldestHashAge,
      deduplicationWindow: `${DEDUP_WINDOW_HOURS}h`,
    },
    backoff: {
      isBackingOff: isInBackoff(),
      currentStep: backoffStep,
      maxSteps: BACKOFF_MAX_STEPS,
      nextRetryAt: nextRetry?.toISOString() || null,
      retryDelayMs: currentDelayMs,
      lastFailureAt: lastFailureTime ? new Date(lastFailureTime).toISOString() : null,
    },
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    checkedAt: new Date().toISOString(),
  };
}

// ── Internal ──────────────────────────────────────────────────────────────

function pruneSeenHashes(): void {
  const cutoff = Date.now() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000;
  for (const [hash, ts] of seenHashes) {
    if (ts < cutoff) seenHashes.delete(hash);
  }
}
