import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddressDisplay, { truncateAddress } from "./AddressDisplay";

// ── truncateAddress unit tests ────────────────────────────────────────────────

describe("truncateAddress", () => {
  const FULL = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  it("truncates with default prefix=6 and suffix=4", () => {
    expect(truncateAddress(FULL)).toBe("GAAAAA…AWHF");
  });

  it("truncates with custom prefix and suffix", () => {
    expect(truncateAddress(FULL, 4, 4)).toBe("GAAA…AWHF");
  });

  it("returns full address when shorter than cut point", () => {
    const short = "GSHORT";
    expect(truncateAddress(short)).toBe("GSHORT");
  });

  it("returns empty string for empty input", () => {
    expect(truncateAddress("")).toBe("");
  });

  it("uses an ellipsis character (…)", () => {
    expect(truncateAddress(FULL)).toContain("…");
  });
});

// ── AddressDisplay component tests ───────────────────────────────────────────

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("AddressDisplay", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the truncated address visibly", () => {
    render(<AddressDisplay address={ADDR} />);
    // Truncated text should be visible (aria-hidden but in DOM)
    expect(document.body.textContent).toContain("GAAAAA");
  });

  it("renders the full address in an sr-only span for screen readers", () => {
    render(<AddressDisplay address={ADDR} label="Connected wallet" />);
    const srSpan = document.querySelector(".sr-only");
    expect(srSpan?.textContent).toContain(ADDR);
    expect(srSpan?.textContent).toContain("Connected wallet");
  });

  it("shows a copy button by default", () => {
    render(<AddressDisplay address={ADDR} label="wallet" />);
    expect(screen.getByRole("button", { name: /copy wallet/i })).toBeInTheDocument();
  });

  it("hides the copy button when showCopy=false", () => {
    render(<AddressDisplay address={ADDR} showCopy={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the full address on click and shows success state", async () => {
    render(<AddressDisplay address={ADDR} label="wallet" />);
    const btn = screen.getByRole("button", { name: /copy wallet/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDR);
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();
    });
  });

  it("shows error state when clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("not allowed")),
      },
      configurable: true,
    });
    render(<AddressDisplay address={ADDR} label="wallet" />);
    fireEvent.click(screen.getByRole("button", { name: /copy wallet/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy failed/i })).toBeInTheDocument();
    });
  });

  it("shows no mismatch hint when expectedAddress matches", () => {
    render(<AddressDisplay address={ADDR} expectedAddress={ADDR} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows mismatch hint when expectedAddress differs", () => {
    render(<AddressDisplay address={ADDR} expectedAddress={OTHER} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/mismatch/i);
  });

  it("includes both addresses in the mismatch alert accessible label", () => {
    render(<AddressDisplay address={ADDR} expectedAddress={OTHER} label="keeper" />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-label")).toContain(ADDR);
    expect(alert.getAttribute("aria-label")).toContain(OTHER);
  });

  it("shows no mismatch hint when expectedAddress is not provided", () => {
    render(<AddressDisplay address={ADDR} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders with mono font class by default", () => {
    render(<AddressDisplay address={ADDR} />);
    const monos = document.querySelectorAll(".font-mono");
    expect(monos.length).toBeGreaterThan(0);
  });

  it("renders without mono font class when mono=false", () => {
    render(<AddressDisplay address={ADDR} mono={false} />);
    const truncatedSpan = document.querySelector('[aria-hidden="true"]');
    expect(truncatedSpan?.className).not.toContain("font-mono");
  });

  it("uses 'address' as fallback label when none provided", () => {
    render(<AddressDisplay address={ADDR} />);
    const srSpan = document.querySelector(".sr-only");
    expect(srSpan?.textContent).toContain("address");
  });

  it("respects custom prefixLength and suffixLength", () => {
    render(<AddressDisplay address={ADDR} prefixLength={4} suffixLength={4} />);
    const truncatedSpan = document.querySelector('[aria-hidden="true"]');
    expect(truncatedSpan?.textContent).toBe("GAAA…AWHF");
  });

  it("sets title attribute to full address on the truncated span", () => {
    render(<AddressDisplay address={ADDR} />);
    const truncatedSpan = document.querySelector('[aria-hidden="true"][title]');
    expect(truncatedSpan?.getAttribute("title")).toBe(ADDR);
  });
});
