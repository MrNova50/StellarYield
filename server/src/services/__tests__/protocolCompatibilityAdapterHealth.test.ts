/**
 * #937 — Live adapter evidence must replace mock compatibility checks.
 */
import {
  ProtocolCompatibilityEngine,
  registerAdapterEvidence,
  hasLiveAdapterEvidence,
  resetAdapterEvidenceRegistry,
} from "../protocolCompatibilityService";

describe("protocolCompatibilityService — live adapter evidence (#937)", () => {
  afterEach(() => {
    resetAdapterEvidenceRegistry();
  });

  it("hasLiveAdapterEvidence is false until evidence is registered", () => {
    expect(hasLiveAdapterEvidence("Blend", "core_contract")).toBe(false);
    registerAdapterEvidence({
      protocolName: "Blend",
      component: "core_contract",
      lastSuccessAt: new Date().toISOString(),
      latencyMs: 100,
      errorRatePct: 0,
      schemaVersion: "v2",
      expectedSchemaVersion: "v2",
    });
    expect(hasLiveAdapterEvidence("Blend", "core_contract")).toBe(true);
  });

  it("does not report the mock 'Critical features unavailable' issue once live evidence exists for that component", async () => {
    // The 'api' component's mock critical-features check fails by design
    // (mockAvailableFeatures doesn't include yield_data/vault_info), so
    // without live evidence it always produces a mock critical issue.
    const engine = new ProtocolCompatibilityEngine({ autoDisableIncompatible: false });
    const withoutEvidence = await engine.checkProtocol("Blend");
    expect(
      withoutEvidence.issues.some((i) => i.issue === "Critical features unavailable"),
    ).toBe(true);

    registerAdapterEvidence({
      protocolName: "Blend",
      component: "api",
      lastSuccessAt: new Date().toISOString(),
      latencyMs: 100,
      errorRatePct: 0,
      schemaVersion: "v1.3",
      expectedSchemaVersion: "v1.3",
    });

    const withEvidence = await engine.checkProtocol("Blend");
    expect(
      withEvidence.issues.some((i) => i.issue === "Critical features unavailable"),
    ).toBe(false);
    // Healthy live evidence produces zero derived issues for that component.
    expect(withEvidence.issues.some((i) => i.component === "api")).toBe(false);
  });

  it("surfaces a critical issue when live evidence shows the adapter is unavailable", async () => {
    registerAdapterEvidence({
      protocolName: "Soroswap",
      component: "router_contract",
      lastSuccessAt: new Date().toISOString(),
      latencyMs: 50,
      errorRatePct: 100,
      schemaVersion: "v1",
      expectedSchemaVersion: "v1",
    });

    const engine = new ProtocolCompatibilityEngine({ autoDisableIncompatible: false });
    const status = await engine.checkProtocol("Soroswap");

    const routerIssue = status.issues.find((i) => i.component === "router_contract");
    expect(routerIssue).toBeDefined();
    expect(routerIssue?.severity).toBe("critical");
    expect(routerIssue?.issue).toContain("unavailable");
  });
});
