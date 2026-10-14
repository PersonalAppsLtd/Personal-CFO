import { describe, expect, it } from "vitest";
import { paceCurve } from "./pace";

describe("allowance pace curve", () => {
  const rows = [
    { booked_at: "2026-10-01T09:00:00Z", amount: -20 },
    { booked_at: "2026-10-01T18:00:00Z", amount: -10 },
    { booked_at: "2026-10-03T12:00:00Z", amount: -45.5 },
    { booked_at: "2026-10-03T13:00:00Z", amount: 5.5 }, // refund
    { booked_at: "2026-09-30T12:00:00Z", amount: -99 }, // before the period
  ];

  it("adds up spending day by day and stops at today", () => {
    const curve = paceCurve(rows, 100, "2026-10-01", "2026-10-04", "2026-10-03");
    expect(curve.map((d) => d.spent)).toEqual([30, 30, 70, null]);
  });

  it("spreads the allowance evenly so the pace line ends on it", () => {
    const curve = paceCurve(rows, 100, "2026-10-01", "2026-10-04", "2026-10-03");
    expect(curve.map((d) => d.pace)).toEqual([25, 50, 75, 100]);
  });

  it("buckets late-evening UK spending into the right day", () => {
    // 23:30 UK summer time on 1 Oct is 22:30 UTC
    const curve = paceCurve([{ booked_at: "2026-10-01T22:30:00Z", amount: -12 }], 30, "2026-10-01", "2026-10-03", "2026-10-03");
    expect(curve[0].spent).toBe(12);
  });
});
