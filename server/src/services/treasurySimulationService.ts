/**
 * Treasury Allocation Simulation Service
 *
 * Computes projected yield, liquidity risk, concentration, and rotation cost
 * for a proposed multi-position treasury deployment.
 */

export interface AllocationPosition {
  vaultId: string;
  vaultName: string;
  allocationPct: number;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  rotationCostPct: number;
}

export interface TreasuryScenario {
  id: string;
  name: string;
  totalCapitalUsd: number;
  allocations: AllocationPosition[];
  createdAt: string;
}

export interface SimulationResult {
  scenarioId: string;
  scenarioName: string;
  projectedYieldPct: number;
  projectedYieldUsd: number;
  totalRotationCostUsd: number;
  liquidityRiskScore: number;
  concentrationWarnings: string[];
  allocationBreakdown: Array<{
    vaultId: string;
    vaultName: string;
    allocationPct: number;
    capitalUsd: number;
    projectedYieldUsd: number;
  }>;
}

export function isValidAllocationPayload(allocations: unknown): boolean {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return false;
  }

  for (const item of allocations) {
    if (!item || typeof item !== 'object') return false;
    const p = item as Record<string, unknown>;
    if (typeof p.vaultId !== 'string' || p.vaultId.trim().length === 0) return false;
    if (typeof p.vaultName !== 'string') return false;
    if (!Number.isFinite(p.allocationPct)) return false;
    if (!Number.isFinite(p.apy)) return false;
    if (!Number.isFinite(p.tvlUsd)) return false;
    if (!Number.isFinite(p.riskScore)) return false;
    if (!Number.isFinite(p.rotationCostPct)) return false;
  }

  const totalPct = (allocations as Array<{ allocationPct: number }>).reduce(
    (sum, item) => sum + (item.allocationPct || 0),
    0,
  );
  return Math.abs(totalPct - 100) <= 0.01;
}

export class TreasuryValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TreasuryValidationError';
  }
}

export function assertValidScenarioInput(body: unknown): TreasuryScenario {
  if (!body || typeof body !== 'object') {
    throw new TreasuryValidationError(
      'invalid_request',
      'Request body must be a JSON object.',
    );
  }

  const payload = body as Record<string, unknown>;

  if (typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    throw new TreasuryValidationError(
      'invalid_id',
      'Field "id" is required and must be a non-empty string.',
      400,
      { field: 'id' },
    );
  }

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    throw new TreasuryValidationError(
      'invalid_name',
      'Field "name" is required and must be a non-empty string.',
      400,
      { field: 'name' },
    );
  }

  if (!Number.isFinite((payload as any).totalCapitalUsd) || (payload as any).totalCapitalUsd < 0) {
    throw new TreasuryValidationError(
      'invalid_totalCapitalUsd',
      'Field "totalCapitalUsd" is required and must be a finite number >= 0.',
      400,
      { field: 'totalCapitalUsd' },
    );
  }

  if (!Array.isArray((payload as any).allocations) || (payload as any).allocations.length === 0) {
    throw new TreasuryValidationError(
      'invalid_allocations',
      'Field "allocations" is required and must be a non-empty array.',
      400,
      { field: 'allocations' },
    );
  }

  const allocations: AllocationPosition[] = (payload as any).allocations;

  for (const [idx, item] of allocations.entries()) {
    if (!item || typeof item !== 'object') {
      throw new TreasuryValidationError(
        'invalid_allocation_item',
        `allocations[${idx}] must be an object.`,
        400,
        { index: idx },
      );
    }

    const missing: string[] = [];
    if (typeof item.vaultId !== 'string' || item.vaultId.trim().length === 0) missing.push('vaultId');
    if (typeof item.vaultName !== 'string') missing.push('vaultName');
    if (!Number.isFinite((item as any).allocationPct)) missing.push('allocationPct');
    if (!Number.isFinite((item as any).apy)) missing.push('apy');
    if (!Number.isFinite((item as any).tvlUsd)) missing.push('tvlUsd');
    if (!Number.isFinite((item as any).riskScore)) missing.push('riskScore');
    if (!Number.isFinite((item as any).rotationCostPct)) missing.push('rotationCostPct');

    if (missing.length > 0) {
      throw new TreasuryValidationError(
        'invalid_allocation',
        `allocations[${idx}] is missing required fields: ${missing.join(', ')}.`,
        400,
        { index: idx, missingFields: missing },
      );
    }
  }

  const totalAllocationPct = allocations.reduce((sum, item) => sum + (item.allocationPct as number), 0);
  if (Math.abs(totalAllocationPct - 100) > 0.01) {
    throw new TreasuryValidationError(
      'allocation_total_mismatch',
      'Allocation percentages must sum to 100.',
      400,
      { allocationTotalPct: totalAllocationPct },
    );
  }

  return {
    id: String(payload.id).trim(),
    name: String(payload.name).trim(),
    totalCapitalUsd: Number((payload as any).totalCapitalUsd),
    allocations,
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
  };
}

