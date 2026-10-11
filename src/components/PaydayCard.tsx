import { useState } from "react";
import { PiggyBank, TrendingUp, Wallet, Landmark } from "lucide-react";
import { useApp } from "../lib/data";
import { money } from "../lib/money";
import { supabase } from "../supabase";

type Choice = "save" | "invest" | "rollover" | "keep";

const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Shown once the new pay has arrived and last period's allowance wasn't all spent. */
export default function PaydayCard() {
  const { payday, refresh } = useApp();
  const [amount, setAmount] = useState<string>(payday ? String(payday.leftover) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ choice: Choice; amount: number } | null>(null);

  if (!payday && !done) return null;

  if (done) {
    const points = payday ? Math.round((1000 * done.amount) / payday.income) * (done.choice === "invest" ? 2 : 1) : 0;
    return (
      <section className="card stack payday">
        {done.choice === "save" || done.choice === "invest" ? (
          <>
            <h2>Nice. Now move {money(done.amount)} into your {done.choice === "save" ? "savings" : "investment"} account</h2>
            <p>
              Make the transfer in your banking app. As soon as it shows up here it counts automatically: about{" "}
              <strong>{points} points</strong> and <strong>{points} XP</strong> towards this week's league.
            </p>
          </>
        ) : done.choice === "rollover" ? (
          <h2>Added {money(done.amount)} to this month's allowance</h2>
        ) : (
          <h2>Got it: the money stays in your account</h2>
        )}
        <div className="row-end">
          <button className="primary" onClick={() => { setDone(null); refresh(); }}>Done</button>
        </div>
      </section>
    );
  }

  const p = payday!;
  const value = Math.min(p.leftover, Math.max(0, Number(amount) || 0));
  const savePts = Math.round((1000 * value) / p.income);

  async function choose(choice: Choice) {
    setBusy(true);
    setError(null);
    const chosen = choice === "keep" ? 0 : value;
    const { error } = await supabase.rpc("decide_leftover", { p_choice: choice, p_amount: chosen });
    setBusy(false);
    if (error) return setError(error.message);
    setDone({ choice, amount: chosen });
  }

  const options: Array<{ choice: Choice; label: string; detail: string; Icon: typeof Wallet }> = [
    { choice: "invest", label: "Invest it", detail: `About +${savePts * 2} points and XP`, Icon: TrendingUp },
    { choice: "save", label: "Save it", detail: `About +${savePts} points and XP`, Icon: PiggyBank },
    { choice: "rollover", label: "Add to this month's allowance", detail: "More to spend until next payday", Icon: Wallet },
    { choice: "keep", label: "Leave it in my account", detail: "Decide later yourself", Icon: Landmark },
  ];

  return (
    <section className="card stack payday">
      <div>
        <p className="eyebrow-text">Payday</p>
        <h2>You have {money(p.leftover)} left over</h2>
        <p className="muted small">
          You didn't spend all of your allowance from {fmtDay(p.previous_start)} to {fmtDay(p.previous_end)}. What would you like to do with it?
        </p>
      </div>
      <label>
        Amount (£)
        <input type="number" min={0} max={p.leftover} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="payday-options">
        {options.map(({ choice, label, detail, Icon }) => (
          <button key={choice} className={`payday-option ${choice === "invest" ? "best" : ""}`} onClick={() => choose(choice)} disabled={busy || (choice !== "keep" && value <= 0)}>
            <Icon size={22} aria-hidden />
            <span>
              <strong>{label}</strong>
              <span className="muted small block">{detail}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="notice">{error}</p>}
    </section>
  );
}
