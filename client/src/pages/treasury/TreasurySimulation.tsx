import React, { useState } from "react";
import { Vault, TrendingUp, AlertTriangle, AlertCircle, Info, Save, RotateCcw, Upload, FileText } from "lucide-react";
import { FeeAssumptionsModal } from "../../components/FeeAssumptionsModal";
import { apiUrl } from "../../lib/api";
import { decodeTransactionError } from "../../utils/errorDecoder";
import type { SimulationWarning } from "../../../../shared/types/simulationWarning";

interface AllocationRow {
  vaultId: string;
  vaultName: string;
  allocationPct: number;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  rotationCostPct: number;
}

interface SimResult {
  scenarioId: string;
  scenarioName: string;
  projectedYieldPct: number;
  projectedYieldUsd: number;
  totalRotationCostUsd: number;
  liquidityRiskScore: number;
  /** @deprecated Prefer `warnings` for structured rendering. */
  concentrationWarnings: string[];
  /** Structured warnings with severity, affected field, and remediation. */
  warnings?: SimulationWarning[];
  allocationBreakdown: Array<{
    vaultId: string;
    vaultName: string;
    allocationPct: number;
    capitalUsd: number;
    projectedYieldUsd: number;
  }>;
}

// ── Structured warning renderer ─────────────────────────────────────────────

const SEVERITY_ICON: Record<SimulationWarning["severity"], React.ReactElement> = {
  info: <Info size={14} className="text-blue-400 shrink-0" />,
  warning: <AlertTriangle size={14} className="text-yellow-400 shrink-0" />,
  critical: <AlertCircle size={14} className="text-red-400 shrink-0" />,
};

const SEVERITY_CLASSES: Record<
  SimulationWarning["severity"],
  { container: string; message: string }
> = {
  info: { container: "bg-blue-500/10 border border-blue-500/20", message: "text-blue-300" },
  warning: { container: "bg-yellow-500/10 border border-yellow-500/20", message: "text-yellow-300" },
  critical: { container: "bg-red-500/10 border border-red-500/20", message: "text-red-300" },
};

function SimWarningCard({ warning }: { warning: SimulationWarning }) {
  const cls = SEVERITY_CLASSES[warning.severity];
  return (
    <div className={`flex gap-2 p-3 rounded-lg ${cls.container}`} role="alert">
      <div className="mt-0.5">{SEVERITY_ICON[warning.severity]}</div>
      <div className="text-sm space-y-0.5">
        <p className={`font-medium ${cls.message}`}>{warning.message}</p>
        <p className="text-gray-400 text-xs">
          <span className="font-semibold text-gray-300">Suggestion: </span>
          {warning.remediation}
        </p>
        {warning.affectedField && (
          <p className="text-gray-500 text-xs font-mono">Field: {warning.affectedField}</p>
        )}
      </div>
    </div>
  );
}

const DEFAULT_ALLOCATIONS: AllocationRow[] = [
  { vaultId: "blend", vaultName: "Blend", allocationPct: 60, apy: 6.5, tvlUsd: 12_000_000, riskScore: 8, rotationCostPct: 0.1 },
  { vaultId: "soroswap", vaultName: "Soroswap", allocationPct: 40, apy: 11.2, tvlUsd: 4_500_000, riskScore: 6, rotationCostPct: 0.2 },
];

