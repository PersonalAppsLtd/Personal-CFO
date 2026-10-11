-- Friends, modelled on Personal CEO: requests by exact username, accept/decline, and a weekly XP comparison.
-- Friends only ever see each other's name, picture, league and XP - never any money amounts.

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index on public.friendships (addressee_id);

alter table public.friendships enable row level security;
create policy "Users can view own friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy "Users can send friend requests" on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');
create policy "Users can accept requests sent to them" on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()))
  with check (addressee_id = (select auth.uid()) and status = 'accepted');
create policy "Users can remove own friendships" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
revoke update on public.friendships from authenticated, anon;
grant update (status) on public.friendships to authenticated;

-- Look someone up by their exact username (case-insensitive)
create function public.find_profile(p_username text)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
   where lower(p.username) = lower(trim(p_username))
     and p.id <> auth.uid()
     and auth.uid() is not null
   limit 1;
$$;

create function public.my_friends()
returns table (friendship_id uuid, user_id uuid, username text, full_name text, avatar_url text,
               status text, direction text, weekly_xp bigint, league text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id,
         p.id, p.username, p.display_name, p.avatar_url,
         f.status,
         case when f.status = 'accepted' then 'friend'
              when f.requester_id = auth.uid() then 'outgoing'
              else 'incoming' end,
         case when f.status = 'accepted' then
           (select x.total from public.user_weekly_xp(p.id, public.week_start(), now()) x)::bigint end,
         case when f.status = 'accepted' then (select t.name from public.tiers t where t.id = p.current_tier_id) end
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id)
   order by f.status desc, coalesce(p.display_name, p.username);
$$;

-- You and your friends, ranked by XP this week
create function public.friends_leaderboard()
returns table (rank bigint, user_id uuid, full_name text, avatar_url text, weekly_xp bigint, league text, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select auth.uid() as id
    union
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
      from public.friendships f
     where f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id)
  ),
  scored as (
    select p.id, coalesce(nullif(p.display_name, ''), p.username, 'Personal CFO user') as full_name, p.avatar_url,
           (select x.total from public.user_weekly_xp(p.id, public.week_start(), now()) x)::bigint as weekly_xp,
           (select t.name from public.tiers t where t.id = p.current_tier_id) as league
      from people
      join public.profiles p on p.id = people.id
  )
  select rank() over (order by weekly_xp desc), id, full_name, avatar_url, weekly_xp, league, id = auth.uid()
    from scored
   order by weekly_xp desc, full_name;
$$;

revoke execute on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;
revoke execute on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;
revoke execute on function public.friends_leaderboard() from public, anon;
grant execute on function public.friends_leaderboard() to authenticated;

-- Let people know when someone adds them, and when a request is accepted
create function public.notify_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(display_name, ''), username, 'Someone') into v_name from public.profiles where id = new.requester_id;
    insert into public.notifications (user_id, title, body)
    values (new.addressee_id, v_name || ' wants to be your friend', 'Accept on the Friends tab to compete with each other each week.');
  elsif new.status = 'accepted' and old.status = 'pending' then
    select coalesce(nullif(display_name, ''), username, 'Someone') into v_name from public.profiles where id = new.addressee_id;
    insert into public.notifications (user_id, title, body)
    values (new.requester_id, v_name || ' accepted your friend request', 'See how you compare on the Friends tab.');
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_on_friendship() from public, anon, authenticated;

create trigger friendships_notify
  after insert or update on public.friendships
  for each row execute function public.notify_on_friendship();
