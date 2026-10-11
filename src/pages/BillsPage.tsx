import { useState } from "react";
import { useApp } from "../lib/data";
import { money } from "../lib/money";
import { nextDate } from "../lib/bills";
import type { RecurringPayment } from "../lib/types";
import BillsCalendar from "../components/BillsCalendar";
import CardBills from "../components/CardBills";

type View = "list" | "calendar";
const VIEW_KEY = "bills-view";

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}

export default function BillsPage() {
  const { recurring, status } = useApp();
  const active = recurring.filter((r) => (r.status ?? "active").toLowerCase() === "active");
  const sorted = [...active].sort((a, b) => (nextDate(a)?.getTime() ?? Infinity) - (nextDate(b)?.getTime() ?? Infinity));
  const [view, setView] = useState<View>(savedView);
  const total = (type: RecurringPayment["type"]) => active.filter((r) => r.type === type).reduce((s, r) => s + (r.amount ?? 0), 0);

  function chooseView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice just won't be remembered.
    }
  }

  return (
    <div className="stack-lg">
      <h1>Bills &amp; regular payments</h1>
      <section className="grid-3">
        <div className="stat">
          <span className="stat-label">Direct debits</span>
          <span className="stat-value">{money(total("direct_debit"), { whole: true })}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Standing orders</span>
          <span className="stat-value">{money(total("standing_order"), { whole: true })}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Still due before payday</span>
          <span className="stat-value">{money(status?.bills_due, { whole: true })}</span>
        </div>
      </section>

      <div className="chips" role="tablist" aria-label="View">
        {(["list", "calendar"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "chip active" : "chip"} onClick={() => chooseView(v)}>
            {v === "list" ? "List" : "Calendar"}
          </button>
        ))}
      </div>

      {view === "calendar" ? (
        <BillsCalendar items={sorted} />
      ) : (
        <>
          <RecurringList
            title="Direct debits"
            items={sorted.filter((r) => r.type === "direct_debit")}
            total={total("direct_debit")}
            empty="No direct debits found yet. Some banks don't share these; they'll still show up in Activity when they're paid."
          />
          <RecurringList
            title="Standing orders"
            items={sorted.filter((r) => r.type === "standing_order")}
            total={total("standing_order")}
            empty="No standing orders found yet. Some banks don't share these; they'll still show up in Activity when they're paid."
          />
        </>
      )}

      <CardBills />
    </div>
  );
}

function RecurringList({ title, items, total, empty }: { title: string; items: RecurringPayment[]; total: number; empty: string }) {
  return (
    <section className="card">
      <div className="row-between">
        <h2>{title}</h2>
        {items.length > 0 && <strong>{money(total)}</strong>}
      </div>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="list">
          {items.map((r) => {
            const next = nextDate(r);
            const details = [
              r.frequency,
              next && `next ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${r.next_payment_date ? "" : " (estimated)"}`,
              r.reference && `ref ${r.reference}`,
            ].filter(Boolean);
            return (
              <li key={r.id} className="row-between">
                <span>
                  {r.payee}
                  {details.length > 0 && <span className="muted small block">{details.join(" · ")}</span>}
                </span>
                <span>{r.amount != null ? money(r.amount) : "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
