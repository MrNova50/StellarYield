import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseFeatureFlags, resetFeatureFlagCache } from "./featureFlags";

const VITE_CONFIG_PATH = resolve(__dirname, "../../../vite.config.ts");

/**
 * Regression tests for the Vite/Vercel production build configuration.
 *
 * Vercel deploys the client as a static site. The `base: './'` setting in
 * vite.config.ts is required so asset URLs are relative — without it, assets
 * 404 when served from a sub-path or CDN prefix.
 */
describe("Vercel production build config", () => {
  let configSource: string;

  try {
    configSource = readFileSync(VITE_CONFIG_PATH, "utf-8");
  } catch {
    configSource = "";
  }

  it("vite.config.ts exists", () => {
    expect(configSource.length).toBeGreaterThan(0);
  });

  it("base is set to './' for relative asset paths on Vercel", () => {
    expect(configSource).toMatch(/base\s*:\s*['"]\.\//);
  });

  it("@vitejs/plugin-react is included", () => {
    expect(configSource).toMatch(/@vitejs\/plugin-react/);
  });

  it("@tailwindcss/vite plugin is included", () => {
    expect(configSource).toMatch(/@tailwindcss\/vite/);
  });
});

/**
 * Feature flag tests — production and preview defaults, unknown key warnings,
 * and type safety.
 */
describe("parseFeatureFlags", () => {
  beforeEach(() => {
    resetFeatureFlagCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetFeatureFlagCache();
  });

  it("defaults all flags to false when no VITE_FEATURE_* vars are set", () => {
    const flags = parseFeatureFlags({ MODE: "production" });
    expect(flags.experimentalAnalytics).toBe(false);
    expect(flags.experimentalPortfolioAttribution).toBe(false);
    expect(flags.experimentalStrategyHealth).toBe(false);
  });

  it('enables experimentalAnalytics when VITE_FEATURE_EXPERIMENTAL_ANALYTICS is "true"', () => {
    const flags = parseFeatureFlags({
      MODE: "production",
      VITE_FEATURE_EXPERIMENTAL_ANALYTICS: "true",
    });
    expect(flags.experimentalAnalytics).toBe(true);
  });

  it("treats any value other than \"true\" as false", () => {
    const flags = parseFeatureFlags({
      VITE_FEATURE_EXPERIMENTAL_ANALYTICS: "1",
    });
    expect(flags.experimentalAnalytics).toBe(false);

    const flags2 = parseFeatureFlags({
      VITE_FEATURE_EXPERIMENTAL_ANALYTICS: "yes",
    });
    expect(flags2.experimentalAnalytics).toBe(false);
  });

  it("enables multiple flags independently", () => {
    const flags = parseFeatureFlags({
      VITE_FEATURE_EXPERIMENTAL_ANALYTICS: "true",
      VITE_FEATURE_EXPERIMENTAL_PORTFOLIO_ATTRIBUTION: "true",
    });
    expect(flags.experimentalAnalytics).toBe(true);
    expect(flags.experimentalPortfolioAttribution).toBe(true);
    expect(flags.experimentalStrategyHealth).toBe(false);
  });

  it("warns on unknown VITE_FEATURE_* keys outside production", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseFeatureFlags({
      MODE: "development",
      VITE_FEATURE_UNKNOWN_PANEL: "true",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("VITE_FEATURE_UNKNOWN_PANEL"),
    );
  });

  it("does NOT warn on unknown VITE_FEATURE_* keys in production", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseFeatureFlags({
      MODE: "production",
      VITE_FEATURE_UNKNOWN_PANEL: "true",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn on non-VITE_FEATURE_* keys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseFeatureFlags({
      MODE: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_CONTRACT_ID: "CC...",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("preview defaults: all flags off when no env vars configured", () => {
    // Simulates a Vercel Preview build where VITE_FEATURE_* vars are unset
    const flags = parseFeatureFlags({ MODE: "preview" });
    expect(flags.experimentalAnalytics).toBe(false);
    expect(flags.experimentalPortfolioAttribution).toBe(false);
    expect(flags.experimentalStrategyHealth).toBe(false);
  });

  it("preview: explicitly enabled flags are on", () => {
    const flags = parseFeatureFlags({
      MODE: "preview",
      VITE_FEATURE_EXPERIMENTAL_STRATEGY_HEALTH: "true",
    });
    expect(flags.experimentalStrategyHealth).toBe(true);
    expect(flags.experimentalAnalytics).toBe(false);
  });
});
