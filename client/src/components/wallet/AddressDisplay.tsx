/**
 * AddressDisplay.tsx
 *
 * Shared wallet-address display component for StellarYield.
 *
 * Features:
 *  - Configurable truncation (prefix/suffix length)
 *  - Copy-to-clipboard with success / error feedback
 *  - Accessible labels for screen readers
 *  - Optional network/account mismatch hint when registry data differs
 */
import { useState } from "react";
import { Copy, Check, AlertTriangle } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AddressDisplayProps {
  /** Full Stellar public key (56-char G-address). */
  address: string;
  /**
   * Number of characters to show from the start of the address.
   * @default 6
   */
  prefixLength?: number;
  /**
   * Number of characters to show from the end of the address.
   * @default 4
   */
  suffixLength?: number;
  /** Whether to show a copy button. @default true */
  showCopy?: boolean;
  /**
   * When provided, indicates the expected address for this slot (e.g. from
   * contract registry). If it differs from `address`, a mismatch warning is
   * shown.
   */
  expectedAddress?: string;
  /**
   * Human-readable label for the address slot, used as the accessible name for
   * screen readers and the copy button's aria-label.
   * @example "Connected wallet" | "Keeper address"
   */
  label?: string;
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Render as monospace font. @default true */
  mono?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Truncate a Stellar address to `prefix + "…" + suffix` characters.
 * Returns the full address unchanged if it is shorter than the requested cut.
 */
export function truncateAddress(
  address: string,
  prefixLength = 6,
  suffixLength = 4,
): string {
  if (!address) return "";
  const totalVisible = prefixLength + suffixLength;
  if (address.length <= totalVisible + 1) return address;
  return `${address.slice(0, prefixLength)}…${address.slice(-suffixLength)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

type CopyState = "idle" | "success" | "error";

export default function AddressDisplay({
  address,
  prefixLength = 6,
  suffixLength = 4,
  showCopy = true,
  expectedAddress,
  label,
  className = "",
  mono = true,
}: AddressDisplayProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const hasMismatch =
    expectedAddress !== undefined &&
    expectedAddress !== "" &&
    expectedAddress !== address;

  const truncated = truncateAddress(address, prefixLength, suffixLength);
  const labelText = label ?? "address";
  const copyAriaLabel =
    copyState === "success"
      ? "Copied!"
      : copyState === "error"
        ? "Copy failed"
        : `Copy ${labelText}`;

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        // Fallback for browsers that do not expose the Clipboard API
        const ta = document.createElement("textarea");
        ta.value = address;
        ta.setAttribute("aria-hidden", "true");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyState("success");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  }

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      {/* Address row */}
      <span className="inline-flex items-center gap-1.5">
        {/* Accessible hidden full address for screen readers */}
        <span className="sr-only">{labelText}: {address}</span>

        {/* Visible truncated address */}
        <span
          aria-hidden="true"
          title={address}
          className={`${mono ? "font-mono" : ""} text-sm text-gray-200 tracking-tight`}
        >
          {truncated}
        </span>

        {showCopy && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copyAriaLabel}
            title={copyAriaLabel}
            className={`flex-shrink-0 rounded p-0.5 transition-colors ${
              copyState === "success"
                ? "text-green-400 hover:text-green-300"
                : copyState === "error"
                  ? "text-red-400 hover:text-red-300"
                  : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {copyState === "success" ? (
              <Check size={12} aria-hidden="true" />
            ) : (
              <Copy size={12} aria-hidden="true" />
            )}
          </button>
        )}
      </span>

      {/* Mismatch hint */}
      {hasMismatch && (
        <span
          role="alert"
          aria-label={`Address mismatch: expected ${expectedAddress ?? ""}, got ${address}`}
          className="inline-flex items-center gap-1 text-xs text-amber-400"
        >
          <AlertTriangle size={11} aria-hidden="true" />
          Address mismatch — verify before signing
        </span>
      )}
    </span>
  );
}
