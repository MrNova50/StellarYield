import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { useWallet } from "../../context/useWallet";
import {
  TrendingUp,
  TrendingDown,
  Loader2,
  DollarSign,
  BarChart3,
  AlertTriangle,
  Info,
} from "lucide-react";
import { getApiBaseUrl } from "../../lib/api";
import ApiErrorBanner from "../../components/ApiErrorBanner/ApiErrorBanner";

interface PnLComponentBreakdown {
  realized: number;
  unrealized: number;
  fees: number;
  rewards: number;
}

interface DailyPnLSnapshot {
  date: string;
  cumulativePnL: number;
  portfolioValue: number;
  sharePrice: number;
  components?: PnLComponentBreakdown;
}

interface TaxLot {
  id: string;
  amount: number;
  costBasisPerToken: number;
  acquiredAt: string;
  source: string;
  txHash: string;
}

interface PnLData {
  method: string;
  totalDeposited: string;
  totalWithdrawn: string;
  currentValue: number;
  costBasis: number;
  components: PnLComponentBreakdown;
  absolutePnL: number;
  twrPercent: number;
  activeLots: TaxLot[];
  valuationSource: string;
  isStale: boolean;
  dailySnapshots: DailyPnLSnapshot[];
}

const getApiBase = () => {
  try {
    return getApiBaseUrl();
  } catch {
    return "";
  }
};

/**
 * Detects if PnL data is empty or insufficient for rendering.
 */
function hasNoData(data: PnLData | null): boolean {
  if (!data) return true;
  if (Number(data.totalDeposited) === 0 && data.dailySnapshots.length === 0) {
    return true;
  }
  return false;
}

/**
 * Detects if we have summary data but no chart data.
 */
function hasPartialData(data: PnLData | null): boolean {
  if (!data) return false;
  return Number(data.totalDeposited) > 0 && data.dailySnapshots.length === 0;
}

/**
 * Format a value (18 decimal precision) to a display USD string.
 * Accepts number, bigint, or string representations.
 */