const TreasurySimulation: React.FC = () => {
  const [scenarioName, setScenarioName] = useState("My Treasury Scenario");
  const [totalCapital, setTotalCapital] = useState("1000000");
  const [allocations, setAllocations] = useState<AllocationRow[]>(DEFAULT_ALLOCATIONS);
  const [result, setResult] = useState<SimResult | null>(null);
  const [isFeeModalOpen, setIsFeeModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Cashflow Import ──────────────────────────────────────────────

  interface CashflowRowError {
    rowIndex: number;
    field: string;
    code: string;
    message: string;
  }

  interface CashflowRowWarning {
    rowIndex: number;
    field: string;
    code: string;
    message: string;
  }

  interface CashflowImportPreview {
    validRows: unknown[];
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

  const [rawJson, setRawJson] = useState("");
  const [cashflowPreview, setCashflowPreview] = useState<CashflowImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importedCount, setImportedCount] = useState(0);

  async function handlePreview() {
    setImportError("");
    setCashflowPreview(null);
    let parsed: unknown[];
    try {
      parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) throw new Error("Top-level value must be an array.");
    } catch (e) {
      setImportError("Invalid JSON: " + (e as Error).message);
      return;
    }
    setImportLoading(true);
    try {
      const res = await fetch(apiUrl("/api/treasury/cashflow/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      if (!res.ok) {
        const body = await res.json();
        setImportError(body.error ?? "Preview request failed");
      } else {
        setCashflowPreview(await res.json());
      }
    } catch {
      setImportError("Network error");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImport() {
    if (!cashflowPreview || cashflowPreview.errors.length > 0) return;
    setImportError("");
    setImportLoading(true);
    try {
      const res = await fetch(apiUrl("/api/treasury/cashflow/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: `${Date.now()}`,
          rows: cashflowPreview.validRows,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setImportError(body.error ?? "Import failed");
      } else {
        const result = await res.json();
        setImportedCount((c) => c + result.imported);
        setCashflowPreview(null);
        setRawJson("");
      }
    } catch {
      setImportError("Network error");
    } finally {
      setImportLoading(false);
    }
  }

  const totalPct = allocations.reduce((s, a) => s + a.allocationPct, 0);

  function updateAlloc(index: number, field: keyof AllocationRow, value: string | number) {
    setAllocations((prev) => {
      const next = [...prev];
      (next[index] as unknown as Record<string, unknown>)[field] = value;
      return next;
    });
  }

  async function handleSimulate(shouldSave = false) {
    setError("");
    const capital = parseFloat(totalCapital);
    if (!Number.isFinite(capital) || capital <= 0) {
      setError("Total capital must be a positive number");
      return;
    }
    if (Math.abs(totalPct - 100) > 0.01) {
      setError(`Allocations must sum to 100% (currently ${totalPct.toFixed(1)}%)`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/treasury/simulate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scenarioName,
          totalCapitalUsd: capital,
          allocations,
          save: shouldSave,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Simulation failed");
      } else {
        setResult(await res.json());
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Vault size={32} className="text-indigo-400" />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-extrabold tracking-tight">Treasury Simulation</h2>
            <button
              onClick={() => setIsFeeModalOpen(true)}
              className="text-gray-400 hover:text-white transition-colors cursor-pointer"
              aria-label="View fee assumptions"
            >
              <Info size={18} />
            </button>
          </div>
          <p className="text-gray-400 text-sm">
            Model multi-position deployments before moving capital.
          </p>
        </div>
      </div>

      {/* Scenario Config */}
      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-lg font-semibold">Scenario</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Scenario Name</label>
            <input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="w-full bg-black/50 border border-gray-600 rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Total Capital (USD)</label>
            <input
              type="number"
              value={totalCapital}
              onChange={(e) => setTotalCapital(e.target.value)}
              className="w-full bg-black/50 border border-gray-600 rounded-lg px-3 py-2 text-white"
            />
          </div>
        </div>
      </div>

      {/* Allocation Table */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Allocations</h3>
          <span className={`text-sm font-semibold ${Math.abs(totalPct - 100) < 0.01 ? "text-green-400" : "text-yellow-400"}`}>
            Total: {totalPct.toFixed(1)}%
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs uppercase tracking-widest">
                <th className="text-left py-2">Vault</th>
                <th className="text-left py-2">Alloc %</th>
                <th className="text-left py-2">APY %</th>
                <th className="text-left py-2">Risk Score</th>
                <th className="text-left py-2">Rotation Cost %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {allocations.map((a, i) => (
                <tr key={a.vaultId}>
                  <td className="py-2 font-medium text-white">{a.vaultName}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={a.allocationPct}
                      onChange={(e) => updateAlloc(i, "allocationPct", parseFloat(e.target.value) || 0)}
                      className="w-20 bg-black/50 border border-gray-600 rounded px-2 py-1 text-white"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={0}
                      value={a.apy}
                      onChange={(e) => updateAlloc(i, "apy", parseFloat(e.target.value) || 0)}
                      className="w-20 bg-black/50 border border-gray-600 rounded px-2 py-1 text-white"
                    />
                  </td>
                  <td className="py-2">
                    <span className={a.riskScore >= 7 ? "text-green-400" : a.riskScore >= 4 ? "text-yellow-400" : "text-red-400"}>
                      {a.riskScore}/10
                    </span>
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={0}
                      value={a.rotationCostPct}
                      onChange={(e) => updateAlloc(i, "rotationCostPct", parseFloat(e.target.value) || 0)}
                      className="w-20 bg-black/50 border border-gray-600 rounded px-2 py-1 text-white"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cashflow Import */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Upload size={18} className="text-indigo-400" />
          <h3 className="text-lg font-semibold">Cashflow Import</h3>
          {importedCount > 0 && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              {importedCount} imported
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Paste a JSON array of cashflow rows to preview validation before import.
          Each row requires: <code className="text-indigo-300">id</code>,{" "}
          <code className="text-indigo-300">date</code>,{" "}
          <code className="text-indigo-300">asset</code>,{" "}
          <code className="text-indigo-300">amount</code>,{" "}
          <code className="text-indigo-300">direction</code>,{" "}
          <code className="text-indigo-300">category</code>.
        </p>
        <textarea
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          placeholder={`[\n  { "id": "cf-1", "date": "2025-06-01", "asset": "USDC", "amount": 50000, "direction": "inflow", "category": "interest", "memo": "Q2 yield" }\n]`}
          className="w-full h-32 bg-black/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono"
        />
        <div className="flex gap-3">
          <button
            onClick={handlePreview}
            disabled={importLoading || !rawJson.trim()}
            className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2"
          >
            <FileText size={16} />
            {importLoading ? "Loading…" : "Preview"}
          </button>
          <button
            onClick={handleImport}
            disabled={importLoading || !cashflowPreview || cashflowPreview.errors.length > 0}
            className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2"
          >
            <Upload size={16} />
            Import Valid Rows
          </button>
        </div>

        {importError && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-sm text-red-300">{importError}</span>
          </div>
        )}

        {cashflowPreview && (
          <div className="space-y-3 border border-white/10 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
              Preview — {cashflowPreview.summary.totalRows} rows
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
                <p className="text-green-400 font-bold">{cashflowPreview.summary.validCount}</p>
                <p className="text-gray-500">Valid</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                <p className="text-red-400 font-bold">{cashflowPreview.summary.errorCount}</p>
                <p className="text-gray-500">Errors</p>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 text-center">
                <p className="text-yellow-400 font-bold">{cashflowPreview.summary.warningCount}</p>
                <p className="text-gray-500">Warnings</p>
              </div>
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2 text-center">
                <p className="text-indigo-400 font-bold">${cashflowPreview.summary.totalInflow.toLocaleString()}</p>
                <p className="text-gray-500">Inflow</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-center">
                <p className="text-purple-400 font-bold">${cashflowPreview.summary.totalOutflow.toLocaleString()}</p>
                <p className="text-gray-500">Outflow</p>
              </div>
            </div>

            {cashflowPreview.errors.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-red-400 mb-1">Errors</h5>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {cashflowPreview.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-red-500/5 border border-red-500/10 rounded text-xs">
                      <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                      <span className="text-red-300">{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cashflowPreview.warnings.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-yellow-400 mb-1">Warnings</h5>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {cashflowPreview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-yellow-500/5 border border-yellow-500/10 rounded text-xs">
                      <AlertTriangle size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                      <span className="text-yellow-300">{w.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (() => {
        const decoded = decodeTransactionError(error);
        const isGeneric = decoded.title === "Transaction Failed" && decoded.code === undefined;
        return (
          <div className="flex flex-col gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <span className="text-sm font-bold text-red-400">
                {isGeneric ? "Simulation Error" : decoded.title}
              </span>
            </div>
            <p className="text-sm text-red-300 pl-7 break-words">
              {isGeneric ? error : decoded.message}
            </p>
            {!isGeneric && decoded.suggestion && (
              <div className="mt-1 ml-7 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-3 py-2 rounded-lg">
                <span className="font-semibold text-indigo-200">Suggestion: </span>
                {decoded.suggestion}
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex gap-3">
        <button
          onClick={() => handleSimulate(false)}
          disabled={loading}
          className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
        >
          <TrendingUp size={18} />
          {loading ? "Simulating…" : "Run Simulation"}
        </button>
        <button
          onClick={() => handleSimulate(true)}
          disabled={loading}
          className="px-5 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
        >
          <Save size={18} /> Save
        </button>
        <button
          onClick={() => { setResult(null); setError(""); }}
          className="px-5 bg-white/5 hover:bg-white/10 text-gray-400 py-3 rounded-lg"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      {result && (
        <div className="glass-panel p-6 space-y-6 border border-indigo-500/20">
          <h3 className="text-xl font-bold text-white">Simulation Results — {result.scenarioName}</h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Projected Yield</p>
              <p className="text-2xl font-bold text-green-400">{result.projectedYieldPct.toFixed(2)}%</p>
              <p className="text-xs text-gray-500">${result.projectedYieldUsd.toLocaleString()}</p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-widest">
                <span>Rotation Cost</span>
                <button
                  onClick={() => setIsFeeModalOpen(true)}
                  className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                  aria-label="View fee assumptions"
                >
                  <Info size={12} />
                </button>
              </div>
              <p className="text-2xl font-bold text-yellow-400">${result.totalRotationCostUsd.toLocaleString()}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Liquidity Risk</p>
              <p className={`text-2xl font-bold ${result.liquidityRiskScore <= 3 ? "text-green-400" : result.liquidityRiskScore <= 6 ? "text-yellow-400" : "text-red-400"}`}>
                {result.liquidityRiskScore.toFixed(1)}/10
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Warnings</p>
              <p className="text-2xl font-bold text-white">{(result.warnings ?? result.concentrationWarnings).length}</p>
            </div>
          </div>

          {/* Structured warnings — preferred when server returns them */}
          {result.warnings && result.warnings.length > 0 && (
            <div className="space-y-2">
              {result.warnings.map((w, i) => (
                <SimWarningCard key={i} warning={w} />
              ))}
            </div>
          )}

          {/* Legacy plain-string warnings fallback (for older server responses) */}
          {(!result.warnings || result.warnings.length === 0) && result.concentrationWarnings.length > 0 && (
            <div className="space-y-2">
              {result.concentrationWarnings.map((w, i) => (
                <div key={i} className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
                  <span className="text-sm text-yellow-300">{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Breakdown</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase">
                  <th className="text-left py-1">Vault</th>
                  <th className="text-right py-1">Alloc %</th>
                  <th className="text-right py-1">Capital</th>
                  <th className="text-right py-1">Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {result.allocationBreakdown.map((b) => (
                  <tr key={b.vaultId}>
                    <td className="py-2 text-white">{b.vaultName}</td>
                    <td className="py-2 text-right text-gray-300">{b.allocationPct}%</td>
                    <td className="py-2 text-right text-gray-300">${b.capitalUsd.toLocaleString()}</td>
                    <td className="py-2 text-right text-green-400">${b.projectedYieldUsd.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <FeeAssumptionsModal
        isOpen={isFeeModalOpen}
        onClose={() => setIsFeeModalOpen(false)}
      />
    </div>
  );
};

export default TreasurySimulation;
