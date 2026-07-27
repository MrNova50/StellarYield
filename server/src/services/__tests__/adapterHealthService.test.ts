/**
 * #937 — Adapter source-health scoring.
 * Covers healthy, degraded, unavailable, and schema-mismatch adapters,
 * plus that healthy adapters never reduce compatibility confidence and
 * that snapshots persist for trend analysis.
 */
import {
  scoreAdapterHealth,
  deriveIssuesFromHealth,
  getHealthHistory,
  resetHealthHistory,
  type AdapterEvidence,
} from "../adapterHealthService";

const NOW = new Date("2026-07-25T12:00:00.000Z").getTime();

function baseEvidence(overrides: Partial<AdapterEvidence> = {}): AdapterEvidence {
  return {
    protocolName: "Blend",
    component: "core_contract",
    lastSuccessAt: new Date(NOW).toISOString(),
    latencyMs: 200,
    errorRatePct: 0,
    schemaVersion: "v2",
    expectedSchemaVersion: "v2",
    ...overrides,
  };
}

describe("adapterHealthService", () => {
  beforeEach(() => {
    resetHealthHistory();
  });

  describe("healthy adapters", () => {
    it("scores a fresh, fast, error-free, schema-matching adapter as healthy", () => {
      const snapshot = scoreAdapterHealth(baseEvidence(), NOW);

      expect(snapshot.status).toBe("healthy");
      expect(snapshot.score).toBeGreaterThanOrEqual(70);
      expect(snapshot.schemaMatch).toBe(true);
      expect(snapshot.reasons).toHaveLength(0);
    });

    it("produces no compatibility issues for a healthy snapshot", () => {
      const snapshot = scoreAdapterHealth(baseEvidence(), NOW);
      expect(deriveIssuesFromHealth(snapshot)).toEqual([]);
    });
  });

  describe("degraded adapters", () => {
    it("scores an adapter with elevated latency and error rate as degraded", () => {
      const evidence = baseEvidence({ latencyMs: 4000, errorRatePct: 15 });
      const snapshot = scoreAdapterHealth(evidence, NOW);

      expect(snapshot.status).toBe("degraded");
      expect(snapshot.score).toBeLessThan(70);
      expect(snapshot.reasons.some((r) => r.includes("latency"))).toBe(true);
      expect(snapshot.reasons.some((r) => r.includes("error rate"))).toBe(true);
    });

    it("derives a non-critical issue whose severity reflects the score", () => {
      const evidence = baseEvidence({ latencyMs: 4000, errorRatePct: 15 });
      const snapshot = scoreAdapterHealth(evidence, NOW);
      const issues = deriveIssuesFromHealth(snapshot);

      expect(issues).toHaveLength(1);
      expect(["medium", "high"]).toContain(issues[0].severity);
      expect(issues[0].component).toBe("core_contract");
      expect(issues[0].issue).toContain("degraded");
    });

    it("treats stale-but-not-abandoned data as degraded, reducing confidence", () => {
      const staleBy = 10 * 60 * 1000; // 10 minutes — stale but under the unavailable cutoff
      const evidence = baseEvidence({
        lastSuccessAt: new Date(NOW - staleBy).toISOString(),
      });
      const snapshot = scoreAdapterHealth(evidence, NOW);

      expect(snapshot.status).not.toBe("healthy");
      expect(snapshot.reasons.some((r) => r.includes("stale"))).toBe(true);
    });
  });

  describe("unavailable adapters", () => {
    it("scores a 100% error-rate adapter as unavailable regardless of freshness", () => {
      const evidence = baseEvidence({ errorRatePct: 100 });
      const snapshot = scoreAdapterHealth(evidence, NOW);

      expect(snapshot.status).toBe("unavailable");
      expect(snapshot.score).toBeLessThanOrEqual(70);
    });

    it("scores a long-abandoned adapter (no success in 30+ minutes) as unavailable", () => {
      const evidence = baseEvidence({
        lastSuccessAt: new Date(NOW - 45 * 60 * 1000).toISOString(),
      });
      const snapshot = scoreAdapterHealth(evidence, NOW);

      expect(snapshot.status).toBe("unavailable");
    });

    it("derives a critical issue recommending failover for unavailable adapters", () => {
      const evidence = baseEvidence({ errorRatePct: 100 });
      const snapshot = scoreAdapterHealth(evidence, NOW);
      const issues = deriveIssuesFromHealth(snapshot);

      expect(issues[0].severity).toBe("critical");
      expect(issues[0].recommendation.toLowerCase()).toContain("fail over");
    });
  });

  describe("schema-mismatch adapters", () => {
    it("scores a fresh, fast, error-free adapter with mismatched schema as schema-mismatch", () => {
      const evidence = baseEvidence({ schemaVersion: "v1", expectedSchemaVersion: "v2" });
      const snapshot = scoreAdapterHealth(evidence, NOW);

      expect(snapshot.status).toBe("schema-mismatch");
      expect(snapshot.schemaMatch).toBe(false);
      expect(snapshot.reasons.some((r) => r.includes("schema mismatch"))).toBe(true);
    });

    it("derives a critical issue recommending an adapter schema update", () => {
      const evidence = baseEvidence({ schemaVersion: "v1", expectedSchemaVersion: "v2" });
      const snapshot = scoreAdapterHealth(evidence, NOW);
      const issues = deriveIssuesFromHealth(snapshot);

      expect(issues[0].severity).toBe("critical");
      expect(issues[0].recommendation.toLowerCase()).toContain("schema");
    });
  });

  describe("health snapshot persistence", () => {
    it("persists snapshots per protocol/component for trend analysis", () => {
      scoreAdapterHealth(baseEvidence(), NOW);
      scoreAdapterHealth(baseEvidence({ latencyMs: 500 }), NOW + 60_000);
      scoreAdapterHealth(baseEvidence({ protocolName: "Soroswap", component: "router_contract" }), NOW);

      const blendHistory = getHealthHistory("Blend", "core_contract");
      expect(blendHistory).toHaveLength(2);
      expect(blendHistory.every((s) => s.protocolName === "Blend")).toBe(true);

      const all = getHealthHistory();
      expect(all).toHaveLength(3);
    });

    it("resetHealthHistory clears persisted snapshots", () => {
      scoreAdapterHealth(baseEvidence(), NOW);
      resetHealthHistory();
      expect(getHealthHistory()).toHaveLength(0);
    });
  });
});
