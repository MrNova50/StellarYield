import { useState } from "react";
import { Cpu, Loader2, LogOut, Wallet } from "lucide-react";
import { useWallet } from "../../context/useWallet";
import WalletConnectionModal from "./WalletConnectionModal";
import AddressDisplay from "./AddressDisplay";

export default function ConnectWalletButton() {
  const {
    walletAddress,
    walletAddressType,
    providerLabel,
    isConnected,
    isConnecting,
    disconnectWallet,
  } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (isConnected && walletAddress) {
    return (
      <button
        type="button"
        onClick={disconnectWallet}
        className="glass-card flex items-center gap-2 border-[#214fba]/20 px-4 py-2 transition-colors hover:border-red-500/40 text-slate-800 font-semibold text-sm"
        title="Disconnect wallet"
      >
        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
        <span className="flex items-center gap-1">
          {providerLabel === "Freighter" ? "Freighter" : "Smart Wallet"}{" "}
          <AddressDisplay
            address={walletAddress}
            label="Connected wallet"
            showCopy={false}
            prefixLength={4}
            suffixLength={4}
            className="inline"
          />
        </span>
        {walletAddressType === "contract" ? (
          <Cpu size={14} className="text-[#214fba]" aria-label="Smart wallet" />
        ) : null}
        <LogOut size={14} className="text-red-500" aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={isConnecting}
      >
        {isConnecting ? (
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <Wallet size={18} aria-hidden="true" />
        )}
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      <WalletConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
