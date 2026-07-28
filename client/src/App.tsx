import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router-dom";
import { lazy, useState } from "react";
import Dashboard from "./components/Dashboard";
import Vault from "./components/Vault";
import { getFeatureFlags } from "./utils/featureFlags";
const ApyDashboard = lazy(() => import("./components/dashboard/ApyDashboard"));
const AIAdvisor = lazy(() => import("./components/AIAdvisor"));
const PortfolioPage = lazy(() => import("./components/portfolio/PortfolioPage"));
const GovernanceDashboard = lazy(
  () => import("./pages/governance/GovernanceDashboard"),
);
const QuestsDashboard = lazy(() => import("./pages/quests/QuestsDashboard"));
const Leaderboard = lazy(() => import("./pages/leaderboard/Leaderboard"));
const ClaimRewards = lazy(() => import("./features/rewards/ClaimRewards"));
const PnLChart = lazy(() => import("./features/pnl/PnLChart"));
const TaxExport = lazy(() => import("./features/taxes/TaxExport"));
const ReferralDashboard = lazy(() => import("./features/referrals/ReferralDashboard"));
const VestingDashboard = lazy(() => import("./pages/vesting/VestingDashboard"));
const TransparencyDashboard = lazy(
  () => import("./pages/transparency/TransparencyDashboard"),
);
const RiskChronology = lazy(() => import("./pages/transparency/RiskChronology"));
const RelayerStatusPage = lazy(() => import("./pages/transparency/RelayerStatusPage"));
const StressTestDashboard = lazy(() => import("./pages/StressTestDashboard"));
const YieldForGood = lazy(() => import("./features/donations/YieldForGood"));
const YieldCalculator = lazy(() => import("./components/calculator/YieldCalculator"));
const StrategyComparison = lazy(() => import("./pages/strategy/StrategyComparison"));
const StrategyLeaderboard = lazy(() => import("./pages/leaderboard/StrategyLeaderboard"));
const TreasurySimulation = lazy(() => import("./pages/treasury/TreasurySimulation"));
const WalletSessionReview = lazy(() => import("./auth/WalletSessionReview"));
// ── Experimental analytics panels (feature-flag gated) ──────────────────────
const PortfolioAttributionPanel = lazy(
  () => import("./features/analytics/PortfolioAttributionPanel"),
);
const StrategyHealthPanel = lazy(
  () => import("./features/analytics/StrategyHealthPanel"),
);
// Resolve flags once at module load time — stable reference for the router
const _featureFlags = getFeatureFlags();

/** Wrapper that injects the connected wallet address into PortfolioAttributionPanel. */
function PortfolioAttributionRoute() {
  const { walletAddress } = useWallet();
  if (!walletAddress) {
    return (
      <div className="text-gray-400 text-center py-12">
        Connect your wallet to view portfolio attribution.
      </div>
    );
  }
  return (
    <RouteBoundary>
      <PortfolioAttributionPanel walletAddress={walletAddress} />
    </RouteBoundary>
  );
}
const FragmentationDashboard = lazy(() =>
  import("./features/fragmentation").then((m) => ({ default: m.FragmentationDashboard })),
);
const ReallocationTimelinePlanner = lazy(() =>
  import("./portfolio/ReallocationTimelinePlanner").then((m) => ({
    default: m.ReallocationTimelinePlanner,
  })),
);
import NavBar from "./components/Navigation/NavBar";
import OnRampModal from "./features/onramp/OnRampModal";
import { useWallet } from "./context/useWallet";
import RouteBoundary from "./components/common/RouteBoundary";
import "./index.css";
import SettingsModal from "./features/settings/SettingsModal";
import AlertsModal from "./features/alerts/AlertsModal";

// Vault IDs available for APY alerts (matches protocol names from yieldService)
const VAULT_OPTIONS = ["Blend", "Soroswap", "DeFindex"];

function GoalPlannerPage() {
  return (
    <ReallocationTimelinePlanner
      planName="Goal Planner"
      status="draft"
      steps={[
        {
          stepId: "goal-planner-draft",
          scheduledAt: new Date().toISOString(),
          expectedFeeUsd: 0,
          expectedRecoveryHours: 0,
          allocations: { Blend: 40, Soroswap: 30, DeFindex: 30 },
        },
      ]}
    />
  );
}

