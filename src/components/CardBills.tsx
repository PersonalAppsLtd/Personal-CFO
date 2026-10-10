import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "../lib/data";
import { matchesKeywords, money, parseKeywords } from "../lib/money";
import { supabase } from "../supabase";

const PRESETS = [
  { name: "Fuel", keywords: "shell, bp, esso, texaco, petrol, fuel, pfs" },
  { name: "Groceries", keywords: "tesco, sainsbury, asda, aldi, lidl, morrisons, waitrose, co-op, ocado" },
  { name: "Parking", keywords: "parking, ringgo, paybyphone, justpark, ncp" },
  { name: "Public transport", keywords: "tfl, trainline, national rail, stagecoach, first bus" },
  { name: "Childcare", keywords: "nursery, childcare, childminder" },
];

/** Regular costs paid by card (fuel, groceries...) that are budgeted separately from the spending allowance. */
export default function CardBills() {
  const { billBudgets, transactions, status, session, refresh } = useApp();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inPeriod = transactions.filter((t) => {
    if (t.kind !== "bill" || !status) return false;
    const day = new Date(t.booked_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    return day >= status.period_start && day <= status.period_end;
  });
  const text = (t: (typeof inPeriod)[number]) => `${t.description} ${t.merchant ?? ""}`;
  const spentOn = (words: string[]) => inPeriod.filter((t) => matchesKeywords(text(t), words)).reduce((s, t) => s - t.amount, 0);
  const other = inPeriod.filter((t) => !billBudgets.some((b) => matchesKeywords(text(t), b.keywords))).reduce((s, t) => s - t.amount, 0);

  async function add(e: FormEvent) {
    e.preventDefault();
    const words = parseKeywords(keywords);
    if (!name.trim() || !amount || !words.length) {
      setError("Add a name, a monthly amount and at least one word to look for.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("bill_budgets")
      .insert({ user_id: session.user.id, name: name.trim(), monthly_amount: Number(amount), keywords: words });
    if (!error) await supabase.rpc("reclassify_my_transactions");
    setBusy(false);
    if (error) return setError(error.message);
    setName("");
    setAmount("");
    setKeywords("");
    refresh();
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove the ${label} budget? Matching payments will go back to being sorted automatically.`)) return;
    await supabase.from("bill_budgets").delete().eq("id", id);
    await supabase.rpc("reclassify_my_transactions");
    refresh();
  }

  return (
    <section className="card stack">
      <div>
        <h2>Paid by card</h2>
        <p className="muted small">
          Regular costs like fuel or the weekly shop. Payments that match are treated as bills, so they don't come out of
          your spending allowance, and anything left in the budget counts towards bills still to come.
        </p>
      </div>

      {billBudgets.length > 0 && (
        <ul className="list">
          {billBudgets.map((b) => {
            const spent = spentOn(b.keywords);
            const share = b.monthly_amount > 0 ? Math.min(1, spent / b.monthly_amount) : 0;
            return (
              <li key={b.id} className="stack-sm">
                <div className="row-between">
                  <strong>{b.name}</strong>
                  <span>
                    {money(spent)} of {money(b.monthly_amount, { whole: true })}
                    <button className="icon-button" onClick={() => remove(b.id, b.name)} aria-label={`Remove ${b.name}`} title="Remove">
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </span>
                </div>
                <div className={`bar ${spent > b.monthly_amount ? "bar-over" : ""}`} aria-hidden>
                  <div style={{ width: `${share * 100}%` }} />
                </div>
                <span className="muted small">Matches: {b.keywords.join(", ")}</span>
              </li>
            );
          })}
        </ul>
      )}
      {other > 0 && (
        <p className="muted small">
          Other card bills this period (such as fuel found automatically): <strong>{money(other)}</strong>
        </p>
      )}

      <form onSubmit={add} className="stack">
        <h3>Add a card bill</h3>
        <div className="chips">
          {PRESETS.filter((p) => !billBudgets.some((b) => b.name.toLowerCase() === p.name.toLowerCase())).map((p) => (
            <button key={p.name} type="button" className="chip" onClick={() => { setName(p.name); setKeywords(p.keywords); }}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <label>
            Name
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fuel" />
          </label>
          <label>
            Monthly budget (£)
            <input type="number" min={0} step={5} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" />
          </label>
        </div>
        <label>
          Words to look for in the payment, separated by commas
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="shell, bp, esso" />
        </label>
        {error && <p className="notice">{error}</p>}
        <div className="row-end">
          <button className="primary" disabled={busy}>{busy ? "Adding…" : "Add bill"}</button>
        </div>
      </form>
    </section>
  );
}
