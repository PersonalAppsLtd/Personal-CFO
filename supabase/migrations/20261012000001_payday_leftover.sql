-- Payday leftovers: when a new pay arrives and last period's allowance wasn't all spent,
-- ask the user what to do with it (save, invest, add to this period's allowance, or leave it).

create table public.leftover_decisions (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The pay period the decision was made in (the one that has just started)
  period_start date not null,
  leftover numeric(12, 2) not null,
  choice text not null check (choice in ('save', 'invest', 'rollover', 'keep')),
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, period_start)
);
alter table public.leftover_decisions enable row level security;
create policy "own leftover decisions read" on public.leftover_decisions for select to authenticated
  using (user_id = (select auth.uid()));

-- Day-to-day spending in a date range (the same rule the allowance uses)
create function public._period_spent(p_user uuid, p_start date, p_end date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(-t.amount), 0)
    from public.transactions t
    join public.accounts a on a.id = t.account_id
   where t.user_id = p_user and t.kind = 'spending' and a.include_in_spending
     and (t.booked_at at time zone 'Europe/London')::date between p_start and p_end;
$$;

create function public._rollover_for(p_user uuid, p_period_start date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.amount from public.leftover_decisions d
                    where d.user_id = p_user and d.period_start = p_period_start and d.choice = 'rollover'), 0);
$$;

create or replace function public._allowance_for(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_start date;
  v_end date;
  v_spent numeric;
  v_income numeric;
  v_bills_due numeric;
  v_allowance numeric;
  v_remaining numeric;
  v_days_left integer;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return null;
  end if;

  select pp.period_start, pp.period_end into v_start, v_end from public.pay_period(v_profile.payday, v_today) pp;

  select coalesce(sum(-t.amount), 0) into v_spent
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.user_id = p_user and t.kind = 'spending' and a.include_in_spending
    and (t.booked_at at time zone 'Europe/London')::date between v_start and v_end;

  select coalesce(sum(t.amount), 0) into v_income
  from public.transactions t
  where t.user_id = p_user and t.kind = 'income'
    and (t.booked_at at time zone 'Europe/London')::date between v_start and v_end;

  select coalesce(sum(abs(r.amount)), 0) into v_bills_due
  from public.recurring_payments r
  where r.user_id = p_user and coalesce(r.status, 'active') ilike 'active'
    and coalesce(r.next_payment_date, (r.last_payment_at + interval '1 month')::date) between v_today and v_end;

  -- Card-paid bills: whatever is left of each budget this period is still to come
  v_bills_due := v_bills_due + coalesce((
    select sum(greatest(b.monthly_amount - coalesce((
      select sum(-t.amount)
      from public.transactions t
      where t.user_id = p_user and t.kind = 'bill'
        and (t.booked_at at time zone 'Europe/London')::date between v_start and v_end
        and exists (
          select 1 from unnest(b.keywords) k
          where length(k) >= 2 and lower(t.description || ' ' || coalesce(t.merchant, '')) like '%' || lower(k) || '%'
        )
    ), 0), 0))
    from public.bill_budgets b
    where b.user_id = p_user
  ), 0);

  -- Leftover from last period that the user chose to roll into this one
  v_allowance := coalesce(v_profile.monthly_allowance, 0) + public._rollover_for(p_user, v_start);
  v_remaining := v_allowance - v_spent;
  v_days_left := v_end - v_today + 1;

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'days_left', v_days_left,
    'allowance', v_allowance,
    'spent', v_spent,
    'remaining', v_remaining,
    'per_day', case when v_days_left > 0 then round(greatest(v_remaining, 0) / v_days_left, 2) else 0 end,
    'income', v_income,
    'bills_due', v_bills_due,
    'rollover', public._rollover_for(p_user, v_start),
    'currency', v_profile.currency
  );
end;
$$;

