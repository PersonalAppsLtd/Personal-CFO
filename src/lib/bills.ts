// Pure helpers for working out when regular payments fall due. No I/O here so they're easy to test.
import type { RecurringPayment } from "./types";

/** How far apart payments are, read from the bank's free-text frequency. Unknown means monthly. */
export function frequencyStep(frequency: string | null): { days?: number; months?: number } {
  const f = (frequency ?? "").toLowerCase();
  // ISO 20022 style codes, e.g. "IntrvlWkDay:02:05" (every 2 weeks) or "IntrvlMnthDay:03:15" (every 3 months)
  const interval = f.match(/^intrvl(wk|mnth)day:(\d+)/);
  if (interval) {
    const n = Math.max(1, Number(interval[2]));
    return interval[1] === "wk" ? { days: 7 * n } : { months: n };
  }
  if (f.includes("fortnight")) return { days: 14 };
  if (f.includes("week") || f === "evrywkday") return { days: 7 };
  if (f.includes("quarter")) return { months: 3 };
  if (f.includes("half") || f.includes("semi")) return { months: 6 };
  if (f.includes("annual") || f.includes("year")) return { months: 12 };
  return { months: 1 };
}

function addStep(d: Date, step: { days?: number; months?: number }, times: number, anchorDay: number): Date {
  if (step.days) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + step.days * times);
  // Keep the original day of the month, clamped to short months (31st -> 30th/28th).
  const month = d.getMonth() + (step.months ?? 1) * times;
  const lastDay = new Date(d.getFullYear(), month + 1, 0).getDate();
  return new Date(d.getFullYear(), month, Math.min(anchorDay, lastDay));
}

/** The next known or estimated payment date (an estimate when the bank only shares the last payment). */
export function nextDate(r: RecurringPayment): Date | null {
  if (r.next_payment_date) return new Date(r.next_payment_date + "T00:00:00");
  if (r.last_payment_at) {
    const last = new Date(r.last_payment_at);
    return addStep(new Date(last.getFullYear(), last.getMonth(), last.getDate()), frequencyStep(r.frequency), 1, last.getDate());
  }
  return null;
}

/** Every date in [from, to] (inclusive, local dates) that the payment is expected to go out. */
export function occurrencesBetween(r: RecurringPayment, from: Date, to: Date): Date[] {
  const anchor = nextDate(r);
  if (!anchor) return [];
  const step = frequencyStep(r.frequency);
  const out: Date[] = [];
  // Project backwards as well as forwards so past months show what went out.
  let i = 0;
  while (addStep(anchor, step, i, anchor.getDate()) > from) i--;
  for (let d = addStep(anchor, step, i, anchor.getDate()); d <= to; d = addStep(anchor, step, ++i, anchor.getDate())) {
    if (d >= from) out.push(d);
  }
  return out;
}

/** "2026-10-11" for a local date, used as a map key. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
