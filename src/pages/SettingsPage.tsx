import { useEffect, useState } from "react";
import { useApp } from "../lib/data";
import { devicePushEnabled, enablePush } from "../lib/push";
import { money, suggestAllowance } from "../lib/money";
import { supabase } from "../supabase";
import { Moon, Sun } from "lucide-react";
import PersonalDetails from "../components/PersonalDetails";

const THEME_KEY = "personalcfo.theme";
const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;
type Theme = (typeof THEMES)[number]["value"];

function currentTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage blocked: fall back to the device setting
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  function choose(value: Theme) {
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      // still applies for this visit
    }
    setTheme(value);
  }

  return (
    <section className="card stack">
      <h2>Appearance</h2>
      <div className="theme-options" role="radiogroup" aria-label="Theme">
        {THEMES.map(({ value, label, Icon }) => (
          <button key={value} type="button" role="radio" aria-checked={theme === value} className="theme-option" onClick={() => choose(value)}>
            <Icon size={28} aria-hidden />
            {label} mode
          </button>
        ))}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { profile, scores, updateProfile, session } = useApp();
  const [allowance, setAllowance] = useState(String(profile?.monthly_allowance ?? ""));
  const [payday, setPayday] = useState(profile?.payday ?? 1);
  const [saved, setSaved] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const suggested = suggestAllowance(scores.filter((s) => !s.is_current));

  useEffect(() => {
    devicePushEnabled().then(setPushOn);
  }, []);

  async function save() {
    const err = await updateProfile({ monthly_allowance: allowance ? Number(allowance) : null, payday });
    setSaved(err ?? "Saved.");
  }

  async function turnOnPush() {
    const r = await enablePush(session.user.id);
    setPushMsg(r.message);
    setPushOn(r.ok);
  }

  return (
    <div className="stack-lg">
      <h1>Settings</h1>

      <PersonalDetails />

      <section className="card stack">
        <h2>Your wallet</h2>
        <label>
          Monthly spending allowance (£)
          <input type="number" min={0} step={10} inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        </label>
        {suggested != null && (
          <p className="muted small">
            After bills, saving and investing you typically have about {money(suggested, { whole: true })} free each pay period.
          </p>
        )}
        <label>
          Payday (day of month)
          <input type="number" min={1} max={31} value={payday} onChange={(e) => setPayday(Number(e.target.value))} />
        </label>
        <p className="muted small">Your allowance resets on payday. If payday falls after the end of a short month, we use the last day.</p>
        <div className="row-end">
          {saved && <span className="muted small">{saved}</span>}
          <button className="primary" onClick={save}>Save</button>
        </div>
      </section>

      <section className="card stack">
        <h2>Notifications</h2>
        <label className="check">
          <input type="checkbox" checked={profile?.notify_each_spend ?? true} onChange={(e) => updateProfile({ notify_each_spend: e.target.checked })} />
          Tell me every time I spend, and how much is left
        </label>
        {pushOn ? (
          <p className="muted small">Push notifications are on for this device.</p>
        ) : (
          <button onClick={turnOnPush}>Turn on notifications on this device</button>
        )}
        {pushMsg && <p className="muted small">{pushMsg}</p>}
        <p className="muted small">
          Banks share new transactions through Open Banking a few times a day, and whenever you open the app, so an alert
          can arrive a little after you tap your card.
        </p>
      </section>

      <AppearanceCard />

      <section className="card stack">
        <h2>Account</h2>
        <p className="muted small">Signed in as {session.user.email}</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </div>
  );
}