const CONCENTRATION_THRESHOLD = 0.5;

const scenarioStore = new Map<string, TreasuryScenario>();

export function simulateTreasury(scenario: TreasuryScenario): SimulationResult {
  const { id, name, totalCapitalUsd, allocations } = scenario;

  const warnings: string[] = [];

  let projectedYieldUsd = 0;
  let totalRotationCostUsd = 0;
  let weightedRisk = 0;

  const breakdown = allocations.map((pos) => {
    const pct = pos.allocationPct / 100;
    const capitalUsd = totalCapitalUsd * pct;
    const yieldUsd = capitalUsd * (pos.apy / 100);
    const rotationCost = capitalUsd * (pos.rotationCostPct / 100);

    projectedYieldUsd += yieldUsd;
    totalRotationCostUsd += rotationCost;
    weightedRisk += (10 - pos.riskScore) * pct;

    if (pos.allocationPct > CONCENTRATION_THRESHOLD * 100) {
      warnings.push(
        `High concentration in ${pos.vaultName} (${pos.allocationPct.toFixed(1)}%)`,
      );
    }

    return {
      vaultId: pos.vaultId,
      vaultName: pos.vaultName,
      allocationPct: pos.allocationPct,
      capitalUsd,
      projectedYieldUsd: yieldUsd,
    };
  });

  const projectedYieldPct =
    totalCapitalUsd > 0 ? (projectedYieldUsd / totalCapitalUsd) * 100 : 0;

  const liquidityRiskScore = Math.min(10, Math.max(0, weightedRisk));

  return {
    scenarioId: id,
    scenarioName: name,
    projectedYieldPct: Math.round(projectedYieldPct * 100) / 100,
    projectedYieldUsd: Math.round(projectedYieldUsd * 100) / 100,
    totalRotationCostUsd: Math.round(totalRotationCostUsd * 100) / 100,
    liquidityRiskScore: Math.round(liquidityRiskScore * 100) / 100,
    concentrationWarnings: warnings,
    allocationBreakdown: breakdown,
  };
}

export function saveScenario(scenario: TreasuryScenario): void {
  scenarioStore.set(scenario.id, scenario);
}

export function getScenario(id: string): TreasuryScenario | undefined {
  return scenarioStore.get(id);
}

export function listScenarios(): TreasuryScenario[] {
  return Array.from(scenarioStore.values());
}

export function deleteScenario(id: string): boolean {
  return scenarioStore.delete(id);
}

// ── Cashflow Import ──────────────────────────────────────────────

export const SUPPORTED_ASSETS = ["XLM", "USDC", "ETH", "BTC"] as const;
export type SupportedAsset = (typeof SUPPORTED_ASSETS)[number];

export const CASHFLOW_CATEGORIES = [
  "interest",
  "deposit",
  "withdrawal",
  "fee",
  "transfer",
  "other",
] as const;
export type CashflowCategory = (typeof CASHFLOW_CATEGORIES)[number];

export interface CashflowRow {
  id: string;
  date: string;
  asset: string;
  amount: number;
  direction: "inflow" | "outflow";
  category: string;
  memo?: string;
}

export interface CashflowRowError {
  rowIndex: number;
  field: string;
  code: string;
  message: string;
}

export interface CashflowRowWarning {
  rowIndex: number;
  field: string;
  code: string;
  message: string;
}

export interface CashflowImportPreview {
  validRows: CashflowRow[];
  errors: CashflowRowError[];
  warnings: CashflowRowWarning[];
  summary: {
    totalRows: number;
    validCount: number;
    errorCount: number;
    warningCount: number;
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
  };
}

type RowValidationResult = {
  row: CashflowRow | null;
  errors: CashflowRowError[];
  warnings: CashflowRowWarning[];
};

