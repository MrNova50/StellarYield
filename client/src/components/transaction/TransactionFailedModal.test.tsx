import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import TransactionFailedModal, { isRetryable } from "./TransactionFailedModal";
import type { DecodedError } from "../../utils/errorDecoder";

const baseError: DecodedError = {
  title: "Transaction Failed",
  message: "Something went wrong.",
  suggestion: "Try again.",
  raw: "raw-log",
  code: 10,
};

const TX_HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

// ── isRetryable unit tests ────────────────────────────────────────────────────

describe("isRetryable", () => {
  it("returns true for building phase", () => {
    expect(isRetryable("building")).toBe(true);
  });
  it("returns true for simulating phase", () => {
    expect(isRetryable("simulating")).toBe(true);
  });
  it("returns true for waiting_for_wallet phase", () => {
    expect(isRetryable("waiting_for_wallet")).toBe(true);
  });
  it("returns false for submitting phase", () => {
    expect(isRetryable("submitting")).toBe(false);
  });
  it("returns false for polling phase", () => {
    expect(isRetryable("polling")).toBe(false);
  });
  it("returns false for recovering phase", () => {
    expect(isRetryable("recovering")).toBe(false);
  });
  it("returns false for failure phase", () => {
    expect(isRetryable("failure")).toBe(false);
  });
  it("returns true for undefined (unknown) phase", () => {
    expect(isRetryable(undefined)).toBe(true);
  });
});

// ── TransactionFailedModal component tests ────────────────────────────────────

describe("TransactionFailedModal", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic rendering ────────────────────────────────────────────────────────

  it("renders the error title", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /transaction failed/i })).toBeInTheDocument();
  });

  it("renders the error message", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("renders the error code when present", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.getByText(/Error code 10/i)).toBeInTheDocument();
  });

  it("renders the suggested fix", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.getByText(/Try again/i)).toBeInTheDocument();
  });

  it("calls onClose when dismiss button is clicked", () => {
    const onClose = vi.fn();
    render(<TransactionFailedModal error={baseError} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<TransactionFailedModal error={baseError} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Retry button ─────────────────────────────────────────────────────────

  it("shows retry button for retryable phases when onRetry is provided (building)", () => {
    const onRetry = vi.fn();
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={onRetry}
        failurePhase="building"
      />,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows retry button for simulating phase", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={vi.fn()}
        failurePhase="simulating"
      />,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows retry button for waiting_for_wallet phase", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={vi.fn()}
        failurePhase="waiting_for_wallet"
      />,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("hides retry button for submitting phase (non-retryable)", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={vi.fn()}
        failurePhase="submitting"
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("hides retry button for polling phase (non-retryable)", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={vi.fn()}
        failurePhase="polling"
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("hides retry button when onRetry is not provided even for retryable phase", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="simulating"
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onRetry={onRetry}
        failurePhase="building"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ── Copy diagnostics ──────────────────────────────────────────────────────

  it("shows 'Copy diagnostics' button", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /copy diagnostics/i })).toBeInTheDocument();
  });

  it("copies diagnostics to clipboard and shows 'Copied' feedback", async () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="simulating"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
    });
  });

  it("includes phase, title and message in the copied diagnostics", async () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="simulating"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    await waitFor(() => {
      const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
      expect(written).toContain("simulating");
      expect(written).toContain("Transaction Failed");
      expect(written).toContain("Something went wrong.");
    });
  });

  it("includes txHash in the copied diagnostics when provided", async () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        txHash={TX_HASH}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    await waitFor(() => {
      const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
      expect(written).toContain(TX_HASH);
    });
  });

  it("truncates long raw log in diagnostics", async () => {
    const longRaw = "x".repeat(600);
    const errorWithLongRaw: DecodedError = { ...baseError, raw: longRaw };
    render(<TransactionFailedModal error={errorWithLongRaw} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    await waitFor(() => {
      const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
      expect(written).toContain("[truncated]");
    });
  });

  // ── Explorer links ────────────────────────────────────────────────────────

  it("shows no explorer link when txHash is not provided", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: /stellar expert/i })).not.toBeInTheDocument();
  });

  it("shows explorer link when txHash is provided", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        txHash={TX_HASH}
      />,
    );
    const link = screen.getByRole("link", { name: /stellar expert/i });
    expect(link).toBeInTheDocument();
  });

  it("explorer link points to testnet by default", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        txHash={TX_HASH}
      />,
    );
    const link = screen.getByRole("link", { name: /stellar expert/i });
    expect(link.getAttribute("href")).toContain("testnet");
    expect(link.getAttribute("href")).toContain(TX_HASH);
  });

  it("explorer link points to mainnet when network=mainnet", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        txHash={TX_HASH}
        network="mainnet"
      />,
    );
    const link = screen.getByRole("link", { name: /stellar expert/i });
    expect(link.getAttribute("href")).toContain("public");
    expect(link.getAttribute("href")).toContain(TX_HASH);
  });

  it("explorer link opens in a new tab", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        txHash={TX_HASH}
      />,
    );
    const link = screen.getByRole("link", { name: /stellar expert/i });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  // ── Recovery steps per phase ──────────────────────────────────────────────

  it("shows wallet recovery step for waiting_for_wallet failures", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="waiting_for_wallet"
        walletConnected={false}
        networkHealthy
      />,
    );
    expect(
      screen.getByText(/Reconnect your wallet, then retry the transaction/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open wallet extension and approve the pending request/i),
    ).toBeInTheDocument();
  });

  it("shows network recovery step for submitting failures", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="submitting"
        walletConnected
        networkHealthy={false}
      />,
    );
    expect(
      screen.getByText(/Switch RPC endpoint or wait for network stability/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Retry submission with a fresh signature/i),
    ).toBeInTheDocument();
  });

  it("shows simulation recovery step for simulating failures", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="simulating"
      />,
    );
    expect(
      screen.getByText(/Lower amount or increase slippage and simulate again/i),
    ).toBeInTheDocument();
  });

  it("shows polling recovery step for polling failures", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="polling"
      />,
    );
    expect(
      screen.getByText(/Wait for finality.*check explorer/i),
    ).toBeInTheDocument();
  });

  it("shows building recovery step for building failures", () => {
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        failurePhase="building"
      />,
    );
    expect(
      screen.getByText(/Refresh vault.*rebuild the transaction/i),
    ).toBeInTheDocument();
  });

  // ── View details callback ─────────────────────────────────────────────────

  it("renders view details button when onViewDetails is provided", () => {
    const onViewDetails = vi.fn();
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onViewDetails={onViewDetails}
      />,
    );
    expect(screen.getByRole("button", { name: /view details/i })).toBeInTheDocument();
  });

  it("calls onViewDetails when clicked", () => {
    const onViewDetails = vi.fn();
    render(
      <TransactionFailedModal
        error={baseError}
        onClose={() => {}}
        onViewDetails={onViewDetails}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view details/i }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  // ── Developer log ─────────────────────────────────────────────────────────

  it("toggles the raw developer log on click", () => {
    render(<TransactionFailedModal error={baseError} onClose={() => {}} />);
    const toggleBtn = screen.getByRole("button", { name: /developer log/i });
    expect(screen.queryByText("raw-log")).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByText("raw-log")).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.queryByText("raw-log")).not.toBeInTheDocument();
  });
});
