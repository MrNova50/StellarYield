/**
 * featureFlags.ts
 *
 * Typed feature-flag parser for VITE_ environment variables.
 *
 * Flags are boolean by default (opt-in via `"true"`, anything else is false).
 * Unknown flag names produce a warning in development and are silently ignored
 * in production to avoid crashing the app.
 *
 * Usage:
 *   import { getFeatureFlags } from "@/utils/featureFlags";
 *   const flags = getFeatureFlags();
 *   if (flags.experimentalAnalytics) { ... }
 */

/** All recognised feature flag names. */
export type FeatureFlagName =
  | "experimentalAnalytics"
  | "experimentalPortfolioAttribution"
  | "experimentalStrategyHealth";

/** Resolved feature flags (all boolean). */
export type FeatureFlags = Record<FeatureFlagName, boolean>;

/** Mapping from flag name to the VITE_ env variable that controls it. */
const FLAG_ENV_MAP: Record<FeatureFlagName, string> = {
  experimentalAnalytics: "VITE_FEATURE_EXPERIMENTAL_ANALYTICS",
  experimentalPortfolioAttribution:
    "VITE_FEATURE_EXPERIMENTAL_PORTFOLIO_ATTRIBUTION",
  experimentalStrategyHealth: "VITE_FEATURE_EXPERIMENTAL_STRATEGY_HEALTH",
};

/** All known flag names for fast lookup. */
const KNOWN_FLAGS = new Set<string>(Object.keys(FLAG_ENV_MAP));

/**
 * Parse `rawEnv` (defaults to `import.meta.env`) into a typed `FeatureFlags`
 * record.
 *
 * - Any VITE_FEATURE_* key not in the known list emits a `console.warn` in
 *   development / test (`import.meta.env.MODE !== "production"`).
 * - Any VITE_FEATURE_* key with a value other than `"true"` is treated as
 *   `false`.
 */
export function parseFeatureFlags(
  rawEnv: Record<string, string | undefined> = import.meta.env as Record<
    string,
    string | undefined
  >,
): FeatureFlags {
  const isProd =
    (rawEnv["MODE"] ?? (import.meta.env.MODE as string | undefined)) ===
    "production";

  // Warn on unknown VITE_FEATURE_* keys
  for (const key of Object.keys(rawEnv)) {
    if (key.startsWith("VITE_FEATURE_")) {
      const flagName = envKeyToFlagName(key);
      if (flagName === null || !KNOWN_FLAGS.has(flagName)) {
        if (!isProd) {
          console.warn(
            `[featureFlags] Unknown feature flag env variable: "${key}". ` +
              `Add it to FLAG_ENV_MAP in featureFlags.ts if intentional.`,
          );
        }
      }
    }
  }

  const flags = {} as FeatureFlags;
  for (const [name, envKey] of Object.entries(FLAG_ENV_MAP) as [
    FeatureFlagName,
    string,
  ][]) {
    flags[name] = rawEnv[envKey] === "true";
  }

  return flags;
}

/**
 * Singleton accessor — cached after first call so components don't re-parse on
 * every render.
 */
let _cachedFlags: FeatureFlags | null = null;

export function getFeatureFlags(): FeatureFlags {
  if (_cachedFlags === null) {
    _cachedFlags = parseFeatureFlags();
  }
  return _cachedFlags;
}

/** Reset the cache — useful in tests. */
export function resetFeatureFlagCache(): void {
  _cachedFlags = null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert a VITE_FEATURE_* env key to the camelCase flag name used in
 * FLAG_ENV_MAP, or `null` if it cannot be found.
 */
function envKeyToFlagName(envKey: string): FeatureFlagName | null {
  for (const [name, key] of Object.entries(FLAG_ENV_MAP) as [
    FeatureFlagName,
    string,
  ][]) {
    if (key === envKey) return name;
  }
  return null;
}
