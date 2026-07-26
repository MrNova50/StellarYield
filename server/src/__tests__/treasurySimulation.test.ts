import http from "http";
import { simulateTreasury, saveScenario, getScenario, listScenarios, deleteScenario, assertValidScenarioInput, previewImport, TreasuryValidationError, SUPPORTED_ASSETS, CASHFLOW_CATEGORIES, type TreasuryScenario, type AllocationPosition, type CashflowRow } from "../services/treasurySimulationService";

const baseAllocations: AllocationPosition[] = [
  { vaultId: "blend", vaultName: "Blend", allocationPct: 60, apy: 6.5, tvlUsd: 12_000_000, riskScore: 8, rotationCostPct: 0.1 },
  { vaultId: "soroswap", vaultName: "Soroswap", allocationPct: 40, apy: 11.2, tvlUsd: 4_500_000, riskScore: 6, rotationCostPct: 0.2 },
];

const makeScenario = (overrides: Partial<TreasuryScenario> = {}): TreasuryScenario => ({
  id: `test-${Date.now()}`,
  name: "Test Scenario",
  totalCapitalUsd: 1_000_000,
  allocations: baseAllocations,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("simulateTreasury", () => {
  it("returns a projectedYieldPct > 0 for valid allocations", () => {
    const result = simulateTreasury(makeScenario());
    expect(result.projectedYieldPct).toBeGreaterThan(0);
  });

  it("projectedYieldUsd matches capital × weighted APY", () => {
    const scenario = makeScenario({ totalCapitalUsd: 1_000_000 });
    const result = simulateTreasury(scenario);
    const expected =
      1_000_000 * 0.6 * (6.5 / 100) + 1_000_000 * 0.4 * (11.2 / 100);
    expect(result.projectedYieldUsd).toBeCloseTo(expected, 0);
  });

  it("includes rotation cost for all positions", () => {
    const result = simulateTreasury(makeScenario({ totalCapitalUsd: 1_000_000 }));
    const expected =
      1_000_000 * 0.6 * (0.1 / 100) + 1_000_000 * 0.4 * (0.2 / 100);
    expect(result.totalRotationCostUsd).toBeCloseTo(expected, 0);
  });

  it("warns on high concentration (>50%)", () => {
    const result = simulateTreasury(makeScenario());
    expect(result.concentrationWarnings.length).toBeGreaterThan(0);
    expect(result.concentrationWarnings[0]).toContain("Blend");
  });

  it("no warnings when all allocations are ≤50%", () => {
    const scenario = makeScenario({
      allocations: [
        { ...baseAllocations[0], allocationPct: 50 },
        { ...baseAllocations[1], allocationPct: 50 },
      ],
    });
    const result = simulateTreasury(scenario);
    expect(result.concentrationWarnings).toHaveLength(0);
  });

  it("breakdown has an entry per allocation", () => {
    const result = simulateTreasury(makeScenario());
    expect(result.allocationBreakdown).toHaveLength(2);
  });

  it("liquidityRiskScore is between 0 and 10", () => {
    const result = simulateTreasury(makeScenario());
    expect(result.liquidityRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.liquidityRiskScore).toBeLessThanOrEqual(10);
  });

  it("returns 0 yield for zero capital", () => {
    const result = simulateTreasury(makeScenario({ totalCapitalUsd: 0 }));
    expect(result.projectedYieldPct).toBe(0);
    expect(result.projectedYieldUsd).toBe(0);
  });
});

describe("scenario persistence", () => {
  it("saves and retrieves a scenario", () => {
    const scenario = makeScenario({ id: "persist-1" });
    saveScenario(scenario);
    expect(getScenario("persist-1")).toMatchObject({ id: "persist-1" });
  });

  it("lists saved scenarios", () => {
    const scenario = makeScenario({ id: "list-1" });
    saveScenario(scenario);
    expect(listScenarios().some((s) => s.id === "list-1")).toBe(true);
  });

  it("deletes a scenario", () => {
    const scenario = makeScenario({ id: "delete-1" });
    saveScenario(scenario);
    expect(deleteScenario("delete-1")).toBe(true);
    expect(getScenario("delete-1")).toBeUndefined();
  });

  it("returns false when deleting non-existent scenario", () => {
    expect(deleteScenario("does-not-exist")).toBe(false);
  });
});

describe("assertValidScenarioInput - invalid input", () => {
  const baseAlloc: AllocationPosition = {
    vaultId: "v1",
    vaultName: "V1",
    allocationPct: 100,
    apy: 5,
    tvlUsd: 1_000_000,
    riskScore: 5,
    rotationCostPct: 0.1,
  };

  it("rejects non-object body", () => {
    expect(() => assertValidScenarioInput(null)).toThrow();
    expect(() => assertValidScenarioInput("string")).toThrow();
    expect(() => assertValidScenarioInput(123)).toThrow();
  });

  it("rejects missing id", () => {
    expect(() =>
      assertValidScenarioInput({
        name: "n",
        totalCapitalUsd: 1000,
        allocations: [baseAlloc],
      }),
    ).toThrow();
  });

  it("rejects missing name", () => {
    expect(() =>
      assertValidScenarioInput({
        id: "1",
        totalCapitalUsd: 1000,
        allocations: [baseAlloc],
      }),
    ).toThrow();
  });

  it("rejects invalid totalCapitalUsd", () => {
    expect(() =>
      assertValidScenarioInput({
        id: "1",
        name: "n",
        totalCapitalUsd: -1,
        allocations: [baseAlloc],
      }),
    ).toThrow();
  });

  it("rejects missing allocations array", () => {
    expect(() =>
      assertValidScenarioInput({
        id: "1",
        name: "n",
        totalCapitalUsd: 1000,
        allocations: [],
      }),
    ).toThrow();
  });

  it("rejects allocation item missing required fields", () => {
    expect(() =>
      assertValidScenarioInput({
        id: "1",
        name: "n",
        totalCapitalUsd: 1000,
        allocations: [{ ...baseAlloc, apy: "bad" as any }],
      }),
    ).toThrow();
  });

  it("rejects allocations not summing to 100", () => {
    expect(() =>
      assertValidScenarioInput({
        id: "1",
        name: "n",
        totalCapitalUsd: 1000,
        allocations: [baseAlloc, { ...baseAlloc, allocationPct: 50 }],
      }),
    ).toThrow();
  });

  it("returns typed scenario on valid input", () => {
    const scenario = assertValidScenarioInput({
      id: "1",
      name: "ok",
      totalCapitalUsd: 1000,
      allocations: [baseAlloc],
    });
    expect(scenario.id).toBe("1");
    expect(scenario.allocations).toHaveLength(1);
  });
});

const validRow = {
  id: "cf-1",
  date: "2025-06-01",
  asset: "USDC",
  amount: 50000,
  direction: "inflow",
  category: "interest",
  memo: "Q2 yield",
};

describe("previewImport - cashflow row validation", () => {
  it("validates a single valid row", () => {
    const result = previewImport([validRow]);
    expect(result.validRows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalInflow).toBe(50000);
    expect(result.summary.totalOutflow).toBe(0);
  });

  it("rejects null/undefined row", () => {
    const result = previewImport([null]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe("not_an_object");
  });

  it("rejects missing id", () => {
    const { id, ...rest } = validRow;
    const result = previewImport([rest]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "missing_id")).toBe(true);
  });

  it("rejects duplicate id", () => {
    const result = previewImport([validRow, { ...validRow, id: "cf-1" }]);
    expect(result.validRows).toHaveLength(1);
    expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
  });

  it("rejects invalid date", () => {
    const result = previewImport([{ ...validRow, date: "not-a-date" }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "invalid_date")).toBe(true);
  });

  it("warns on future date", () => {
    const result = previewImport([{ ...validRow, date: "2099-01-01" }]);
    expect(result.validRows).toHaveLength(1);
    expect(result.warnings.some((w) => w.code === "future_date")).toBe(true);
  });

  it("rejects unsupported asset", () => {
    const result = previewImport([{ ...validRow, asset: "DOGE" }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "unsupported_asset")).toBe(true);
  });

  it("accepts every supported asset", () => {
    for (const asset of SUPPORTED_ASSETS) {
      const result = previewImport([{ ...validRow, id: `cf-${asset}`, asset }]);
      expect(result.errors.some((e) => e.code === "unsupported_asset")).toBe(false);
    }
  });

  it("rejects negative amount", () => {
    const result = previewImport([{ ...validRow, amount: -100 }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "negative_amount")).toBe(true);
  });

  it("rejects zero amount", () => {
    const result = previewImport([{ ...validRow, amount: 0 }]);
    expect(result.errors.some((e) => e.code === "negative_amount")).toBe(true);
  });

  it("rejects non-finite amount", () => {
    const result = previewImport([{ ...validRow, amount: NaN }]);
    expect(result.errors.some((e) => e.code === "invalid_amount")).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = previewImport([{ ...validRow, direction: "sideways" }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "invalid_direction")).toBe(true);
  });

  it("rejects missing direction", () => {
    const { direction, ...rest } = validRow;
    const result = previewImport([rest]);
    expect(result.errors.some((e) => e.code === "missing_direction")).toBe(true);
  });

  it("rejects invalid category", () => {
    const result = previewImport([{ ...validRow, category: "gambling" }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === "invalid_category")).toBe(true);
  });

  it("accepts every valid category", () => {
    for (const cat of CASHFLOW_CATEGORIES) {
      const result = previewImport([{ ...validRow, id: `cf-${cat}`, category: cat }]);
      expect(result.errors.some((e) => e.code === "invalid_category")).toBe(false);
    }
  });

  it("computes outflow correctly", () => {
    const result = previewImport([
      { ...validRow, id: "out-1", direction: "outflow", amount: 10000 },
    ]);
    expect(result.summary.totalOutflow).toBe(10000);
    expect(result.summary.netFlow).toBe(-10000);
  });

  it("reports summary counts accurately", () => {
    const result = previewImport([
      validRow,
      { ...validRow, id: "cf-2", amount: 25000, direction: "outflow" },
      { ...validRow, id: "cf-3", asset: "DOGE" }, // error
    ]);
    expect(result.summary.totalRows).toBe(3);
    expect(result.summary.validCount).toBe(2);
    expect(result.summary.errorCount).toBe(1);
  });

  it("handles empty array", () => {
    const result = previewImport([]);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalRows).toBe(0);
  });
});