function parseDateSafe(raw: string): Date | null {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

function validateSingleCashflowRow(
  raw: unknown,
  rowIndex: number,
  knownIds: Set<string>,
): RowValidationResult {
  const errors: CashflowRowError[] = [];
  const warnings: CashflowRowWarning[] = [];

  if (!raw || typeof raw !== "object") {
    errors.push({
      rowIndex,
      field: "_root",
      code: "not_an_object",
      message: `Row ${rowIndex} must be an object.`,
    });
    return { row: null, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;
  const row: Partial<CashflowRow> = {};

  // id
  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    errors.push({
      rowIndex,
      field: "id",
      code: "missing_id",
      message: `Row ${rowIndex}: "id" is required and must be a non-empty string.`,
    });
  } else if (knownIds.has(obj.id.trim())) {
    errors.push({
      rowIndex,
      field: "id",
      code: "duplicate_id",
      message: `Row ${rowIndex}: duplicate id "${obj.id}".`,
    });
  } else {
    row.id = obj.id.trim();
    knownIds.add(row.id);
  }

  // date
  if (typeof obj.date !== "string" || obj.date.trim().length === 0) {
    errors.push({
      rowIndex,
      field: "date",
      code: "missing_date",
      message: `Row ${rowIndex}: "date" is required and must be a string.`,
    });
  } else {
    const parsed = parseDateSafe(obj.date);
    if (!parsed) {
      errors.push({
        rowIndex,
        field: "date",
        code: "invalid_date",
        message: `Row ${rowIndex}: "${obj.date}" is not a valid date.`,
      });
    } else if (parsed > new Date()) {
      warnings.push({
        rowIndex,
        field: "date",
        code: "future_date",
        message: `Row ${rowIndex}: date "${obj.date}" is in the future.`,
      });
      row.date = obj.date;
    } else {
      row.date = obj.date;
    }
  }

  // asset
  if (typeof obj.asset !== "string" || obj.asset.trim().length === 0) {
    errors.push({
      rowIndex,
      field: "asset",
      code: "missing_asset",
      message: `Row ${rowIndex}: "asset" is required.`,
    });
  } else {
    const asset = obj.asset.trim().toUpperCase();
    if (!(SUPPORTED_ASSETS as readonly string[]).includes(asset)) {
      errors.push({
        rowIndex,
        field: "asset",
        code: "unsupported_asset",
        message: `Row ${rowIndex}: "${obj.asset}" is not supported. Supported: ${SUPPORTED_ASSETS.join(", ")}.`,
      });
    } else {
      row.asset = asset;
    }
  }

  // amount
  if (obj.amount === undefined || obj.amount === null) {
    errors.push({
      rowIndex,
      field: "amount",
      code: "missing_amount",
      message: `Row ${rowIndex}: "amount" is required.`,
    });
  } else if (typeof obj.amount !== "number" || !Number.isFinite(obj.amount)) {
    errors.push({
      rowIndex,
      field: "amount",
      code: "invalid_amount",
      message: `Row ${rowIndex}: "amount" must be a finite number.`,
    });
  } else if ((obj.amount as number) <= 0) {
    errors.push({
      rowIndex,
      field: "amount",
      code: "negative_amount",
      message: `Row ${rowIndex}: "amount" must be greater than 0.`,
    });
  } else {
    row.amount = obj.amount as number;
  }

  // direction
  if (typeof obj.direction !== "string") {
    errors.push({
      rowIndex,
      field: "direction",
      code: "missing_direction",
      message: `Row ${rowIndex}: "direction" is required.`,
    });
  } else {
    const dir = obj.direction.toLowerCase();
    if (dir !== "inflow" && dir !== "outflow") {
      errors.push({
        rowIndex,
        field: "direction",
        code: "invalid_direction",
        message: `Row ${rowIndex}: "direction" must be "inflow" or "outflow".`,
      });
    } else {
      row.direction = dir;
    }
  }

  // category
  if (typeof obj.category !== "string" || obj.category.trim().length === 0) {
    errors.push({
      rowIndex,
      field: "category",
      code: "missing_category",
      message: `Row ${rowIndex}: "category" is required.`,
    });
  } else {
    const cat = obj.category.toLowerCase();
    if (!(CASHFLOW_CATEGORIES as readonly string[]).includes(cat)) {
      errors.push({
        rowIndex,
        field: "category",
        code: "invalid_category",
        message: `Row ${rowIndex}: "${obj.category}" is not a valid category. Valid: ${CASHFLOW_CATEGORIES.join(", ")}.`,
      });
    } else {
      row.category = cat;
    }
  }

  // memo (optional)
  if (obj.memo !== undefined && obj.memo !== null) {
    row.memo = String(obj.memo);
  }

  const hasErrors = errors.length > 0;
  return {
    row: hasErrors ? null : (row as CashflowRow),
    errors,
    warnings,
  };
}

function computeSummary(
  validRows: CashflowRow[],
): CashflowImportPreview["summary"] {
  let totalInflow = 0;
  let totalOutflow = 0;
  for (const r of validRows) {
    if (r.direction === "inflow") totalInflow += r.amount;
    else totalOutflow += r.amount;
  }
  return {
    totalRows: 0, // filled by caller
    validCount: validRows.length,
    errorCount: 0, // filled by caller
    warningCount: 0, // filled by caller
    totalInflow,
    totalOutflow,
    netFlow: totalInflow - totalOutflow,
  };
}

export function previewImport(rows: unknown[]): CashflowImportPreview {
  const knownIds = new Set<string>();
  let allErrors: CashflowRowError[] = [];
  let allWarnings: CashflowRowWarning[] = [];
  const validRows: CashflowRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = validateSingleCashflowRow(rows[i], i, knownIds);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
    if (result.row) validRows.push(result.row);
  }

  const summary = computeSummary(validRows);
  summary.totalRows = rows.length;
  summary.errorCount = allErrors.length;
  summary.warningCount = allWarnings.length;

  return { validRows, errors: allErrors, warnings: allWarnings, summary };
}