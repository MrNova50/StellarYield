import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldCheck, TrendingUp, Activity, Droplets, RefreshCw, RotateCcw, Clock } from 'lucide-react';
import { detectDrift, resetDrift, getDriftHistory } from '../../services/riskPreferenceDriftService';
import type { DriftResult, DriftSnapshot } from '../../services/riskPreferenceDriftService';

interface DriftDimension {
  dimension: string;
  actualValue: number;
  thresholdValue: number;
  deviationPct: number;
  isDrifting: boolean;
}

const PREFERENCE_COLORS: Record<string, string> = {
  conservative: 'from-blue-500/80 to-teal-600/80',
  balanced: 'from-amber-500/80 to-orange-600/80',
  aggressive: 'from-red-500/80 to-rose-600/80',
};

const DIMENSION_ICONS: Record<string, typeof Activity> = {
  concentration: TrendingUp,
  volatility: Activity,
  liquidity: Droplets,
};

interface HistoryEntryProps {
  snapshot: DriftSnapshot;
}

function HistoryEntry({ snapshot }: HistoryEntryProps) {
  const date = new Date(snapshot.createdAt);
  const dimensions: DriftDimension[] = JSON.parse(snapshot.dimensionData || '[]');
  const driftingCount = dimensions.filter((d: DriftDimension) => d.isDrifting).length;

  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
      <div className="flex items-center gap-2">
        {snapshot.isDrifting ? (
          <AlertTriangle size={12} className="text-amber-400" />
        ) : (
          <ShieldCheck size={12} className="text-green-400" />
        )}
        <div>
          <div className="text-gray-300">
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-gray-500">Reason: {snapshot.reason}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {driftingCount > 0 && (
          <span className="text-amber-400">{driftingCount} drifting</span>
        )}
        <span className={`font-medium ${snapshot.isDrifting ? 'text-amber-400' : 'text-green-400'}`}>
          {snapshot.overallDriftPct}%
        </span>
      </div>
    </div>
  );
}

export default function RiskPreferenceDriftIndicator({ walletAddress }: { walletAddress: string }) {
  const [driftResult, setDriftResult] = useState<DriftResult | null>(null);
  const [history, setHistory] = useState<DriftSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrift = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await detectDrift(
        walletAddress,
        'balanced',
        [
          { protocol: 'Blend', weightPct: 40, volatilityPct: 6, liquidityUsd: 1_000_000 },
          { protocol: 'Soroswap', weightPct: 35, volatilityPct: 15, liquidityUsd: 300_000 },
          { protocol: 'DeFindex', weightPct: 25, volatilityPct: 8, liquidityUsd: 500_000 },
        ],
      );
      setDriftResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch drift data');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const h = await getDriftHistory(walletAddress, 5);
      setHistory(h);
    } catch {
      // silently fail — history is non-critical
    }
  };

  useEffect(() => {
    void fetchDrift();
    void fetchHistory();
  }, [walletAddress]);

  const handleReset = async () => {
    if (!resetReason.trim()) return;
    setShowResetModal(false);
    try {
      await resetDrift(walletAddress, driftResult?.statedPreference || 'balanced', resetReason.trim());
      setResetReason('');
      await fetchDrift();
      await fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset drift');
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center justify-center py-8">
          <RefreshCw size={24} className="animate-spin text-[#6C5DD3]" />
        </div>
      </div>
    );
  }

  if (error || !driftResult) {
    return (
      <div className="glass-card p-5 border border-red-500/30">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle size={16} />
          <p className="text-sm">{error || 'No drift data available'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {driftResult.isDrifting ? (
            <AlertTriangle size={18} className="text-amber-400" />
          ) : (
            <ShieldCheck size={18} className="text-green-400" />
          )}
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Risk Preference Drift
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            title="Toggle drift history"
          >
            <Clock size={14} className="text-gray-400" />
          </button>
          <span
            className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-gradient-to-r ${PREFERENCE_COLORS[driftResult.statedPreference] ?? 'from-gray-500 to-gray-600'} text-white`}
          >
            {driftResult.statedPreference}
          </span>
        </div>
      </div>

      {/* Message */}
      <div className={`text-sm font-medium ${driftResult.isDrifting ? 'text-amber-300' : 'text-green-300'}`}>
        {driftResult.message}
      </div>

      {/* Dimensions */}
      <div className="space-y-2">
        {driftResult.dimensions.map((dim) => {
          const Icon = DIMENSION_ICONS[dim.dimension] ?? Activity;
          return (
            <div
              key={dim.dimension}
              className={`flex items-center justify-between p-2.5 rounded-lg border ${
                dim.isDrifting
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className={dim.isDrifting ? 'text-amber-400' : 'text-gray-400'} />
                <span className="text-xs capitalize text-gray-300">{dim.dimension}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={dim.isDrifting ? 'text-amber-400' : 'text-gray-400'}>
                  {dim.actualValue}{dim.dimension === 'liquidity' ? '' : '%'}
                </span>
                <span className="text-gray-600">/</span>
                <span className="text-gray-500">
                  {dim.thresholdValue}{dim.dimension === 'liquidity' ? '' : '%'}
                </span>
                {dim.isDrifting && (
                  <span className="text-amber-400 font-medium">
                    +{Math.round(Math.abs(dim.deviationPct))}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall Drift Bar */}
      {driftResult.overallDriftPct > 0 && (
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-400">Overall Drift</span>
            <span className={`font-bold ${driftResult.isDrifting ? 'text-amber-400' : 'text-green-400'}`}>
              {driftResult.overallDriftPct}%
            </span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                driftResult.isDrifting ? 'bg-gradient-to-r from-amber-500 to-red-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(driftResult.overallDriftPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => setShowResetModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
        >
          <RotateCcw size={12} />
          Reset Drift
        </button>
        <button
          onClick={() => { void fetchDrift(); void fetchHistory(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs font-medium hover:bg-white/10 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Drift History</span>
            {history.length > 0 && (
              <span className="text-xs text-gray-500">{history.length} entries</span>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No drift history recorded yet.</p>
          ) : (
            history.map((snapshot) => (
              <HistoryEntry key={snapshot.id} snapshot={snapshot} />
            ))
          )}
        </div>
      )}

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowResetModal(false)}>
          <div className="glass-card p-6 max-w-md w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Reset Risk Preference Drift</h3>
            <p className="text-xs text-gray-500">Enter the reason for resetting the drift detection. This will be recorded in the audit trail.</p>
            <textarea
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
              placeholder="e.g., Portfolio rebalanced manually"
              className="w-full p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-none"
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowResetModal(false); setResetReason(''); }}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs font-medium hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={!resetReason.trim()}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
