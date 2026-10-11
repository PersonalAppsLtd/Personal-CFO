import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, occurrencesBetween } from "../lib/bills";
import { money } from "../lib/money";
import type { RecurringPayment } from "../lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short enough to fit a day cell on a phone: "£92", "£1.1k". */
const short = (n: number) => (n >= 1000 ? `£${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : money(n, { whole: true }));

/** Month grid showing which direct debits and standing orders go out on which day. */
export default function BillsCalendar({ items }: { items: RecurringPayment[] }) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string>(dayKey(today));

  const first = month;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const byDay = new Map<string, RecurringPayment[]>();
  for (const r of items) {
    for (const d of occurrencesBetween(r, first, last)) {
      const key = dayKey(d);
      byDay.set(key, [...(byDay.get(key) ?? []), r]);
    }
  }
  const monthTotal = [...byDay.values()].flat().reduce((s, r) => s + (r.amount ?? 0), 0);

  // Monday-first grid: blanks before the 1st, then each day of the month.
  const lead = (first.getDay() + 6) % 7;
  const cells: Array<Date | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last.getDate() }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];

  const shift = (n: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + n, 1);
    setMonth(next);
    const isThisMonth = next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth();
    setSelected(dayKey(isThisMonth ? today : next));
  };

  const selectedItems = byDay.get(selected) ?? [];
  const selectedDate = new Date(selected + "T00:00:00");
  const todayKey = dayKey(today);

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="cal-nav">
          <button type="button" className="icon-nav" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={18} />
          </button>
          <h2>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2>
          <button type="button" className="icon-nav" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <strong>{money(monthTotal)}</strong>
      </div>

      <div className="cal" role="grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-head" role="columnheader">{w}</span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`blank-${i}`} />;
          const key = dayKey(d);
          const due = byDay.get(key) ?? [];
          const total = due.reduce((s, r) => s + (r.amount ?? 0), 0);
          const cls = ["cal-day", due.length && "has-bills", key === todayKey && "today", key === selected && "selected"].filter(Boolean).join(" ");
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              className={cls}
              aria-selected={key === selected}
              aria-label={`${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}${due.length ? `, ${due.length} payment${due.length > 1 ? "s" : ""}, ${money(total)}` : ""}`}
              onClick={() => setSelected(key)}
            >
              <span className="cal-date">{d.getDate()}</span>
              {due.length > 0 && <span className="cal-amount">{short(total)}</span>}
            </button>
          );
        })}
      </div>

      <div>
        <h3>{selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>
        {selectedItems.length === 0 ? (
          <p className="muted small">Nothing due this day.</p>
        ) : (
          <ul className="list">
            {selectedItems.map((r) => (
              <li key={r.id} className="row-between">
                <span>
                  {r.payee}
                  <span className="muted small block">
                    {[r.type === "direct_debit" ? "Direct debit" : "Standing order", r.reference && `ref ${r.reference}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span>{r.amount != null ? money(r.amount) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">Dates without a confirmed next payment are estimated from the last one.</p>
    </section>
  );
}
