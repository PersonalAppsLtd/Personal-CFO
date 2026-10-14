// Pure helpers for the "how fast is the allowance going" chart. No I/O here so they're easy to test.

export interface PaceDay {
  /** "2026-10-01" */
  date: string;
  /** Allowance spending so far, up to and including this day. Null for days still to come. */
  spent: number | null;
  /** Where spending would be if the allowance were spread evenly over the pay period. */
  pace: number;
}

interface SpendRow {
  booked_at: string;
  amount: number;
}

/** UK calendar day of a timestamp, matching how the database buckets transactions. */
export function londonDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Day-by-day cumulative spending across a pay period, next to an even pace line that reaches the
 * allowance on the last day. `rows` should already be filtered to allowance spending.
 */
export function paceCurve(rows: SpendRow[], allowance: number, periodStart: string, periodEnd: string, today: string): PaceDay[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = londonDay(r.booked_at);
    if (day < periodStart || day > periodEnd) continue;
    byDay.set(day, (byDay.get(day) ?? 0) - r.amount); // spending is negative; refunds bring it back down
  }

  const days: string[] = [];
  for (let d = periodStart; d <= periodEnd; d = addDays(d, 1)) days.push(d);

  let running = 0;
  return days.map((date, i) => {
    running += byDay.get(date) ?? 0;
    return {
      date,
      spent: date <= today ? Math.round(running * 100) / 100 : null,
      pace: Math.round(((allowance * (i + 1)) / days.length) * 100) / 100,
    };
  });
}
