-- Username and job title on the profile, matching Personal CEO's personal details.
alter table public.profiles
  add column username text check (username ~ '^[A-Za-z0-9_.]{3,30}$'),
  add column job_title text check (length(job_title) <= 100);
create unique index profiles_username_unique on public.profiles (lower(username));

grant update (username, job_title) on public.profiles to authenticated;

-- Leaderboards show the full name, or the username when no name is set
create or replace function public._league_standings(p_tier smallint, p_week timestamptz, p_now timestamptz)
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
    select p.id, coalesce(nullif(p.display_name, ''), p.username) as full_name, p.avatar_url, p.created_at,
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
