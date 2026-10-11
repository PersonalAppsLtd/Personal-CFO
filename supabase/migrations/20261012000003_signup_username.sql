-- Usernames are chosen when creating an account (like Personal CEO).

-- Lets the sign-up form check a username before the account is created
create function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select trim(p_username) ~ '^[A-Za-z0-9_.]{3,30}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(trim(p_username)));
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- New profiles take the username from sign-up. The email address is no longer used as a display name,
-- because names appear on league tables; people show by username until they add their full name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  -- A bad or already-taken username must never block the account being created; they can set it later
  if v_username is not null and not public.username_available(v_username) then
    v_username := null;
  end if;
  insert into public.profiles (id, display_name, username)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  return new;
end;
$$;
