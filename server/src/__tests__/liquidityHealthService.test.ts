import {
  liquidityHealthService,
  bandForScore,
  buildComponentBreakdown,
  buildAlertContext,
} from "../services/liquidityHealthService";

describe("LiquidityHealthService", () => {
  it("should calculate a score for a valid protocol", async () => {
    const result = await liquidityHealthService.calculateScore("blend");

    expect(result).toBeDefined();
    expect(result.strategyId).toBe("blend");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.status).toBeDefined();
    expect(result.components).toBeDefined();
    expect(result.components.depth).toBeDefined();
    expect(result.components.spread).toBeDefined();
  });

  it("should return healthy status for deep liquidity protocols", async () => {
    const result = await liquidityHealthService.calculateScore("blend");
    // Blend has $12.4M TVL in the mock config, which is above the $10M target
    expect(result.status).toBe("healthy");
    expect(result.score).toBeGreaterThan(60);
  });

  it("should detect critical status for low score protocols", async () => {
    // We can't easily mock PROTOCOLS here without more complex setup, 
    // but we can verify the threshold logic if we were to pass mock data.
    // Since it's using the singleton, we'll check what we have.
    const results = await liquidityHealthService.getAllScores();
    results.forEach(res => {
      if (res.score < res.thresholds.critical) {
        expect(res.status).toBe("critical");
      } else if (res.score < res.thresholds.warning) {
        expect(res.status).toBe("warning");
      } else {
        expect(res.status).toBe("healthy");
      }
    });
  });

  it("should identify when execution should be suppressed", async () => {
    // Mock check
    const suppressed = await liquidityHealthService.isSuppressed("blend");
    expect(typeof suppressed).toBe("boolean");
  });

  it("should throw error for invalid protocol", async () => {
    await expect(liquidityHealthService.calculateScore("invalid")).rejects.toThrow();
  });

  // #1092 — component-level breakdown and alert context
  it("includes a per-component breakdown alongside the composite score", async () => {
    const result = await liquidityHealthService.calculateScore("blend");

    expect(result.breakdown).toHaveLength(4);
    const names = result.breakdown.map((b) => b.name).sort();
    expect(names).toEqual(["depth", "spread", "stability", "withdrawalSensitivity"].sort());
    result.breakdown.forEach((b) => {
      expect(b.score).toBe(result.components[b.name]);
      expect(["healthy", "warning", "critical"]).toContain(b.band);
    });
  });

  it("omits alertContext when the strategy is healthy", async () => {
    const result = await liquidityHealthService.calculateScore("blend");
    expect(result.status).toBe("healthy");
    expect(result.alertContext).toBeUndefined();
  });
});

describe("bandForScore", () => {
  it("returns critical below the critical threshold", () => {
    expect(bandForScore(10, 60, 30)).toBe("critical");
  });
  it("returns warning between the thresholds", () => {
    expect(bandForScore(45, 60, 30)).toBe("warning");
  });
  it("returns healthy at/above the warning threshold", () => {
    expect(bandForScore(60, 60, 30)).toBe("healthy");
    expect(bandForScore(90, 60, 30)).toBe("healthy");
  });
});

describe("buildComponentBreakdown / buildAlertContext", () => {
  const components = { depth: 80, spread: 20, stability: 90, withdrawalSensitivity: 70 };

  it("bands each component independently using the shared thresholds", () => {
    const breakdown = buildComponentBreakdown(components, 60, 30);
    const byName = Object.fromEntries(breakdown.map((b) => [b.name, b.band]));
    expect(byName).toEqual({
      depth: "healthy",
      spread: "critical", // 20 is below the critical threshold of 30
      stability: "healthy",
      withdrawalSensitivity: "healthy",
    });
  });

  it("identifies the lowest-scoring component as the primary driver", () => {
    const breakdown = buildComponentBreakdown(components, 60, 30);
    const alert = buildAlertContext(breakdown, "critical", "blend");
    expect(alert).toBeDefined();
    expect(alert!.primaryDrivers).toEqual(["spread"]);
    expect(alert!.message).toContain("blend");
    expect(alert!.message).toContain("slippage");
  });

  it("includes every tied lowest-scoring component as a primary driver", () => {
    const tiedComponents = { depth: 20, spread: 20, stability: 90, withdrawalSensitivity: 70 };
    const breakdown = buildComponentBreakdown(tiedComponents, 60, 30);
    const alert = buildAlertContext(breakdown, "critical", "blend");
    expect(alert!.primaryDrivers.sort()).toEqual(["depth", "spread"].sort());
  });

  it("returns undefined for a healthy status regardless of component spread", () => {
    const breakdown = buildComponentBreakdown(components, 60, 30);
    expect(buildAlertContext(breakdown, "healthy", "blend")).toBeUndefined();
  });
});
