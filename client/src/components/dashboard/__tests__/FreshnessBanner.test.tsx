import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FreshnessBanner } from "../FreshnessBanner";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

describe("FreshnessBanner", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T09:20:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders fresh active state when lastUpdated is recent and confidence is high", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    render(<FreshnessBanner lastUpdated={oneMinAgo} confidence={0.95} />);

    expect(screen.getByText("Live Market Sync Active")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText(/Confidence score: 95%/i)).toBeInTheDocument();
  });

  it("renders stale state when lastUpdated is very old or confidence is low", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    render(<FreshnessBanner lastUpdated={oneHourAgo} confidence={0.3} />);

    expect(screen.getByText("Stale DeFi Market Data")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/Confidence score: 30%/i)).toBeInTheDocument();
  });

  it("renders appropriate fallback when lastUpdated is missing but isEstimated/isPartial is set", () => {
    render(<FreshnessBanner isEstimated />);
    expect(screen.getByText("Estimated System Projections")).toBeInTheDocument();
    expect(screen.getByText("Estimated / No Timestamp")).toBeInTheDocument();

    render(<FreshnessBanner isPartial />);
    expect(screen.getByText("Partial / Incomplete Yield Data")).toBeInTheDocument();
  });

  it("handles invalid timestamp gracefully with error banner", () => {
    render(<FreshnessBanner lastUpdated="invalid-date-string" />);
    expect(screen.getByText("Invalid timestamp provided for data freshness check.")).toBeInTheDocument();
  });

  describe("cache mode", () => {
    it("renders cache banner with age and confidence", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(<FreshnessBanner source="cache" lastUpdated={fiveMinAgo} confidence={0.95} />);

      expect(screen.getByText("Showing Cached Data")).toBeInTheDocument();
      expect(screen.getByText(/Cached:/)).toBeInTheDocument();
      expect(screen.getByText("Cached")).toBeInTheDocument();
    });

    it("renders stale cache banner when data age exceeds hard stale threshold", () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      render(<FreshnessBanner source="cache" lastUpdated={oneHourAgo} />);

      expect(screen.getByText("Stale Cached Data")).toBeInTheDocument();
      expect(screen.getByText("Stale Cache")).toBeInTheDocument();
    });

    it("renders refresh button when onRefresh is provided", () => {
      const onRefresh = vi.fn();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(
        <FreshnessBanner source="cache" lastUpdated={fiveMinAgo} confidence={0.95} onRefresh={onRefresh} />,
      );

      const refreshButton = screen.getByRole("button", {
        name: /refresh data from live api/i,
      });
      expect(refreshButton).toBeInTheDocument();
    });

    it("calls onRefresh when refresh button is clicked", () => {
      const onRefresh = vi.fn();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(
        <FreshnessBanner source="cache" lastUpdated={fiveMinAgo} confidence={0.95} onRefresh={onRefresh} />,
      );

      screen.getByRole("button", { name: /refresh data from live api/i }).click();
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("does not render refresh button when onRefresh is omitted", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(<FreshnessBanner source="cache" lastUpdated={fiveMinAgo} confidence={0.95} />);

      expect(
        screen.queryByRole("button", { name: /refresh data from live api/i }),
      ).toBeNull();
    });
  });
});
