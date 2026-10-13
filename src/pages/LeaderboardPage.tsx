import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Lock, Shield } from "lucide-react";
import { supabase } from "../supabase";
import Avatar from "../components/Avatar";
import { TIER_COLOURS, getTierColour, getTierFill } from "../lib/tierColours";
import type { LadderTier, LeaderboardRow } from "../lib/types";

const leagueNumber = (rank: number) => 11 - rank;

// Matches close_league_week: the top 3 move up and the bottom 3 move down each Monday
const ZONE_SIZE = 3;
const TOP_TIER_RANK = 10;

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
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    supabase.rpc("league_ladder").then(({ data }) => setLadder((data as LadderTier[] | null) ?? []));
    supabase.rpc("league_leaderboard").then(({ data }) =>
      setBoard(((data as LeaderboardRow[] | null) ?? []).map((r) => ({ ...r, rank: Number(r.rank), weekly_xp: Number(r.weekly_xp) }))),
    );
  }, []);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ladder]);

  const current = ladder.find((t) => t.is_current);
  // No promotion zone in the top league and no relegation zone in the bottom one
  const promotionZone = current && current.rank < TOP_TIER_RANK ? ZONE_SIZE : 0;
  const relegationZone = current && current.rank > 1 ? ZONE_SIZE : 0;
  const me = board?.find((r) => r.is_me);
  const tiers: LadderTier[] = ladder.length
    ? ladder
    : Array.from({ length: 10 }, (_, i) => ({ tier_id: i + 1, rank: i + 1, name: null, unlocked: false, is_current: false }));

  return (
    <div className="stack-lg">
      <h1>Leaderboard</h1>

      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {TIER_COLOURS.filter((c) => c.gradient).map((c) => (
            <linearGradient key={c.id} id={`tier-gradient-${c.id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={c.gradient![0]} />
              <stop offset="100%" stopColor={c.gradient![1]} />
            </linearGradient>
          ))}
        </defs>
      </svg>

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
                  fill={t.unlocked ? getTierFill(t.tier_id) : "currentColor"}
                  color={t.unlocked ? getTierColour(t.tier_id).colour : "currentColor"}
                  aria-hidden
                />
                <span className="league-shield-inner" style={t.unlocked ? { color: getTierColour(t.tier_id).ink } : undefined}>
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
        <h2>This week</h2>
        {board === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <ol className="leaderboard">
            {board.map((r, i) => {
              const zone = i < promotionZone ? "up" : i >= board.length - relegationZone ? "down" : null;
              return (
                <Fragment key={r.user_id}>
                  <li className={[r.is_me ? "me" : "", zone ? `zone-${zone}` : ""].filter(Boolean).join(" ") || undefined}>
                    <span className={`lb-rank rank-${r.rank}`}>{r.rank}</span>
                    <Avatar url={r.avatar_url} name={r.full_name} size={36} />
                    <span className="lb-name">
                      {r.full_name}
                      {r.is_me && <span className="you"> (you)</span>}
                      {zone && <span className="sr-only">{zone === "up" ? ", in the promotion zone" : ", in the relegation zone"}</span>}
                    </span>
                    <span className="points">{r.weekly_xp} XP</span>
                  </li>
                  {/* Dividers below the promotion zone and above the relegation zone, as in Personal CEO */}
                  {promotionZone > 0 && i === promotionZone - 1 && board.length > promotionZone && (
                    <li className="zone-divider promotion" aria-hidden><ChevronUp size={14} /> Promotion zone</li>
                  )}
                  {relegationZone > 0 && i === board.length - relegationZone - 1 && (
                    <li className="zone-divider relegation" aria-hidden><ChevronDown size={14} /> Relegation zone</li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        )}
        <p className="hint">
          Rankings reset every Monday.{" "}
          {current?.rank === TOP_TIER_RANK
            ? "This is the top league, so only the bottom 3 move down."
            : current?.rank === 1
              ? "The top 3 move up a league. This is the first league, so nobody moves down."
              : "The top 3 move up a league and the bottom 3 move down."}
        </p>
      </section>
    </div>
  );
}
