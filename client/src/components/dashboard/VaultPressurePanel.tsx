"use client";

import React from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import type { VaultPressureMetrics, PressureLevel } from "../../../../server/src/services/vaultPressureService";
import type { EvidenceBasedRiskLevel } from "../../config/riskConfig";

const LEVEL_STYLES: Record<PressureLevel, { bg: string; text: string; label: string }> = {
  NORMAL:   { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Normal"   },
  ELEVATED: { bg: "bg-yellow-500/20",  text: "text-yellow-400",  label: "Elevated" },
  HIGH:     { bg: "bg-orange-500/20",  text: "text-orange-400",  label: "High"     },
  CRITICAL: { bg: "bg-red-500/20",     text: "text-red-400",     label: "Critical" },
};

interface Props {
  metrics: VaultPressureMetrics | null;
  loading?: boolean;
  /** Evidence-backed risk level. When provided, a risk explanation is shown. */
  riskLevel?: EvidenceBasedRiskLevel;
}

function PressureBadge({ level }: { level: PressureLevel }) {
  const { bg, text, label } = LEVEL_STYLES[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bg} ${text}`}>
      <span className={`size-1.5 rounded-full ${text.replace("text-", "bg-")}`} />
      {label}
    </span>
  );
}

/**
 * VaultPressurePanel (#276)
 *
 * Displays aggregated inflow/outflow pressure metrics for a vault.
 * Does not expose individual user data — all values are aggregate-only.
 */
const CONFIDENCE_LABEL: Record<EvidenceBasedRiskLevel["confidence"], string> = {
  high:    "High confidence",
  medium:  "Medium confidence",
  low:     "Low confidence — stale data",
  unknown: "Confidence unknown",
};

const RISK_BADGE: Record<EvidenceBasedRiskLevel["level"], { color: string; bg: string }> = {
  Low:    { color: "text-green-400",  bg: "bg-green-500/15"  },
  Medium: { color: "text-yellow-400", bg: "bg-yellow-500/15" },
  High:   { color: "text-red-400",    bg: "bg-red-500/15"    },
};

export function VaultPressurePanel({ metrics, loading, riskLevel }: Props) {
  const reducedMotion = useReducedMotion();

  if (loading) {
    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-4 space-y-2 ${reducedMotion ? "" : "animate-pulse"}`}>
        <div className="h-4 w-40 rounded bg-white/10" />
        <div className="h-8 w-full rounded bg-white/10" />
      </div>
    );
  }

  if (!metrics) return null;

  const windowMin = Math.round(metrics.windowMs / 60_000);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Flow Pressure</h3>
        <span className="text-xs text-gray-500">{windowMin}m window</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-black/20 p-3 space-y-1">
          <p className="text-xs text-gray-400">Inflow</p>
          <p className="text-base font-bold text-white">
            {metrics.inflowVelocity.toFixed(2)} <span className="text-xs text-gray-500">USDC/s</span>
          </p>
          <PressureBadge level={metrics.inflowPressure} />
        </div>
        <div className="rounded-lg bg-black/20 p-3 space-y-1">
          <p className="text-xs text-gray-400">Outflow</p>
          <p className="text-base font-bold text-white">
            {metrics.outflowVelocity.toFixed(2)} <span className="text-xs text-gray-500">USDC/s</span>
          </p>
          <PressureBadge level={metrics.outflowPressure} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>Net: <span className={metrics.netVelocity >= 0 ? "text-emerald-400" : "text-red-400"}>{metrics.netVelocity >= 0 ? "+" : ""}{metrics.netVelocity.toFixed(2)} USDC/s</span></span>
        <span>{metrics.eventCount} events</span>
      </div>

      {(metrics.inflowPressure === "HIGH" || metrics.inflowPressure === "CRITICAL" ||
        metrics.outflowPressure === "HIGH" || metrics.outflowPressure === "CRITICAL") && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
          ⚠ Unusual flow pressure detected. Execution quality may be affected.
        </div>
      )}

      {riskLevel && (
        <div className={`rounded-lg border px-3 py-2 space-y-1 ${riskLevel.confidence === "unknown" || riskLevel.confidence === "low" ? "border-gray-500/30 bg-gray-500/10" : `border-white/10 ${RISK_BADGE[riskLevel.level].bg}`}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${RISK_BADGE[riskLevel.level].color}`}>
              {riskLevel.level} Risk
            </span>
            <span className="text-xs text-gray-500">
              {CONFIDENCE_LABEL[riskLevel.confidence]}
            </span>
          </div>
          <p className="text-xs text-gray-300">{riskLevel.explanation}</p>
          {riskLevel.staleSources.length > 0 && (
            <p className="text-xs text-gray-500">
              Stale: {riskLevel.staleSources.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
