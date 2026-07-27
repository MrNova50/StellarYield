import { useState, useRef, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  LayoutDashboard,
  BarChart3,
  Zap,
  Briefcase,
  Gift,
  Trophy,
  Vote,
  Landmark,
  Calculator,
  Goal,
  LayoutGrid,
  ScrollText,
  TrendingUp,
  Receipt,
  Users,
  Clock,
  Eye,
  HeartHandshake,
  Swords,
  Wallet,
  Building2,
  Bot,
  FlaskConical,
  Menu,
  X,
  Settings,
  Bell,
  ChevronDown,
} from "lucide-react"
import ConnectWalletButton from "../wallet/ConnectWalletButton"
import NotificationBell from "./NotificationBell"
import { useWallet } from "../../context/useWallet"

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ size?: number }>
}

const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/apy", label: "APY Compare", icon: BarChart3 },
  { path: "/strategy", label: "Strategies", icon: Zap },
  { path: "/portfolio", label: "Portfolio", icon: Briefcase },
  { path: "/rewards", label: "Rewards", icon: Gift },
  { path: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { path: "/governance", label: "Governance", icon: Vote },
  { path: "/vault", label: "Vaults", icon: Landmark },
  { path: "/calculator", label: "Calculator", icon: Calculator },
  { path: "/planner", label: "Goal Planner", icon: Goal },
  { path: "/fragmentation", label: "Fragmentation", icon: LayoutGrid },
  { path: "/quests", label: "Quests", icon: ScrollText },
  { path: "/pnl", label: "P&L", icon: TrendingUp },
  { path: "/taxes", label: "Tax Export", icon: Receipt },
  { path: "/referrals", label: "Referrals", icon: Users },
  { path: "/vesting", label: "Vesting", icon: Clock },
  { path: "/transparency", label: "Transparency", icon: Eye },
  { path: "/yield-for-good", label: "Yield for Good", icon: HeartHandshake },
  { path: "/strategy-leaderboard", label: "Strategy LB", icon: Swords },
  { path: "/wallet-session", label: "Wallet Session", icon: Wallet },
  { path: "/treasury", label: "Treasury", icon: Building2 },
  { path: "/ai-advisor", label: "AI Advisor", icon: Bot },
  { path: "/stress", label: "Stress Test", icon: FlaskConical },
]

interface NavBarProps {
  onSettingsOpen: () => void
  onAlertsOpen: () => void
}

export default function NavBar({ onSettingsOpen, onAlertsOpen }: NavBarProps) {
  const { isConnected } = useWallet()
  const location = useLocation()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(7)
  const containerRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/"
    return location.pathname === path || location.pathname.startsWith(path + "/")
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const MORE_BUTTON_WIDTH = 80
    const ITEM_WIDTH = 100

    const measure = () => {
      const available = container.offsetWidth - MORE_BUTTON_WIDTH
      const count = Math.max(1, Math.floor(available / ITEM_WIDTH))
      setVisibleCount(Math.min(count, NAV_ITEMS.length))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isMoreOpen) return
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [isMoreOpen])

  const primaryItems = NAV_ITEMS.slice(0, visibleCount)
  const overflowItems = NAV_ITEMS.slice(visibleCount)
  const showMore = overflowItems.length > 0

  return (
    <>
      <nav className="app-nav glass-panel mx-3 mt-4 px-4 py-3.5 flex justify-between items-center mb-6 sticky top-3 z-50 shadow-2xl">
        <div className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 256 256" fill="none" className="w-8 h-8 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
            <path d="M 0 256 L 0 128 L 128 128 Z M 128 256 L 128 128 L 256 128 Z M 0 128 L 0 0 L 128 0 Z M 128 128 L 128 0 L 256 0 Z" fill="rgb(84, 84, 84)"></path>
          </svg>
          <h1 className="text-base font-bold tracking-wide text-slate-900">
            Stellar Yield
          </h1>
        </div>

        <div className="hidden md:flex flex-1 min-w-0 nav-links" ref={containerRef}>
          <div className="flex gap-4 xl:gap-5 items-center text-[0.82rem] font-semibold px-4 overflow-x-auto scrollbar-hide">
            {primaryItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isActive(item.path)
                      ? "text-slate-900 font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </Link>
              )
            })}
            {showMore && (
              <div className="relative" ref={moreRef}>
                <button
                  type="button"
                  onClick={() => setIsMoreOpen((v) => !v)}
                  className="flex items-center gap-1 whitespace-nowrap text-slate-600 hover:text-slate-900 transition-colors"
                >
                  More{" "}
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${isMoreOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isMoreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsMoreOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-56 glass-panel border border-white/10 shadow-2xl z-50 py-2 animate-in fade-in zoom-in-95 duration-200">
                      {overflowItems.map((item) => {
                        const Icon = item.icon
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsMoreOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2.5 text-[0.82rem] font-semibold transition-colors ${
                              isActive(item.path)
                                ? "text-slate-900 bg-indigo-500/10"
                                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/50"
                            }`}
                          >
                            <Icon size={15} />
                            {item.label}
                          </Link>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <NotificationBell />
          {isConnected && (
            <button
              type="button"
              onClick={onAlertsOpen}
              aria-label="Open APY alerts"
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
            >
              <Bell size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onSettingsOpen}
            aria-label="Open transaction settings"
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <Settings size={16} />
          </button>
          <ConnectWalletButton />
          <button
            type="button"
            onClick={() => setIsDrawerOpen((v) => !v)}
            aria-label={isDrawerOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isDrawerOpen}
            aria-controls="mobile-nav-drawer"
            className="md:hidden p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
          >
            {isDrawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {isDrawerOpen && (
        <div
          id="mobile-nav-drawer"
          role="dialog"
          aria-label="Navigation menu"
          className="md:hidden fixed inset-0 z-40 flex"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsDrawerOpen(false)}
            aria-hidden="true"
          />
          <nav
            className="relative ml-auto w-72 h-full glass-panel rounded-none rounded-l-2xl overflow-y-auto flex flex-col gap-1 px-4 py-6"
            aria-label="Mobile navigation"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-1 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsDrawerOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    isActive(item.path)
                      ? "text-slate-900 bg-indigo-500/10"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </>
  )
}
