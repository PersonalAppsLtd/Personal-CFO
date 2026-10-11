import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Search, X } from "lucide-react";
import { useApp } from "../lib/data";
import { supabase } from "../supabase";
import Avatar from "../components/Avatar";

interface Friend {
  friendship_id: string;
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: "pending" | "accepted";
  direction: "friend" | "incoming" | "outgoing";
  weekly_xp: number | null;
  league: string | null;
}
interface Found {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}
interface BoardRow {
  rank: number;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  weekly_xp: number;
  league: string | null;
  is_me: boolean;
}

const nameOf = (p: { full_name: string | null; username: string | null }) => p.full_name || p.username || "Personal CFO user";

export default function FriendsPage() {
  const { profile, session } = useApp();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null | "none">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [f, b] = await Promise.all([supabase.rpc("my_friends"), supabase.rpc("friends_leaderboard")]);
    if (f.error) setError(f.error.message);
    setFriends(((f.data as Friend[] | null) ?? []).map((x) => ({ ...x, weekly_xp: x.weekly_xp == null ? null : Number(x.weekly_xp) })));
    setBoard(((b.data as BoardRow[] | null) ?? []).map((x) => ({ ...x, rank: Number(x.rank), weekly_xp: Number(x.weekly_xp) })));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!query.trim()) return;
    const { data, error } = await supabase.rpc("find_profile", { p_username: query.trim() });
    if (error) return setError(error.message);
    setFound(((data as Found[] | null) ?? [])[0] ?? "none");
  }

  async function act(run: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error } = await run();
    if (error) setError(/friendships_pair_idx|duplicate/.test(error.message) ? "You're already connected with them." : error.message);
    await load();
  }

  const add = (id: string) =>
    act(() => supabase.from("friendships").insert({ requester_id: session.user.id, addressee_id: id })).then(() => {
      setFound(null);
      setQuery("");
    });
  const accept = (id: string) => act(() => supabase.from("friendships").update({ status: "accepted" }).eq("id", id));
  const remove = (id: string) => act(() => supabase.from("friendships").delete().eq("id", id));

  const accepted = friends?.filter((f) => f.direction === "friend") ?? [];
  const incoming = friends?.filter((f) => f.direction === "incoming") ?? [];
  const outgoing = friends?.filter((f) => f.direction === "outgoing") ?? [];
  const alreadyAdded = found && found !== "none" && friends?.some((f) => f.user_id === found.id);

  return (
    <div className="stack-lg">
      <div>
        <h1>Friends</h1>
        <p className="muted">
          {profile?.username ? (
            <>Your username is <strong>{profile.username}</strong>. Share it so friends can add you.</>
          ) : (
            <>Set a username in <Link to="/settings">Settings</Link> so friends can find you.</>
          )}
        </p>
      </div>
      {error && <p className="notice">{error}</p>}

      {accepted.length > 0 && (
        <section className="card">
          <h2>This week with friends</h2>
          <ol className="leaderboard">
            {board.map((r) => (
              <li key={r.user_id} className={r.is_me ? "me" : undefined}>
                <span className={`lb-rank rank-${r.rank}`}>{r.rank}</span>
                <Avatar url={r.avatar_url} name={r.full_name} size={36} />
                <span className="lb-name">
                  {r.full_name}
                  {r.is_me && <span className="you"> (you)</span>}
                  {r.league && <span className="muted small block">{r.league} League</span>}
                </span>
                <span className="points">{r.weekly_xp} XP</span>
              </li>
            ))}
          </ol>
          <p className="hint">Friends see each other's league and XP, never any money amounts. Resets every Monday.</p>
        </section>
      )}

      <section className="card stack">
        <h2>Add a friend</h2>
        <form className="search-row" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFound(null); }}
            placeholder="Their exact username"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Their exact username"
          />
          <button className="primary icon-only" aria-label="Search"><Search size={18} aria-hidden /></button>
        </form>
        {found === "none" && <p className="muted small">No one found with that username.</p>}
        {found && found !== "none" && (
          <div className="person">
            <Avatar url={found.avatar_url} name={nameOf({ full_name: found.full_name, username: found.username })} size={40} />
            <span className="person-name">
              {nameOf({ full_name: found.full_name, username: found.username })}
              <span className="muted small block">@{found.username}</span>
            </span>
            {alreadyAdded ? <span className="muted small">Already added</span> : <button onClick={() => add(found.id)}>Add friend</button>}
          </div>
        )}
      </section>

      {incoming.length > 0 && (
        <section className="card">
          <h2>Friend requests</h2>
          <ul className="list">
            {incoming.map((f) => (
              <li key={f.friendship_id} className="person">
                <Avatar url={f.avatar_url} name={nameOf(f)} size={40} />
                <span className="person-name">
                  {nameOf(f)}
                  <span className="muted small block">wants to be your friend</span>
                </span>
                <button className="primary icon-only" onClick={() => accept(f.friendship_id)} aria-label={`Accept ${nameOf(f)}`}><Check size={18} aria-hidden /></button>
                <button className="icon-only" onClick={() => remove(f.friendship_id)} aria-label={`Decline ${nameOf(f)}`}><X size={18} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Friends</h2>
        {friends === null ? (
          <p className="muted">Loading…</p>
        ) : accepted.length === 0 ? (
          <p className="muted">No friends yet. Add someone by their username above.</p>
        ) : (
          <ul className="list">
            {accepted.map((f) => (
              <li key={f.friendship_id} className="person">
                <Avatar url={f.avatar_url} name={nameOf(f)} size={40} />
                <span className="person-name">
                  {nameOf(f)}
                  <span className="muted small block">{f.league ? `${f.league} League · ` : ""}{f.weekly_xp ?? 0} XP this week</span>
                </span>
                <button
                  className="icon-button"
                  onClick={() => confirm(`Remove ${nameOf(f)} from your friends?`) && remove(f.friendship_id)}
                  aria-label={`Remove ${nameOf(f)}`}
                  title="Remove"
                >
                  <X size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="card">
          <h2>Sent requests</h2>
          <ul className="list">
            {outgoing.map((f) => (
              <li key={f.friendship_id} className="person">
                <Avatar url={f.avatar_url} name={nameOf(f)} size={40} />
                <span className="person-name">
                  {nameOf(f)}
                  <span className="muted small block">Waiting for them to accept</span>
                </span>
                <button onClick={() => remove(f.friendship_id)}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
