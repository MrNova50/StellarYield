import { useCallback, useEffect, useState } from "react";
import { ArrowUpFromLine, Loader2 } from "lucide-react";
import TxStatusTimeline from "../../components/transaction/TxStatusTimeline";
import TransactionFailedModal from "../../components/transaction/TransactionFailedModal";
import { decodeTransactionError } from "../../utils/errorDecoder";
import { withdraw, getUserShares } from "../../services/soroban";
import { TX_PHASE_PIPELINE, type TxPhase } from "../../services/transactionPhase";
import { parseDecimalToStroops, formatStroopsToDecimal } from "../zap/amount";
import { getVaultTokenFromEnv } from "../zap/assets";

export interface WithdrawPanelProps {
  walletAddress: string | null;
}

export default function WithdrawPanel({ walletAddress }: WithdrawPanelProps) {
  const vaultToken = getVaultTokenFromEnv();

  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [lastProgressPhase, setLastProgressPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const shares = await getUserShares(walletAddress);
      setShareBalance(shares);
      setBalanceError(null);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : "Could not load share balance");
    }
  }, [walletAddress]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const emitPhase = useCallback((p: TxPhase) => {
    setTxPhase(p);
    if (p !== "success" && p !== "failure") {
      setLastProgressPhase(p);
    }
  }, []);

  const handleWithdraw = useCallback(async () => {
    if (!walletAddress) return;
    let shares: bigint;
    try {
      shares = parseDecimalToStroops(amount, vaultToken.decimals);
    } catch {
      setError("Enter a valid amount");
      return;
    }
    if (shares <= 0n) return;
    if (shareBalance !== null && shares > shareBalance) {
      setError("Amount exceeds your share balance");
      return;
    }

    setLastProgressPhase("idle");
    setTxPhase("idle");
    setTxHash(null);
    setError("");
    setShowFailedModal(false);
    setSubmitting(true);

    try {
      const result = await withdraw(walletAddress, shares, emitPhase);
      if (!result.success) {
        throw new Error(result.error || "Withdrawal failed");
      }
      setTxHash(result.hash ?? null);
      setAmount("");
      void refreshBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      setShowFailedModal(true);
    } finally {
      setSubmitting(false);
    }
  }, [walletAddress, amount, vaultToken.decimals, shareBalance, emitPhase, refreshBalance]);

  const retryWithdraw = useCallback(() => {
    setError("");
    void handleWithdraw();
  }, [handleWithdraw]);

  const setMax = useCallback(() => {
    if (shareBalance === null) return;
    setAmount(formatStroopsToDecimal(shareBalance, vaultToken.decimals));
  }, [shareBalance, vaultToken.decimals]);

  if (!walletAddress) {
    return (
      <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 text-center">
        <ArrowUpFromLine className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Withdraw from vault</h3>
        <p className="text-gray-400">Connect your wallet to redeem shares for the underlying asset</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 max-w-md mx-auto">
      {showFailedModal && error && (
        <TransactionFailedModal
          error={decodeTransactionError(error)}
          onClose={() => setShowFailedModal(false)}
          onRetry={() => {
            setShowFailedModal(false);
            retryWithdraw();
          }}
          failurePhase={
            lastProgressPhase !== "idle" &&
            lastProgressPhase !== "success" &&
            lastProgressPhase !== "failure"
              ? lastProgressPhase
              : "polling"
          }
        />
      )}

      <div className="flex items-center gap-2 mb-6">
        <ArrowUpFromLine className="w-5 h-5 text-yellow-400" />
        <h3 className="text-lg font-bold text-white">Withdraw</h3>
      </div>

      {balanceError && (
        <p className="text-xs text-amber-300 mb-3">{balanceError}</p>
      )}

      <div className="bg-white/5 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-gray-400">Shares to redeem</label>
          <button
            type="button"
            onClick={setMax}
            disabled={shareBalance === null}
            className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
          >
            Max: {shareBalance !== null ? formatStroopsToDecimal(shareBalance, vaultToken.decimals) : "…"}
          </button>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-white text-2xl outline-none"
        />
      </div>

      {error && txPhase !== "failure" && (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      )}

      <TxStatusTimeline
        steps={TX_PHASE_PIPELINE}
        phase={txPhase}
        errorMessage={txPhase === "failure" ? error : null}
        txHash={txHash}
        failedAtPhase={
          txPhase === "failure"
            ? lastProgressPhase !== "idle"
              ? lastProgressPhase
              : "polling"
            : null
        }
        onRetry={txPhase === "failure" ? retryWithdraw : undefined}
        className="mb-4"
      />

      <button
        type="button"
        onClick={() => void handleWithdraw()}
        disabled={submitting || !amount}
        className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <ArrowUpFromLine className="w-4 h-4" />
            Withdraw
          </>
        )}
      </button>
    </div>
  );
}
