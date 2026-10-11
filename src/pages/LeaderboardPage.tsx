import { useEffect, useRef, useState } from "react";
import { Lock, Shield } from "lucide-react";
import { supabase } from "../supabase";
import Avatar from "../components/Avatar";
import type { LadderTier, LeaderboardRow, WeeklyXp } from "../lib/types";

// Shield colour for each tier, bottom (bronze) to top - same as Personal CEO
const SHIELD_COLOURS = ["#cd7f32", "#9aa5b1", "#e0a526", "#2f6fd6", "#d63a4a", "#23a26d", "#8e5bd6", "#d98aa5", "#3f3f4e", "#38bdd6"];
const shieldColour = (rank: number) => SHIELD_COLOURS[(rank - 1) % SHIELD_COLOURS.length];
// Tier 1 is "League 10", the top tier is "League 1"
const leagueNumber = (rank: number) => 11 - rank;

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Time until the week resets (Monday 00:00). */
function timeLeft(now = new Date()): string {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
  const hours = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 36e5));
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function LeaderboardPage() {
  const [ladder, setLadder] = useState<LadderTier[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [xp, setXp] = useState<WeeklyXp | null>(null);
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    supabase.rpc("league_ladder").then(({ data }) => setLadder((data as LadderTier[] | null) ?? []));
    supabase.rpc("league_leaderboard").then(({ data }) =>
      setBoard(((data as LeaderboardRow[] | null) ?? []).map((r) => ({ ...r, rank: Number(r.rank), weekly_xp: Number(r.weekly_xp) }))),
    );
    supabase.rpc("my_weekly_xp").then(({ data }) => setXp(((data as WeeklyXp[] | null) ?? [])[0] ?? null));
  }, []);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ladder]);

  const current = ladder.find((t) => t.is_current);
  const me = board?.find((r) => r.is_me);
  const tiers: LadderTier[] = ladder.length
    ? ladder
    : Array.from({ length: 10 }, (_, i) => ({ tier_id: i + 1, rank: i + 1, name: null, unlocked: false, is_current: false }));

  return (
    <div className="stack-lg">
      <h1>Leaderboard</h1>

      <nav className="league-bar" aria-label="Leagues">
        <ol>
          {tiers.map((t) => (
            <li
              key={t.tier_id}
              ref={t.is_current ? currentRef : undefined}
              className={["league-badge", t.unlocked ? "unlocked" : "locked", t.is_current ? "current" : ""].join(" ")}
              title={`League ${leagueNumber(t.rank)} · ${t.unlocked ? t.name : "Locked"}`}
              aria-current={t.is_current ? "true" : undefined}
            >
              <span className="league-shield">
                <Shield
                  size={t.is_current ? 52 : 40}
                  strokeWidth={1.5}
                  fill={t.unlocked ? shieldColour(t.rank) : "currentColor"}
                  color={t.unlocked ? shieldColour(t.rank) : "currentColor"}
                  aria-hidden
                />
                <span className="league-shield-inner">
                  {t.unlocked ? leagueNumber(t.rank) : <Lock size={t.is_current ? 18 : 14} aria-hidden />}
                </span>
              </span>
              <span className="league-badge-name">{t.unlocked ? t.name : "???"}</span>
            </li>
          ))}
        </ol>
      </nav>

      <section className="card league-summary">
        {current && <span className="league-number">League {leagueNumber(current.rank)}</span>}
        <h2 className="league-title">{current?.name ?? ""} League</h2>
        <div className="league-stats">
          <div>
            <span className="league-stat-value">{me?.weekly_xp ?? 0}</span>
            <span className="league-stat-label">XP this week</span>
          </div>
          <div>
            <span className="league-stat-value">
              {me ? ordinal(me.rank) : "–"}
              {board && board.length > 0 && <small> of {board.length}</small>}
            </span>
            <span className="league-stat-label">Your position</span>
          </div>
          <div>
            <span className="league-stat-value">{timeLeft()}</span>
            <span className="league-stat-label">Left this week</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>How you're earning XP</h2>
        <ul className="list">
          <li className="row-between">
            <span>Saving <span className="muted small block">10 XP for every 1% of your monthly income saved</span></span>
            <strong>{xp?.saving_xp ?? 0} XP</strong>
          </li>
          <li className="row-between">
            <span>Investing <span className="muted small block">20 XP for every 1% invested</span></span>
            <strong>{xp?.investing_xp ?? 0} XP</strong>
          </li>
          <li className="row-between">
            <span>Paying off debt <span className="muted small block">10 XP for every 1% put towards credit cards and loans</span></span>
            <strong>{xp?.debt_xp ?? 0} XP</strong>
          </li>
          <li className="row-between">
            <span>
              Days within your allowance
              <span className="muted small block">15 XP for each finished day ({xp?.budget_days ?? 0} so far)</span>
            </span>
            <strong>{xp?.budget_xp ?? 0} XP</strong>
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>This week</h2>
        {board === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <ol className="leaderboard">
            {board.map((r) => (
              <li key={r.user_id} className={r.is_me ? "me" : undefined}>
                <span className={`lb-rank rank-${r.rank}`}>{r.rank}</span>
                <Avatar url={r.avatar_url} name={r.full_name} size={36} />
                <span className="lb-name">
                  {r.full_name}
                  {r.is_me && <span className="you"> (you)</span>}
                </span>
                <span className="points">{r.weekly_xp} XP</span>
              </li>
            ))}
          </ol>
        )}
        <p className="hint">Rankings reset every Monday. The top 3 move up a league and the bottom 3 move down.</p>
      </section>
    </div>
  );
}
