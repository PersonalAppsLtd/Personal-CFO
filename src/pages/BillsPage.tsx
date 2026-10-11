import { useApp } from "../lib/data";
import { money } from "../lib/money";
import type { RecurringPayment } from "../lib/types";
import CardBills from "../components/CardBills";

function nextDate(r: RecurringPayment): Date | null {
  if (r.next_payment_date) return new Date(r.next_payment_date + "T00:00:00");
  if (r.last_payment_at) {
    const d = new Date(r.last_payment_at);
    d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

export default function BillsPage() {
  const { recurring, status } = useApp();
  const active = recurring.filter((r) => (r.status ?? "active").toLowerCase() === "active");
  const sorted = [...active].sort((a, b) => (nextDate(a)?.getTime() ?? Infinity) - (nextDate(b)?.getTime() ?? Infinity));
  const total = (type: RecurringPayment["type"]) => active.filter((r) => r.type === type).reduce((s, r) => s + (r.amount ?? 0), 0);

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
