import { useState } from "react";
import { useApp } from "../lib/data";
import { supabase } from "../supabase";
import { USERNAME_HINT, USERNAME_PATTERN, money, suggestAllowance } from "../lib/money";

export default function OnboardingPage() {
  const { profile, scores, updateProfile, refresh } = useApp();
  const [payday, setPayday] = useState(profile?.payday ?? 28);
  const suggested = suggestAllowance(scores.filter((s) => !s.is_current));
  const [allowance, setAllowance] = useState<string>(String(profile?.monthly_allowance ?? suggested ?? ""));
  const [username, setUsername] = useState(profile?.username ?? "");
  const needsUsername = !profile?.username;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accounts made before usernames existed (or whose choice was taken) pick one here
  async function saveUsername(): Promise<boolean> {
    if (!needsUsername) return true;
    const handle = username.trim();
    if (!USERNAME_PATTERN.test(handle)) {
      setError(`Choose a username: ${USERNAME_HINT.toLowerCase()}`);
      return false;
    }
    const err = await updateProfile({ username: handle });
    if (err) setError(/profiles_username_unique|duplicate key/.test(err) ? "That username is already taken. Try another." : err);
    return !err;
  }

  async function finish() {
    setBusy(true);
    if (!(await saveUsername())) return setBusy(false);
    const err = await updateProfile({
      payday,
      monthly_allowance: allowance ? Number(allowance) : null,
      onboarded: true,
    });
    setBusy(false);
    setError(err);
  }

  async function tryDemo() {
    setBusy(true);
    if (!(await saveUsername())) return setBusy(false);
    const { error } = await supabase.rpc("load_demo_data");
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await updateProfile({ onboarded: true });
    await refresh();
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-card stack">
        <h1>Let's set up your wallet</h1>
        <p className="lede">
          Your <strong>allowance</strong> is the money you give yourself for day-to-day spending each pay period: food,
          coffee, travel, going out. Bills, saving and investing come out separately.
        </p>
        {needsUsername && (
          <label>
            Choose a username
            <input autoCapitalize="none" spellCheck={false} maxLength={30} placeholder="e.g. liam" value={username} onChange={(e) => setUsername(e.target.value)} />
            <span className="muted small block">{USERNAME_HINT} Friends use it to find you.</span>
          </label>
        )}
        <label>
          What day of the month are you paid?
          <input type="number" min={1} max={31} value={payday} onChange={(e) => setPayday(Number(e.target.value))} />
        </label>
        <label>
          Monthly spending allowance (£)
          <input type="number" min={0} step={10} inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        </label>
        {suggested != null && (
          <p className="muted small">Based on your accounts, about {money(suggested, { whole: true })} is left after bills, saving and investing.</p>
        )}
        <button className="primary" onClick={finish} disabled={busy}>Start tracking</button>
        <div className="divider">or</div>
        <button onClick={tryDemo} disabled={busy}>Explore with demo data first</button>
        {error && <p className="notice">{error}</p>}
      </div>
    </div>
  );
}
