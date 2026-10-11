// Pure helpers for money formatting, the "cash wallet" and points. No I/O here so they're easy to test.

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const gbpWhole = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function money(value: number | null | undefined, opts: { whole?: boolean } = {}): string {
  const n = Number(value ?? 0);
  return (opts.whole ? gbpWhole : gbp).format(n);
}

/** Signed amount for transaction lists: "-£4.20" / "+£2,850.00". */
export function signedMoney(value: number): string {
  return (value > 0 ? "+" : value < 0 ? "-" : "") + money(Math.abs(value));
}

export const NOTE_DENOMINATIONS = [5, 10, 20, 50, 100] as const;

/** Picks the smallest banknote that draws the allowance in at most `maxNotes` notes. */
export function pickDenomination(allowance: number, maxNotes = 30): number {
  for (const d of NOTE_DENOMINATIONS) {
    if (allowance / d <= maxNotes) return d;
  }
  return NOTE_DENOMINATIONS[NOTE_DENOMINATIONS.length - 1];
}

export interface WalletNote {
  /** 1 = full note still in the wallet, 0 = spent, in between = partly spent */
  fill: number;
}

/**
 * Turns an allowance and amount spent into a row of banknotes, so the remaining money can be
 * drawn like physical cash. Notes are spent from the end of the wallet first.
 */
export function walletNotes(allowance: number, spent: number, denomination = pickDenomination(allowance)): WalletNote[] {
  if (allowance <= 0) return [];
  const count = Math.ceil(allowance / denomination);
  const remaining = Math.max(0, allowance - Math.max(0, spent));
  const notes: WalletNote[] = [];
  for (let i = 0; i < count; i++) {
    const noteValue = Math.min(denomination, allowance - i * denomination);
    const left = Math.min(noteValue, Math.max(0, remaining - i * denomination));
    notes.push({ fill: noteValue > 0 ? left / noteValue : 0 });
  }
  return notes;
}

export type Pace = "ahead" | "on-track" | "over";

/** Compares share of allowance spent with share of the pay period gone. */
export function spendingPace(allowance: number, spent: number, periodStart: string, periodEnd: string, today = new Date()): Pace {
  if (allowance <= 0) return "on-track";
  if (spent > allowance) return "over";
  const start = new Date(periodStart + "T00:00:00").getTime();
  const end = new Date(periodEnd + "T23:59:59").getTime();
  const timeShare = Math.min(1, Math.max(0, (today.getTime() - start) / (end - start)));
  const spendShare = spent / allowance;
  if (spendShare > timeShare + 0.1) return "over";
  if (spendShare < timeShare - 0.1) return "ahead";
  return "on-track";
}

/** Suggests an allowance: typical income minus fixed bills, saving and investing. */
export function suggestAllowance(periods: Array<{ income: number; bills: number; saved: number; invested: number }>): number | null {
  const complete = periods.filter((p) => p.income > 0);
  if (!complete.length) return null;
  const avg = (f: (p: (typeof complete)[number]) => number) => complete.reduce((s, p) => s + f(p), 0) / complete.length;
  const free = avg((p) => p.income) - avg((p) => p.bills) - avg((p) => p.saved) - avg((p) => p.invested);
  return free > 0 ? Math.floor(free / 10) * 10 : null;
}

/** True when a transaction's text contains any of a bill's keywords (case-insensitive, at least 2 letters). */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => k.trim().length >= 2 && t.includes(k.trim().toLowerCase()));
}

/** Splits a comma-separated list typed by the user into clean keywords. */
export function parseKeywords(input: string): string[] {
  return [...new Set(input.split(",").map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2))];
}

/** Same username rule as Personal CEO: 3-30 letters, numbers, dots or underscores. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,30}$/;
export const USERNAME_HINT = "3–30 characters: letters, numbers, dots and underscores.";