// Layout Component
const RootLayout = () => {
  const { isConnected, walletAddress } = useWallet();
  const [isOnRampOpen, setIsOnRampOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  return (
    <div className="min-h-screen flex flex-col">
      {/* On-Ramp Modal */}
      {isConnected && walletAddress && (
        <OnRampModal
          isOpen={isOnRampOpen}
          onClose={() => setIsOnRampOpen(false)}
          walletAddress={walletAddress}
        />
      )}
      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      {/* APY Alerts Modal */}
      {isConnected && walletAddress && (
        <AlertsModal
          isOpen={isAlertsOpen}
          onClose={() => setIsAlertsOpen(false)}
          walletAddress={walletAddress}
          vaultOptions={VAULT_OPTIONS}
        />
      )}
      {/* Navigation Bar */}
      {!isHomePage && (
        <NavBar
          onSettingsOpen={() => setIsSettingsOpen(true)}
          onAlertsOpen={() => setIsAlertsOpen(true)}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <Outlet />
      </main>
    </div>
  );
};

// Router Configuration
const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        path: "/",
        element: <Dashboard />,
      },
      {
        path: "/apy",
        element: (
          <RouteBoundary routeName="analytics">
            <ApyDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/ai-advisor",
        element: (
          <RouteBoundary>
            <AIAdvisor />
          </RouteBoundary>
        ),
      },
      {
        path: "/stress",
        element: (
          <RouteBoundary>
            <StressTestDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/vault",
        element: <Vault />,
      },
      {
        path: "/vault/:slug",
        element: <Vault />,
      },
      {
        path: "/strategy",
        element: (
          <RouteBoundary>
            <StrategyComparison />
          </RouteBoundary>
        ),
      },
      {
        path: "/portfolio",
        element: (
          <RouteBoundary>
            <PortfolioPage />
          </RouteBoundary>
        ),
      },
      {
        path: "/calculator",
        element: (
          <RouteBoundary>
            <YieldCalculator />
          </RouteBoundary>
        ),
      },
      {
        path: "/planner",
        element: (
          <RouteBoundary>
            <GoalPlannerPage />
          </RouteBoundary>
        ),
      },
      {
        path: "/fragmentation",
        element: (
          <RouteBoundary>
            <FragmentationDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/governance",
        element: (
          <RouteBoundary routeName="governance">
            <GovernanceDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/quests",
        element: (
          <RouteBoundary>
            <QuestsDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/leaderboard",
        element: (
          <RouteBoundary>
            <Leaderboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/rewards",
        element: (
          <RouteBoundary>
            <ClaimRewards />
          </RouteBoundary>
        ),
      },
      {
        path: "/pnl",
        element: (
          <RouteBoundary>
            <PnLChart />
          </RouteBoundary>
        ),
      },
      {
        path: "/taxes",
        element: (
          <RouteBoundary>
            <TaxExport />
          </RouteBoundary>
        ),
      },
      {
        path: "/referrals",
        element: (
          <RouteBoundary>
            <ReferralDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/vesting",
        element: (
          <RouteBoundary>
            <VestingDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/transparency",
        element: (
          <RouteBoundary routeName="transparency">
            <TransparencyDashboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/transparency/incidents",
        element: (
          <RouteBoundary routeName="transparency">
            <RiskChronology />
          </RouteBoundary>
        ),
      },
      {
        path: "/transparency/relayer",
        element: (
          <RouteBoundary routeName="transparency">
            <RelayerStatusPage />
          </RouteBoundary>
        ),
      },
      {
        path: "/yield-for-good",
        element: (
          <RouteBoundary>
            <YieldForGood />
          </RouteBoundary>
        ),
      },
      {
        path: "/strategy-leaderboard",
        element: (
          <RouteBoundary>
            <StrategyLeaderboard />
          </RouteBoundary>
        ),
      },
      {
        path: "/wallet-session",
        element: (
          <RouteBoundary>
            <WalletSessionReview />
          </RouteBoundary>
        ),
      },
      {
        path: "/treasury",
        element: (
          <RouteBoundary routeName="treasury">
            <TreasurySimulation />
          </RouteBoundary>
        ),
      },
      // ── Experimental analytics routes (feature-flag gated) ──────────────
      ...(_featureFlags.experimentalAnalytics || _featureFlags.experimentalPortfolioAttribution
        ? [
            {
              path: "/analytics/attribution",
              element: <PortfolioAttributionRoute />,
            },
          ]
        : []),
      ...(_featureFlags.experimentalAnalytics || _featureFlags.experimentalStrategyHealth
        ? [
            {
              path: "/analytics/strategy-health",
              element: (
                <RouteBoundary>
                  <StrategyHealthPanel />
                </RouteBoundary>
              ),
            },
          ]
        : []),
    ],
  },
]);


function App() {
  return <RouterProvider router={router} />;
}

export default App;