function formatBigIntValue(value: number | bigint | string): string {
  let num: number;
  if (typeof value === 'bigint') {
    num = Number(value) / 1e18;
  } else if (typeof value === 'string') {
    num = Number(value) / 1e18;
  } else {
    num = value;
  }
  return Math.abs(num)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * PnLChart — Visualizes a user's historical profit & loss with an area chart.
 *
 * Shows total deposited, withdrawn, current value, absolute PnL, and
 * Time-Weighted Return, alongside a daily cumulative PnL chart.
 * Supports component breakdowns and stale valuation warnings.
 */
export default function PnLChart() {
  const { isConnected, walletAddress } = useWallet();
  const [pnlData, setPnlData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComponentBreakdown, setShowComponentBreakdown] = useState(false);

  const fetchPnL = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${getApiBase()}/api/users/${encodeURIComponent(walletAddress)}/pnl`,
      );
      if (!res.ok) {
        throw new Error("Failed to fetch PnL data");
      }
      const data: PnLData = await res.json();
      setPnlData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch PnL data");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (isConnected && walletAddress) {
      void fetchPnL();
    }
  }, [isConnected, walletAddress, fetchPnL]);

  if (!isConnected) {
    return (
      <div className="glass-panel p-8 text-center">
        <DollarSign className="mx-auto mb-4 text-indigo-400" size={48} />
        <h2 className="text-xl font-bold mb-2">Profit & Loss</h2>
        <p className="text-gray-400">
          Connect your wallet to view your historical PnL.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass-panel p-8 text-center">
        <Loader2
          className="mx-auto mb-4 animate-spin text-indigo-400"
          size={48}
        />
        <p className="text-gray-400">Calculating your PnL...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-8">
        <ApiErrorBanner message={error} onRetry={fetchPnL} />
      </div>
    );
  }

  // Complete no-data state
  if (hasNoData(pnlData)) {
    return (
      <div className="glass-panel p-8 text-center">
        <DollarSign className="mx-auto mb-4 text-gray-400" size={48} />
        <h2 className="text-xl font-bold mb-2">No P&L Data Yet</h2>
        <p className="text-gray-400">
          Make your first deposit to start tracking your profit and loss.
        </p>
      </div>
    );
  }

  const showPartialDataWarning = hasPartialData(pnlData);
  const data = pnlData;
  if (!data) return null;

  const isProfit = data.absolutePnL >= 0;
  const pnlColor = isProfit ? "text-green-400" : "text-red-400";
  const chartColor = isProfit ? "#4ade80" : "#f87171";
  const chartGradient = isProfit
    ? "url(#profitGradient)"
    : "url(#lossGradient)";

  // Prepare component breakdown chart data
  const componentData = data.components
    ? [
        { name: "Realized", value: Math.abs(data.components.realized), fill: "#4ade80" },
        { name: "Unrealized", value: Math.abs(data.components.unrealized), fill: "#60a5fa" },
        { name: "Fees", value: Math.abs(data.components.fees), fill: "#f87171" },
        { name: "Rewards", value: Math.abs(data.components.rewards), fill: "#fbbf24" },
      ]
    : [];

  return (
    <div className="glass-panel p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <DollarSign className="text-indigo-400" size={24} />
          Profit & Loss
          <span className="text-xs text-gray-500 font-normal ml-2">
            ({data.method === 'fifo' ? 'FIFO' : 'Avg Cost'})
          </span>
        </h2>
        {isProfit ? (
          <TrendingUp className="text-green-400" size={24} />
        ) : (
          <TrendingDown className="text-red-400" size={24} />
        )}
      </div>

      {/* Stale Valuation Warning */}
      {data.isStale && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle className="text-yellow-400 shrink-0" size={16} />
          <p className="text-xs text-yellow-300">
            Valuation data may be stale. Last source: {data.valuationSource}
          </p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Deposited"
          value={`$${formatBigIntValue(data.totalDeposited)}`}
        />
        <StatCard
          label="Total Withdrawn"
          value={`$${formatBigIntValue(data.totalWithdrawn)}`}
        />
        <StatCard
          label="Current Value"
          value={`$${formatBigIntValue(data.currentValue)}`}
          highlight
        />
        <StatCard
          label="Absolute PnL"
          value={`${isProfit ? "+" : "-"}$${formatBigIntValue(data.absolutePnL)}`}
          className={pnlColor}
        />
      </div>

      {/* TWR Badge */}
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-sm">Time-Weighted Return:</span>
        <span className={`text-lg font-bold ${pnlColor}`}>
          {data.twrPercent >= 0 ? "+" : ""}
          {formatBigIntValue(data.twrPercent)}%
        </span>
      </div>

      {/* PnL Component Breakdown Toggle */}
      {data.components && (
        <div>
          <button
            type="button"
            onClick={() => setShowComponentBreakdown(!showComponentBreakdown)}
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300"
          >
            <Info size={16} />
            {showComponentBreakdown ? "Hide" : "Show"} Component Breakdown
          </button>

          {showComponentBreakdown && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <MiniStatCard
                label="Realized PnL"
                value={data.components.realized}
                isPositive={data.components.realized >= 0}
              />
              <MiniStatCard
                label="Unrealized PnL"
                value={data.components.unrealized}
                isPositive={data.components.unrealized >= 0}
              />
              <MiniStatCard
                label="Fees Paid"
                value={data.components.fees}
                isPositive={false}
              />
              <MiniStatCard
                label="Rewards Earned"
                value={data.components.rewards}
                isPositive={true}
              />
            </div>
          )}
        </div>
      )}

      {/* Component Breakdown Bar Chart */}
      {showComponentBreakdown && componentData.length > 0 && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={componentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="name"
                tick={{ fill: "#9ca3af", fontSize: 12 }}
              />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 12 }}
                tickFormatter={(val: number) => `$${val.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {componentData.map((entry, index) => (
                  <rect key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* PnL Chart */}
      {data.dailySnapshots.length > 0 ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dailySnapshots}>
              <defs>
                <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#9ca3af", fontSize: 12 }}
                tickFormatter={(val: string) => val.slice(5)}
              />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 12 }}
                tickFormatter={(val: number) => `$${val.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "PnL"]}
              />
              <Area
                type="monotone"
                dataKey="cumulativePnL"
                stroke={chartColor}
                fill={chartGradient}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center bg-white/5 rounded-lg border border-gray-700/50">
          <BarChart3 className="text-gray-500 mb-3" size={48} />
          <p className="text-gray-400 text-sm font-medium mb-1">
            No Chart Data Available
          </p>
          <p className="text-gray-500 text-xs max-w-xs text-center">
            {showPartialDataWarning
              ? "Historical chart data is being generated. Check back soon."
              : "Daily snapshots will appear once data is collected."}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`bg-white/5 rounded-xl p-4 ${highlight ? "ring-1 ring-indigo-500/30" : ""}`}
    >
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-lg font-bold ${className || "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniStatCard({
  label,
  value,
  isPositive,
}: {
  label: string;
  value: number;
  isPositive: boolean;
}) {
  const color = isPositive ? "text-green-400" : "text-red-400";
  return (
    <div className="bg-white/5 rounded-lg p-3">
      <p className="text-gray-400 text-xs mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${color}`}>
        {isPositive ? "+" : "-"}${formatBigIntValue(value)}
      </p>
    </div>
  );
}