-- What's left from the previous period, once this period's pay has arrived and no choice has been made yet
create function public._payday_leftover(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_cur_start date;
  v_prev_start date;
  v_prev_end date;
  v_income numeric;
  v_leftover numeric;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found or coalesce(v_profile.monthly_allowance, 0) <= 0 then
    return null;
  end if;
  select pp.period_start into v_cur_start from public.pay_period(v_profile.payday, v_today) pp;
  if exists (select 1 from public.leftover_decisions d where d.user_id = p_user and d.period_start = v_cur_start) then
    return null;
  end if;

  -- Only once the new pay has landed
  select coalesce(sum(t.amount), 0) into v_income
    from public.transactions t
   where t.user_id = p_user and t.kind = 'income'
     and (t.booked_at at time zone 'Europe/London')::date between v_cur_start and v_today;
  if v_income <= 0 then
    return null;
  end if;

  select pp.period_start, pp.period_end into v_prev_start, v_prev_end from public.pay_period(v_profile.payday, v_cur_start - 1) pp;
  v_leftover := round(v_profile.monthly_allowance + public._rollover_for(p_user, v_prev_start)
                      - public._period_spent(p_user, v_prev_start, v_prev_end), 2);
  if v_leftover < 1 then
    return null;
  end if;

  return jsonb_build_object(
    'period_start', v_cur_start,
    'previous_start', v_prev_start,
    'previous_end', v_prev_end,
    'leftover', v_leftover,
    'income', v_income,
    -- 10 points (and 10 XP) per 1% of pay saved; investing earns double
    'save_points', round(1000 * v_leftover / v_income),
    'invest_points', round(2000 * v_leftover / v_income)
  );
end;
$$;
revoke execute on function public._payday_leftover(uuid) from public, anon, authenticated;

create function public.payday_prompt()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._payday_leftover(auth.uid());
$$;

create function public.decide_leftover(p_choice text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prompt jsonb := public._payday_leftover(auth.uid());
  v_leftover numeric;
begin
  if v_prompt is null then
    raise exception 'There is no leftover money to decide on right now';
  end if;
  v_leftover := (v_prompt ->> 'leftover')::numeric;
  if p_choice not in ('save', 'invest', 'rollover', 'keep') then
    raise exception 'Unknown choice';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > v_leftover then
    raise exception 'Choose an amount between £0 and %', public.money(v_leftover);
  end if;
  insert into public.leftover_decisions (user_id, period_start, leftover, choice, amount)
  values (auth.uid(), (v_prompt ->> 'period_start')::date, v_leftover, p_choice,
          case when p_choice = 'keep' then 0 else round(p_amount, 2) end);
end;
$$;

revoke execute on function public.payday_prompt() from public, anon;
grant execute on function public.payday_prompt() to authenticated;
revoke execute on function public.decide_leftover(text, numeric) from public, anon;
grant execute on function public.decide_leftover(text, numeric) to authenticated;
revoke execute on function public._period_spent(uuid, date, date) from public, anon, authenticated;
revoke execute on function public._rollover_for(uuid, date) from public, anon, authenticated;

-- Tell the user when their pay lands and there's leftover money to decide on (once per period)
create table public.payday_notices (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  primary key (user_id, period_start)
);
alter table public.payday_notices enable row level security;

create function public.notify_on_payday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prompt jsonb;
begin
  if new.kind <> 'income' or new.amount <= 0 or not new.notify then
    return null;
  end if;
  v_prompt := public._payday_leftover(new.user_id);
  if v_prompt is null then
    return null;
  end if;
  insert into public.payday_notices (user_id, period_start)
  values (new.user_id, (v_prompt ->> 'period_start')::date)
  on conflict do nothing;
  if not found then
    return null; -- already told them this period
  end if;
  insert into public.notifications (user_id, transaction_id, title, body)
  values (new.user_id, new.id,
          'Payday! You have ' || public.money((v_prompt ->> 'leftover')::numeric) || ' left over',
          'Open Personal CFO to save or invest it for up to ' || (v_prompt ->> 'invest_points') || ' extra points, or add it to this month''s allowance.');
  return null;
end;
$$;
revoke execute on function public.notify_on_payday() from public, anon, authenticated;

create trigger transactions_notify_on_payday
  after insert on public.transactions
  for each row execute function public.notify_on_payday();
