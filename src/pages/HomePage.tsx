import { Link } from "react-router-dom";
import { useApp } from "../lib/data";
import { occurrencesBetween } from "../lib/bills";
import { useCurrentLeague } from "../lib/league";
import { money, signedMoney, spendingPace } from "../lib/money";
import type { RecurringPayment } from "../lib/types";
import PaydayCard from "../components/PaydayCard";

const PACE_TEXT = {
  ahead: "Spending slower than the month is passing",
  "on-track": "On track for this pay period",
  over: "Spending faster than the month is passing",
};

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** At-a-glance summary of everything else in the app, each part linking to its full page. */
export default function HomePage() {
  const league = useCurrentLeague();
  const { profile, status, accounts, connections, recurring, scores, transactions, syncing } = useApp();
  if (!status) return <p>Loading…</p>;

  const name = profile?.display_name?.split(" ")[0];
  const noAllowance = status.allowance <= 0;
  const pace = spendingPace(status.allowance, status.spent, status.period_start, status.period_end);

  const sum = (types: string[]) => accounts.filter((a) => types.includes(a.account_type)).reduce((s, a) => s + (a.balance ?? 0), 0);
  const current = sum(["current"]);
  const saved = sum(["savings", "investment"]);

  const points = scores.reduce((s, p) => s + p.points_total, 0);

  // Bills going out in the next 14 days, soonest first.
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 13);
  const upcoming = recurring
    .filter((r) => (r.status ?? "active").toLowerCase() === "active")
    .flatMap((r) => occurrencesBetween(r, from, to).map((date) => ({ r, date })))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const upcomingTotal = upcoming.reduce((s, u) => s + (u.r.amount ?? 0), 0);

  const recentSpends = transactions.filter((t) => t.kind === "spending").slice(0, 4);

  return (
    <div className="stack-lg">
      <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
      <PaydayCard />

      <Link to="/wallet" className={`hero hero-link ${status.remaining < 0 ? "hero-over" : ""}`}>
        <p className="eyebrow">Left to spend until payday</p>
        <p className="hero-amount">{money(status.remaining)}</p>
        {noAllowance ? (
          <p className="hero-sub">Set a monthly allowance in Settings to start your wallet.</p>
        ) : (
          <p className="hero-sub">
            {status.days_left} days to go · about {money(status.per_day)} a day · {PACE_TEXT[pace]}
          </p>
        )}
        {syncing && <p className="hero-sub small">Checking your bank for new transactions…</p>}
      </Link>

      <section className="grid-3">
        <Link to="/accounts" className="stat stat-link">
          <span className="stat-label">Current accounts</span>
          <span className="stat-value">{money(current, { whole: true })}</span>
        </Link>
        <Link to="/accounts" className="stat stat-link">
          <span className="stat-label">Savings &amp; investments</span>
          <span className="stat-value">{money(saved, { whole: true })}</span>
        </Link>
        <Link to="/points" className="stat stat-link">
          <span className="stat-label">{league ? `Points · ${league}` : "Points"}</span>
          <span className="stat-value">{points.toLocaleString("en-GB")}</span>
        </Link>
      </section>

      <section className="grid-3">
        <div className="stat">
          <span className="stat-label">Spent so far</span>
          <span className="stat-value">{money(status.spent, { whole: true })}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Bills still to come</span>
          <span className="stat-value">{money(status.bills_due, { whole: true })}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Paid in this period</span>
          <span className="stat-value">{money(status.income, { whole: true })}</span>
        </div>
      </section>

      {connections.length === 0 && (
        <section className="card">
          <h2>Connect your bank</h2>
          <p>Link your accounts so every card and contactless payment comes out of your wallet automatically.</p>
          <Link className="button primary" to="/accounts">Connect accounts</Link>
        </section>
      )}

      <div className="grid-2 grid-2-stack">
        <section className="card">
          <div className="row-between">
            <h2>Bills in the next 2 weeks</h2>
            <Link to="/bills">See all</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted small">Nothing due in the next two weeks.</p>
          ) : (
            <>
              <ul className="list">
                {upcoming.slice(0, 5).map(({ r, date }) => (
                  <BillRow key={`${r.id}-${date.getTime()}`} r={r} date={date} today={from} />
                ))}
              </ul>
              <p className="row-between muted small">
                <span>{upcoming.length > 5 ? `and ${upcoming.length - 5} more` : `${upcoming.length} payment${upcoming.length > 1 ? "s" : ""}`}</span>
                <span>{money(upcomingTotal)} total</span>
              </p>
            </>
          )}
        </section>

        <section className="card">
          <div className="row-between">
            <h2>Latest spending</h2>
            <Link to="/activity">See all</Link>
          </div>
          {recentSpends.length === 0 ? (
            <p className="muted small">Nothing yet this period.</p>
          ) : (
            <ul className="list">
              {recentSpends.map((t) => (
                <li key={t.id} className="row-between">
                  <span>
                    {t.merchant || t.description}
                    <span className="muted small block">{new Date(t.booked_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                  </span>
                  <span className={t.amount < 0 ? "neg" : "pos"}>{signedMoney(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function BillRow({ r, date, today }: { r: RecurringPayment; date: Date; today: Date }) {
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <li className="row-between">
      <span>
        {r.payee}
        <span className="muted small block">{when}</span>
      </span>
      <span>{r.amount != null ? money(r.amount) : "—"}</span>
    </li>
  );
}
