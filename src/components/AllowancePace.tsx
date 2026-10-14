import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/data";
import { money } from "../lib/money";
import { londonDay, paceCurve } from "../lib/pace";

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(day + "T12:00:00").toLocaleDateString("en-GB", opts);

/** Line chart of allowance spending through the current pay period against an even pace. */
export default function AllowancePace() {
  const { status, transactions, accounts } = useApp();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  if (!status) return null;

  if (status.allowance <= 0) {
    return (
      <section className="card">
        <h2>How fast your allowance is going</h2>
        <p className="muted small">
          <Link to="/settings">Set a monthly allowance</Link> to see how quickly you're spending it.
        </p>
      </section>
    );
  }

  // Same rows the wallet counts: spending on accounts included in the allowance
  const included = new Set(accounts.filter((a) => a.include_in_spending).map((a) => a.id));
  const rows = transactions.filter((t) => t.kind === "spending" && included.has(t.account_id));
  const today = londonDay(new Date().toISOString());
  const days = paceCurve(rows, status.allowance, status.period_start, status.period_end, today);
  const todayIndex = days.reduce((last, d, i) => (d.spent != null ? i : last), -1);
  const now = todayIndex >= 0 ? days[todayIndex] : null;
  const gap = now ? now.spent! - now.pace : 0;

  const W = 380, H = 200, padL = 44, padR = 8, padB = 24, padT = 12;
  const top = Math.max(status.allowance, ...days.map((d) => d.spent ?? 0));
  // Round gridlines (£100, £200, £250, £500...) with at most 5 steps above zero
  const step = [50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => (top * 1.05) / s <= 5) ?? 10000;
  const nice = Math.ceil((top * 1.05) / step) * step;
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, days.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const ticks = Array.from({ length: nice / step + 1 }, (_, i) => i * step);
  const slot = (W - padL - padR) / Math.max(1, days.length - 1);
  const pathOf = (pts: Array<[number, number]>) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const spentPath = pathOf(days.slice(0, todayIndex + 1).map((d, i) => [x(i), y(d.spent!)]));
  const pacePath = pathOf(days.map((d, i) => [x(i), y(d.pace)]));
  const xTicks = [0, Math.round((days.length - 1) / 2), days.length - 1];
  const h = hover != null ? days[hover] : null;

  return (
    <section className="card viz">
      <div className="row-between">
        <h2>How fast your allowance is going</h2>
        <button className="link" onClick={() => setShowTable(!showTable)}>{showTable ? "Show chart" : "Show table"}</button>
      </div>
      {now && (
        <p className="muted small">
          {money(now.spent!, { whole: true })} spent of {money(status.allowance, { whole: true })} by day {todayIndex + 1} of {days.length}
          {" · "}
          <span className={gap > 0 ? "neg" : undefined}>
            {Math.abs(gap) < 1 ? "right on pace" : `${money(Math.abs(gap), { whole: true })} ${gap > 0 ? "over" : "under"} an even pace`}
          </span>
        </p>
      )}
      <ul className="legend">
        <li><span className="swatch line" style={{ background: "var(--series-2)" }} />Spent so far</li>
        <li><span className="swatch line dashed" />Even pace</li>
      </ul>

      {showTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th><th>Spent so far</th><th>Even pace</th></tr>
            </thead>
            <tbody>
              {days.slice(0, todayIndex + 1).map((d) => (
                <tr key={d.date}>
                  <td>{dayLabel(d.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td>{money(d.spent)}</td>
                  <td>{money(d.pace)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Allowance spent through the pay period against an even pace up to ${money(status.allowance, { whole: true })}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
                <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">£{t >= 1000 ? `${t / 1000}k` : t}</text>
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={y(status.allowance)} y2={y(status.allowance)} className="allowance-line" />
            <text x={W - padR} y={y(status.allowance) - 5} className="axis" textAnchor="end">Allowance {money(status.allowance, { whole: true })}</text>
            {xTicks.map((i) => (
              <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
                {dayLabel(days[i].date)}
              </text>
            ))}
            <path d={pacePath} className="pace-line" />
            {todayIndex >= 0 && <path d={spentPath} className="spent-line" />}
            {now && <circle cx={x(todayIndex)} cy={y(now.spent!)} r={4} className="spent-dot" />}
            {h && <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H - padB} className="crosshair" />}
            {h?.spent != null && <circle cx={x(hover!)} cy={y(h.spent)} r={4} className="spent-dot" />}
            {days.map((d, i) => (
              <rect key={d.date} x={x(i) - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            ))}
          </svg>
          {h && (
            <div className="tooltip" style={{ left: `${Math.min(80, Math.max(20, (x(hover!) / W) * 100))}%` }}>
              <strong>{dayLabel(h.date, { weekday: "short", day: "numeric", month: "short" })}</strong>
              {h.spent != null ? (
                <span><i className="swatch" style={{ background: "var(--series-2)" }} />Spent {money(h.spent, { whole: true })}</span>
              ) : (
                <span className="muted">Still to come</span>
              )}
              <span>Even pace {money(h.pace, { whole: true })}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
