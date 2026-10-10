-- Card-paid bills (fuel, groceries, parking...): budgeted costs that don't come out of the spending allowance.

alter table public.transactions drop constraint transactions_kind_check,
  add constraint transactions_kind_check check (kind in ('income', 'spending', 'direct_debit', 'standing_order', 'bill', 'saving', 'investment', 'transfer'));
alter table public.category_rules drop constraint category_rules_kind_check,
  add constraint category_rules_kind_check check (kind in ('income', 'spending', 'direct_debit', 'standing_order', 'bill', 'saving', 'investment', 'transfer'));

create table public.bill_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  monthly_amount numeric(12, 2) not null check (monthly_amount >= 0),
  -- Card payments whose description contains any of these words belong to this bill
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.bill_budgets (user_id);
alter table public.bill_budgets enable row level security;
create policy "own bill budgets all" on public.bill_budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.classify_transaction(
  p_user uuid,
  p_amount numeric,
  p_description text,
  p_merchant text,
  p_provider_category text,
  p_account_type text
) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := lower(coalesce(p_description, '') || ' ' || coalesce(p_merchant, ''));
  v_kind text;
begin
  -- 1. The user's own rules win
  select r.kind into v_kind
  from public.category_rules r
  where r.user_id = p_user and v_text like '%' || lower(r.pattern) || '%'
  order by length(r.pattern) desc
  limit 1;
  if v_kind is not null then
    return v_kind;
  end if;

  -- 2. Movements inside savings / investment accounts are counted on the current-account side
  if p_account_type in ('savings', 'investment') then
    return 'transfer';
  end if;

  -- 3. Money in
  if p_amount > 0 then
    if v_text ~ '(salary|wages|payroll|pension payment|dividend|hmrc|interest)' then
      return 'income';
    end if;
    if v_text ~ '(refund|reversal|cashback)' then
      return 'spending'; -- a positive "spending" row reduces the amount spent
    end if;
    if p_account_type = 'credit_card' or upper(coalesce(p_provider_category, '')) = 'TRANSFER'
       or v_text ~ '(transfer from|from savings|tfr from)' then
      return 'transfer';
    end if;
    return 'income';
  end if;

  -- 4. Money out: investing beats saving beats bills beats spending
  if v_text ~ '(vanguard|trading ?212|hargreaves|aj bell|freetrade|nutmeg|moneybox invest|etoro|fidelity|wealthify|interactive investor|lightyear|invest|stocks ?(and|&) ?shares|s&s isa|\msipp\M)' then
    return 'investment';
  end if;
  if v_text ~ '(savings|\msaver\M|save the change|round ?up|\mpot\M|\misa\M|premium bonds|ns&i|to savings)' then
    return 'saving';
  end if;
  if v_text ~ '(credit card payment|card repayment|amex|barclaycard|transfer to own|to own account)' then
    return 'transfer';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'DIRECT_DEBIT' then
    return 'direct_debit';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'STANDING_ORDER' then
    return 'standing_order';
  end if;
  -- Card-paid bills the user budgets for (e.g. "Fuel" matching "shell", "bp")
  if exists (
    select 1 from public.bill_budgets b, unnest(b.keywords) k
    where b.user_id = p_user and length(k) >= 2 and v_text like '%' || lower(k) || '%'
  ) then
    return 'bill';
  end if;
  -- Fuel paid by card is a regular bill, not day-to-day spending
  if v_text ~ '(\mshell\M|\mbp\M|\messo\M|texaco|\mgulf\M|murco|jet petrol|petrol|\mpfs\M|unleaded|diesel|\mfuel\M|ev charg|supercharger|pod point|instavolt|gridserve)' then
    return 'bill';
  end if;
  return 'spending';
end;
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

  v_allowance := coalesce(v_profile.monthly_allowance, 0);
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
    'currency', v_profile.currency
  );
end;
$$;

create or replace function public.period_scores(p_months integer default 6)
returns table (
  period_start date,
  period_end date,
  income numeric,
  spending numeric,
  bills numeric,
  saved numeric,
  invested numeric,
  net numeric,
  saved_pct numeric,
  invested_pct numeric,
  points_saved integer,
  points_invested integer,
  points_budget integer,
  points_total integer,
  is_current boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with prof as (
    select p.payday, p.monthly_allowance as allowance, (now() at time zone 'Europe/London')::date as today
    from public.profiles p
    where p.id = auth.uid()
  ),
  cur as (
    select prof.*, pp.period_start as cur_start
    from prof cross join lateral public.pay_period(prof.payday, prof.today) pp
  ),
  periods as (
    select pp.period_start, pp.period_end, cur.allowance, cur.cur_start
    from cur
    cross join generate_series(0, greatest(p_months, 1) - 1) i
    cross join lateral public.pay_period(cur.payday, (cur.cur_start - make_interval(months => i))::date) pp
  ),
  totals as (
    select
      pr.period_start, pr.period_end, pr.allowance, pr.cur_start,
      coalesce(sum(t.amount) filter (where t.kind = 'income'), 0) as income,
      coalesce(sum(-t.amount) filter (where t.kind = 'spending'), 0) as spending,
      coalesce(sum(-t.amount) filter (where t.kind in ('direct_debit', 'standing_order', 'bill')), 0) as bills,
      coalesce(sum(-t.amount) filter (where t.kind = 'saving'), 0) as saved,
      coalesce(sum(-t.amount) filter (where t.kind = 'investment'), 0) as invested
    from periods pr
    left join public.transactions t
      on t.user_id = auth.uid()
     and (t.booked_at at time zone 'Europe/London')::date between pr.period_start and pr.period_end
    group by pr.period_start, pr.period_end, pr.allowance, pr.cur_start
  ),
  scored as (
    select
      tt.*,
      case when tt.income > 0 then round(100 * tt.saved / tt.income, 1) else 0 end as saved_pct,
      case when tt.income > 0 then round(100 * tt.invested / tt.income, 1) else 0 end as invested_pct,
      case when coalesce(tt.allowance, 0) > 0 and tt.income > 0 and tt.spending <= tt.allowance then 100 else 0 end as budget
    from totals tt
  )
  select
    s.period_start, s.period_end, s.income, s.spending, s.bills, s.saved, s.invested,
    s.income - s.spending - s.bills - s.saved - s.invested,
    s.saved_pct, s.invested_pct,
    greatest(round(s.saved_pct * 10), 0)::int,
    greatest(round(s.invested_pct * 20), 0)::int,
    s.budget,
    (greatest(round(s.saved_pct * 10), 0) + greatest(round(s.invested_pct * 20), 0) + s.budget)::int,
    s.period_start = s.cur_start
  from scored s
  order by s.period_start;
$$;

-- Re-sort existing transactions with the new rules (hand-picked categories are left alone)
update public.transactions t
set kind = public.classify_transaction(t.user_id, t.amount, t.description, t.merchant, t.provider_category, a.account_type)
from public.accounts a
where a.id = t.account_id and not t.kind_locked;
