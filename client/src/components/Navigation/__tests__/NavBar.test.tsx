import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import "@testing-library/jest-dom"
import NavBar from "../NavBar"

const mockWallet = { isConnected: false, walletAddress: null }
vi.mock("../../../context/useWallet", () => ({ useWallet: () => mockWallet }))
vi.mock("../../../hooks/useBackendStatus", () => ({ useBackendStatus: () => "available" }))
vi.mock("../../../lib/api", () => ({ apiUrl: (path: string) => `http://localhost:3001${path}` }))
vi.mock("../../wallet/ConnectWalletButton", () => ({
  default: () => <button type="button">Connect Wallet</button>,
}))

function renderNavBar(pathname = "/") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <NavBar onSettingsOpen={vi.fn()} onAlertsOpen={vi.fn()} />
    </MemoryRouter>,
  )
}

describe("NavBar", () => {
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    mockWallet.isConnected = false
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }))
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it("renders brand logo and name", () => {
    renderNavBar()
    expect(screen.getByText("Stellar Yield")).toBeInTheDocument()
  })

  it("renders Dashboard as the primary visible nav link", () => {
    renderNavBar()
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("More")).toBeInTheDocument()
  })

  it("Dashboard link points to root route", () => {
    renderNavBar()
    const dashboard = screen.getByText("Dashboard").closest("a")
    expect(dashboard).toHaveAttribute("href", "/")
  })

  it("highlights active Dashboard on root route", () => {
    renderNavBar("/")
    const dashLink = screen.getByText("Dashboard").closest("a")
    expect(dashLink?.className).toContain("text-slate-900")
  })

  it("does not highlight Dashboard on other routes", () => {
    renderNavBar("/apy")
    const dashLink = screen.getByText("Dashboard").closest("a")
    expect(dashLink?.className).toContain("text-slate-600")
  })

  it("renders More dropdown with overflow items", () => {
    renderNavBar()
    fireEvent.click(screen.getByText("More"))
    expect(screen.getByText("APY Compare")).toBeInTheDocument()
    expect(screen.getByText("Governance")).toBeInTheDocument()
    expect(screen.getByText("Vaults")).toBeInTheDocument()
  })

  it("highlights active item inside More dropdown", () => {
    renderNavBar("/governance")
    fireEvent.click(screen.getByText("More"))
    const governance = screen.getByText("Governance").closest("a")
    expect(governance?.className).toContain("text-slate-900")
  })

  it("opens mobile drawer and shows all nav items", () => {
    renderNavBar()
    fireEvent.click(screen.getByLabelText("Open navigation menu"))
    expect(screen.getByLabelText("Navigation menu")).toBeInTheDocument()
    const dashboards = screen.getAllByText("Dashboard")
    expect(dashboards.length).toBe(2)
    expect(screen.getByText("Stress Test")).toBeInTheDocument()
  })

  it("closes mobile drawer when backdrop is clicked", () => {
    renderNavBar()
    fireEvent.click(screen.getByLabelText("Open navigation menu"))
    expect(screen.getByLabelText("Navigation menu")).toBeInTheDocument()
    const drawer = screen.getByLabelText("Navigation menu")
    const backdrop = drawer.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(screen.queryByLabelText("Navigation menu")).not.toBeInTheDocument()
    }
  })

  it("closes mobile drawer when a nav link is clicked", () => {
    renderNavBar()
    fireEvent.click(screen.getByLabelText("Open navigation menu"))
    expect(screen.getByLabelText("Navigation menu")).toBeInTheDocument()
    const drawerLinks = screen.getAllByText("Strategies")
    expect(drawerLinks.length).toBe(1)
    fireEvent.click(drawerLinks[0])
    expect(screen.queryByLabelText("Navigation menu")).not.toBeInTheDocument()
  })

  it("More dropdown closes on backdrop click", () => {
    renderNavBar()
    fireEvent.click(screen.getByText("More"))
    expect(screen.getByText("APY Compare")).toBeInTheDocument()
    const backdrops = document.querySelectorAll(".fixed.inset-0.z-40")
    const dropdownBackdrop = Array.from(backdrops).find(
      (el) => el.getAttribute("aria-hidden") !== "true",
    )
    expect(dropdownBackdrop).not.toBeUndefined()
  })
})
