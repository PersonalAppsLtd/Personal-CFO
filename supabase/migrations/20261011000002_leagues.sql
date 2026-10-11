-- Weekly leagues, modelled on Personal CEO: 10 tiers, each with 9 simulated rivals.
-- XP comes from money habits: saving, investing and staying within the daily allowance.

create table public.tiers (
  id smallint primary key,
  name text not null,
  rank smallint not null unique
);
insert into public.tiers (id, name, rank) values
  (1, 'Intern', 1),
  (2, 'Junior Analyst', 2),
  (3, 'Analyst', 3),
  (4, 'Senior Analyst', 4),
  (5, 'Financial Controller', 5),
  (6, 'Finance Director', 6),
  (7, 'CFO', 7),
  (8, 'Chairman', 8),
  (9, 'Board of Directors', 9),
  (10, 'Elite', 10);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier_id smallint not null references public.tiers (id),
  performance_level text not null check (performance_level in ('weak', 'average', 'strong'))
);
-- 9 rivals per tier, in order: 3 weak, 3 average, 3 strong
insert into public.bots (name, tier_id, performance_level)
select n.name, ((n.i - 1) / 9 + 1)::smallint, (array['weak', 'average', 'strong'])[(((n.i - 1) % 9) / 3 + 1)::int]
  from unnest(array[
    'Amelia A.', 'Oliver H.', 'Isla R.', 'Noah D.', 'Ava L.', 'Leo W.', 'Mia G.', 'Arthur P.', 'Ivy C.',
    'Oscar K.', 'Freya T.', 'Harry F.', 'Lily N.', 'Jack B.', 'Grace J.', 'George S.', 'Sophia E.', 'Theo M.',
    'Evie A.', 'Alfie H.', 'Ella R.', 'Charlie D.', 'Poppy L.', 'Finley W.', 'Rosie G.', 'Archie P.', 'Willow C.',
    'Henry K.', 'Daisy T.', 'Jacob F.', 'Sienna N.', 'Thomas B.', 'Zara J.', 'Isaac S.', 'Maya E.', 'Logan M.',
    'Aria A.', 'Ethan H.', 'Erin R.', 'Mason D.', 'Hannah L.', 'Lucas W.', 'Ruby G.', 'Max P.', 'Phoebe C.',
    'Samuel K.', 'Matilda T.', 'Joshua F.', 'Imogen N.', 'Dylan B.', 'Layla J.', 'Adam S.', 'Nina E.', 'Ryan M.',
    'Eliza A.', 'Kai H.', 'Priya R.', 'Omar D.', 'Aisha L.', 'Ravi W.', 'Mei G.', 'Hugo P.', 'Chloe C.',
    'Felix K.', 'Holly T.', 'Rory F.', 'Lucy N.', 'Zain B.', 'Leah J.', 'Ali S.', 'Megan E.', 'Toby M.',
    'Jade A.', 'Ben H.', 'Iris R.', 'Sam D.', 'Anya L.', 'Luca W.', 'Tara G.', 'Owen P.', 'Nadia C.',
    'Jamie K.', 'Elena T.', 'Kofi F.', 'Sara N.', 'Dev B.', 'Leila J.', 'Aaron S.', 'Beth E.', 'Musa M.'
  ]) with ordinality as n(name, i);

alter table public.profiles add column current_tier_id smallint not null default 1 references public.tiers (id);

-- One row per user per finished week: where they finished and whether they moved league
create table public.league_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  tier_id smallint not null references public.tiers (id),
  final_rank smallint not null,
  players smallint not null,
  weekly_xp integer not null,
  movement text not null check (movement in ('up', 'down', 'stay')),
  primary key (user_id, week_start)
);

alter table public.tiers enable row level security;
alter table public.bots enable row level security;
alter table public.league_results enable row level security;
create policy "tiers readable" on public.tiers for select to authenticated using (true);
create policy "own league results" on public.league_results for select to authenticated using (user_id = (select auth.uid()));

-- Monday 00:00 UK time of the current week
create function public.week_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('week', now() at time zone 'Europe/London')) at time zone 'Europe/London';
$$;

