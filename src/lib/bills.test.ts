import { describe, expect, it } from "vitest";
import { dayKey, frequencyStep, nextDate, occurrencesBetween } from "./bills";
import type { RecurringPayment } from "./types";

const bill = (over: Partial<RecurringPayment>): RecurringPayment => ({
  id: "1", type: "direct_debit", payee: "EE", reference: null, amount: 28, frequency: "Monthly",
  status: "active", last_payment_at: null, next_payment_date: null, ...over,
});

describe("bill dates", () => {
  it("reads common frequencies", () => {
    expect(frequencyStep("Monthly")).toEqual({ months: 1 });
    expect(frequencyStep(null)).toEqual({ months: 1 });
    expect(frequencyStep("Weekly")).toEqual({ days: 7 });
    expect(frequencyStep("Fortnightly")).toEqual({ days: 14 });
    expect(frequencyStep("Quarterly")).toEqual({ months: 3 });
    expect(frequencyStep("Annually")).toEqual({ months: 12 });
    expect(frequencyStep("IntrvlWkDay:02:05")).toEqual({ days: 14 });
    expect(frequencyStep("IntrvlMnthDay:03:15")).toEqual({ months: 3 });
  });

  it("estimates the next date from the last payment", () => {
    expect(dayKey(nextDate(bill({ last_payment_at: "2026-10-12T09:00:00" }))!)).toBe("2026-11-12");
  });

  it("projects a monthly bill forwards and backwards into the month shown", () => {
    const r = bill({ next_payment_date: "2026-11-12" });
    expect(occurrencesBetween(r, new Date(2026, 9, 1), new Date(2026, 9, 31)).map(dayKey)).toEqual(["2026-10-12"]);
    expect(occurrencesBetween(r, new Date(2027, 0, 1), new Date(2027, 0, 31)).map(dayKey)).toEqual(["2027-01-12"]);
  });

  it("keeps the day of the month through short months", () => {
    const r = bill({ next_payment_date: "2026-01-31" });
    expect(occurrencesBetween(r, new Date(2026, 1, 1), new Date(2026, 1, 28)).map(dayKey)).toEqual(["2026-02-28"]);
    expect(occurrencesBetween(r, new Date(2026, 2, 1), new Date(2026, 2, 31)).map(dayKey)).toEqual(["2026-03-31"]);
  });

  it("repeats weekly bills through the month", () => {
    const r = bill({ frequency: "Weekly", next_payment_date: "2026-10-05" });
    expect(occurrencesBetween(r, new Date(2026, 9, 1), new Date(2026, 9, 31)).map(dayKey)).toEqual([
      "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26",
    ]);
  });

  it("has nothing to show without any date", () => {
    expect(occurrencesBetween(bill({}), new Date(2026, 9, 1), new Date(2026, 9, 31))).toEqual([]);
  });
});
