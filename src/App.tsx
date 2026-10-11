import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { CalendarDays, House, ChartColumn, Handshake, Landmark, Network, Receipt, Settings, Trophy, Wallet } from "lucide-react";
import { supabase } from "./supabase";
import { AppDataProvider, useApp } from "./lib/data";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import WalletPage from "./pages/WalletPage";
import ActivityPage from "./pages/ActivityPage";
import BillsPage from "./pages/BillsPage";
import CashFlowPage from "./pages/CashFlowPage";
import PointsPage from "./pages/PointsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import FriendsPage from "./pages/FriendsPage";
import AccountsPage from "./pages/AccountsPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingPage from "./pages/OnboardingPage";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="splash">Loading…</div>;
  if (!session) return <AuthPage />;
  return (
    <AppDataProvider session={session}>
      <Shell />
    </AppDataProvider>
  );
}

const NAV = [
  { to: "/", label: "Home", Icon: House },
  { to: "/wallet", label: "Wallet", Icon: Wallet },
  { to: "/activity", label: "Activity", Icon: Receipt },
  { to: "/bills", label: "Bills", Icon: CalendarDays },
  { to: "/cash-flow", label: "Cash flow", Icon: ChartColumn },
  { to: "/points", label: "Points", Icon: Trophy },
  { to: "/leaderboard", label: "Leaderboard", Icon: Network },
  { to: "/friends", label: "Friends", Icon: Handshake },
  { to: "/accounts", label: "Accounts", Icon: Landmark },
  { to: "/settings", label: "Settings", Icon: Settings },
];

function Shell() {
  const { profile, loading, toast, dismissToast } = useApp();
  const { pathname } = useLocation();

  // On narrow screens the tabs scroll sideways; keep the current one visible
  useEffect(() => {
    document.querySelector(".topnav a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname, loading]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, 6000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  if (loading) return <div className="splash">Loading your money…</div>;
  if (profile && !profile.onboarded) return <OnboardingPage />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">Personal CFO</NavLink>
          <nav className="topnav" aria-label="Main">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} title={label}>
                {({ isActive }) => (
                  <>
                    <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                    <span className="nav-label">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {toast && (
        <button className="toast" onClick={dismissToast}>
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/cash-flow" element={<CashFlowPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

    </div>
  );
}