-- Deterministic pseudo-random integer in [0, p_n) from a text seed
create function public.bot_rand(p_seed text, p_n integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((hashtext(p_seed) % p_n) + p_n) % p_n;
$$;

-- A rival's XP so far this week: a fixed set of "good money moves" spread through the week, revealed as time passes
create function public.bot_weekly_xp(p_bot uuid, p_level text, p_tier_rank integer, p_week timestamptz, p_now timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  with seed as (
    select p_bot::text || ':' || extract(epoch from p_week)::bigint::text as s
  ),
  plan as (
    select greatest(1, round(
             (case p_level when 'weak' then 40 when 'average' then 90 else 150 end)
             * power(1.25, p_tier_rank - 1)
             * (0.65 + public.bot_rand(seed.s || 'target', 71) / 100.0)
             / 13.3
           ))::int as move_count
      from seed
  ),
  done as (
    select (array[5, 10, 10, 15, 15, 25])[1 + public.bot_rand(seed.s || g || 'p', 6)] as points,
           p_week + make_interval(
             days  => public.bot_rand(seed.s || g || 'd', 7),
             hours => 7 + public.bot_rand(seed.s || g || 'h', 16),
             mins  => public.bot_rand(seed.s || g || 'm', 60)
           ) as done_at
      from seed, plan, generate_series(1, plan.move_count) as g
  )
  select coalesce(sum(points), 0)::bigint from done where done_at <= p_now;
$$;

-- A person's XP for the week starting p_week, counting everything up to p_now:
--   10 XP per 1% of monthly income saved, 20 XP per 1% invested,
--   15 XP for every finished day spent within the daily allowance
create function public.user_weekly_xp(p_user uuid, p_week timestamptz, p_now timestamptz)
returns table (saving_xp integer, investing_xp integer, budget_xp integer, budget_days integer, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select least(p_now, p_week + interval '7 days') as upto
  ),
  prof as (
    select p.payday, coalesce(p.monthly_allowance, 0) as allowance from public.profiles p where p.id = p_user
  ),
  basis as (
    select coalesce(sum(t.amount), 0) as income
      from public.transactions t, bounds
     where t.user_id = p_user and t.kind = 'income'
       and t.booked_at > bounds.upto - interval '31 days' and t.booked_at <= bounds.upto
  ),
  week as (
    select coalesce(sum(-t.amount) filter (where t.kind = 'saving'), 0) as saved,
           coalesce(sum(-t.amount) filter (where t.kind = 'investment'), 0) as invested
      from public.transactions t, bounds
     where t.user_id = p_user and t.amount < 0
       and t.booked_at >= p_week and t.booked_at < bounds.upto
  ),
  days as (
    select d::date as day
      from bounds, generate_series(
        (p_week at time zone 'Europe/London')::date,
        (bounds.upto at time zone 'Europe/London')::date - 1,
        interval '1 day') d
  ),
  day_check as (
    select days.day,
           prof.allowance / (pp.period_end - pp.period_start + 1) as daily_allowance,
           (select coalesce(sum(-t.amount), 0)
              from public.transactions t
              join public.accounts a on a.id = t.account_id
             where t.user_id = p_user and t.kind = 'spending' and a.include_in_spending
               and (t.booked_at at time zone 'Europe/London')::date = days.day) as spent
      from days, prof
      cross join lateral public.pay_period(prof.payday, days.day) pp
  ),
  scored as (
    select
      case when basis.income > 0 then greatest(round(1000 * week.saved / basis.income), 0) else 0 end::int as s_xp,
      case when basis.income > 0 then greatest(round(2000 * week.invested / basis.income), 0) else 0 end::int as i_xp,
      (select count(*) from day_check, prof where prof.allowance > 0 and day_check.spent <= day_check.daily_allowance)::int as b_days
    from basis, week
  )
  select s_xp, i_xp, b_days * 15, b_days, s_xp + i_xp + b_days * 15 from scored;
$$;
revoke execute on function public.user_weekly_xp(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- How the signed-in user is earning XP this week
create function public.my_weekly_xp()
returns table (saving_xp integer, investing_xp integer, budget_xp integer, budget_days integer, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.user_weekly_xp(auth.uid(), public.week_start(), now());
$$;

create function public.league_ladder()
returns table (tier_id smallint, rank smallint, name text, unlocked boolean, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.current_tier_id, t.rank
      from public.profiles p
      join public.tiers t on t.id = p.current_tier_id
     where p.id = auth.uid()
  )
  select t.id, t.rank, case when t.rank <= me.rank then t.name end, t.rank <= me.rank, t.id = me.current_tier_id
    from public.tiers t, me
   order by t.rank;
$$;

-- Everyone in a tier (real people who have set up the app, plus that tier's rivals) at a point in a week
create function public._league_standings(p_tier smallint, p_week timestamptz, p_now timestamptz)
returns table (rank bigint, user_id uuid, full_name text, avatar_url text, weekly_xp bigint, is_bot boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tier as (
    select rank as tier_rank from public.tiers where id = p_tier
  ),
  people as (
    select p.id, p.display_name as full_name, p.avatar_url, p.created_at,
           (select x.total from public.user_weekly_xp(p.id, p_week, p_now) x)::bigint as weekly_xp,
           false as is_bot
      from public.profiles p
     where p.current_tier_id = p_tier and p.onboarded
  ),
  bot_rows as (
    select b.id, b.name, null::text, null::timestamptz,
           public.bot_weekly_xp(b.id, b.performance_level, tier.tier_rank, p_week, p_now),
           true
      from public.bots b, tier
     where b.tier_id = p_tier
  ),
  everyone as (
    select * from people
    union all
    select * from bot_rows
  )
  select rank() over (order by weekly_xp desc, is_bot, created_at), id, full_name, avatar_url, weekly_xp, is_bot
    from everyone
   order by weekly_xp desc, is_bot, created_at;
$$;
revoke execute on function public._league_standings(smallint, timestamptz, timestamptz) from public, anon, authenticated;

create function public.league_leaderboard()
returns table (rank bigint, user_id uuid, full_name text, avatar_url text, weekly_xp bigint, is_me boolean, is_bot boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.rank, s.user_id, coalesce(s.full_name, 'Personal CFO user'), s.avatar_url, s.weekly_xp, s.user_id = auth.uid(), s.is_bot
    from public.profiles p
    cross join lateral public._league_standings(p.current_tier_id, public.week_start(), now()) s
   where p.id = auth.uid()
   limit 50;
$$;

-- Run every Monday: settle last week, move the top 3 up and the bottom 3 down, and tell people
create function public.close_league_week()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week timestamptz := public.week_start() - interval '7 days';
  v_end timestamptz := public.week_start();
  v_tier record;
  v_row record;
  v_players integer;
  v_move text;
  v_new_tier smallint;
  v_max_rank smallint := (select max(rank) from public.tiers);
  v_moved integer := 0;
begin
  for v_tier in select id, rank from public.tiers loop
    select count(*) into v_players from public._league_standings(v_tier.id, v_week, v_end);
    for v_row in
      select * from public._league_standings(v_tier.id, v_week, v_end) s where not s.is_bot
    loop
      if exists (select 1 from public.league_results r where r.user_id = v_row.user_id and r.week_start = v_week::date) then
        continue; -- already settled
      end if;
      v_move := case
        when v_row.rank <= 3 and v_tier.rank < v_max_rank then 'up'
        when v_row.rank > v_players - 3 and v_tier.rank > 1 then 'down'
        else 'stay' end;
      v_new_tier := (select t.id from public.tiers t
                      where t.rank = v_tier.rank + case v_move when 'up' then 1 when 'down' then -1 else 0 end);
      insert into public.league_results (user_id, week_start, tier_id, final_rank, players, weekly_xp, movement)
      values (v_row.user_id, v_week::date, v_tier.id, v_row.rank, v_players, v_row.weekly_xp, v_move);
      if v_move <> 'stay' then
        update public.profiles set current_tier_id = v_new_tier where id = v_row.user_id;
        v_moved := v_moved + 1;
      end if;
      insert into public.notifications (user_id, title, body)
      values (
        v_row.user_id,
        case v_move when 'up' then 'Promoted to the ' || (select name from public.tiers where id = v_new_tier) || ' League'
                    when 'down' then 'Moved down to the ' || (select name from public.tiers where id = v_new_tier) || ' League'
                    else 'You finished ' || v_row.rank || ' of ' || v_players || ' this week' end,
        'Last week you earned ' || v_row.weekly_xp || ' XP. A new week has started, so save, invest and stay within your allowance to climb.'
      );
    end loop;
  end loop;
  return v_moved;
end;
$$;
revoke execute on function public.close_league_week() from public, anon, authenticated;

revoke execute on function public.my_weekly_xp() from public, anon;
grant execute on function public.my_weekly_xp() to authenticated;
revoke execute on function public.league_ladder() from public, anon;
grant execute on function public.league_ladder() to authenticated;
revoke execute on function public.league_leaderboard() from public, anon;
grant execute on function public.league_leaderboard() to authenticated;

-- Settle the week every Monday shortly after midnight UK time
create extension if not exists pg_cron;
select cron.schedule('personal-cfo-close-league-week', '10 0 * * 1', 'select public.close_league_week()');
