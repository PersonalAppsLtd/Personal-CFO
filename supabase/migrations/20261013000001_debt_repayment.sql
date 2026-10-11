-- Paying off debt (credit cards, loans, buy now pay later) earns leaderboard XP, like saving and investing.

alter table public.transactions drop constraint transactions_kind_check,
  add constraint transactions_kind_check check (kind in ('income', 'spending', 'direct_debit', 'standing_order', 'bill', 'saving', 'investment', 'debt_repayment', 'transfer'));
alter table public.category_rules drop constraint category_rules_kind_check,
  add constraint category_rules_kind_check check (kind in ('income', 'spending', 'direct_debit', 'standing_order', 'bill', 'saving', 'investment', 'debt_repayment', 'transfer'));

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

  -- 4. Money out: investing beats saving beats debt beats bills beats spending
  if v_text ~ '(vanguard|trading ?212|hargreaves|aj bell|freetrade|nutmeg|moneybox invest|etoro|fidelity|wealthify|interactive investor|lightyear|invest|stocks ?(and|&) ?shares|s&s isa|\msipp\M)' then
    return 'investment';
  end if;
  if v_text ~ '(savings|\msaver\M|save the change|round ?up|\mpot\M|\misa\M|premium bonds|ns&i|to savings)' then
    return 'saving';
  end if;
  -- Paying off a credit card is paying off debt; the matching money in on the card itself is a transfer
  if v_text ~ '(credit card payment|card repayment|amex|american express|barclaycard|\mmbna\M|vanquis|capital one|aqua card)' then
    return 'debt_repayment';
  end if;
  if v_text ~ '(transfer to own|to own account)' then
    return 'transfer';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'DIRECT_DEBIT' then
    return 'direct_debit';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'STANDING_ORDER' then
    return 'standing_order';
  end if;
  -- Loans and buy now pay later paid by card or transfer (regular loan direct debits stay bills above)
  if v_text ~ '(\mloan\M|overpayment|klarna|clearpay|laybuy|pay ?in ?3|\mzopa\M|novuna)' then
    return 'debt_repayment';
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

-- Weekly XP also counts 10 XP per 1% of monthly income used to pay off debt.
-- The result gains a column, so the functions are recreated rather than replaced.
drop function public.my_weekly_xp();
drop function public.user_weekly_xp(uuid, timestamptz, timestamptz);

create function public.user_weekly_xp(p_user uuid, p_week timestamptz, p_now timestamptz)
returns table (saving_xp integer, investing_xp integer, debt_xp integer, budget_xp integer, budget_days integer, total integer)
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
           coalesce(sum(-t.amount) filter (where t.kind = 'investment'), 0) as invested,
           coalesce(sum(-t.amount) filter (where t.kind = 'debt_repayment'), 0) as repaid
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
      case when basis.income > 0 then greatest(round(1000 * week.repaid / basis.income), 0) else 0 end::int as d_xp,
      (select count(*) from day_check, prof where prof.allowance > 0 and day_check.spent <= day_check.daily_allowance)::int as b_days
    from basis, week
  )
  select s_xp, i_xp, d_xp, b_days * 15, b_days, s_xp + i_xp + d_xp + b_days * 15 from scored;
$$;
revoke execute on function public.user_weekly_xp(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function public.my_weekly_xp()
returns table (saving_xp integer, investing_xp integer, debt_xp integer, budget_xp integer, budget_days integer, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.user_weekly_xp(auth.uid(), public.week_start(), now());
$$;
revoke execute on function public.my_weekly_xp() from public, anon;
grant execute on function public.my_weekly_xp() to authenticated;

-- Cash flow shows debt repayments as their own band. The result gains a column, so it is recreated.
drop function public.period_scores(integer);
create function public.period_scores(p_months integer default 6)
returns table (
  period_start date, period_end date, income numeric, spending numeric, bills numeric, saved numeric, invested numeric,
  debt numeric, net numeric, saved_pct numeric, invested_pct numeric,
  points_saved integer, points_invested integer, points_budget integer, points_total integer, is_current boolean
)
language sql
stable
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
      coalesce(sum(-t.amount) filter (where t.kind = 'investment'), 0) as invested,
      coalesce(sum(-t.amount) filter (where t.kind = 'debt_repayment'), 0) as debt
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
    s.period_start, s.period_end, s.income, s.spending, s.bills, s.saved, s.invested, s.debt,
    s.income - s.spending - s.bills - s.saved - s.invested - s.debt,
    s.saved_pct, s.invested_pct,
    greatest(round(s.saved_pct * 10), 0)::int,
    greatest(round(s.invested_pct * 20), 0)::int,
    s.budget,
    (greatest(round(s.saved_pct * 10), 0) + greatest(round(s.invested_pct * 20), 0) + s.budget)::int,
    s.period_start = s.cur_start
  from scored s
  order by s.period_start;
$$;
revoke execute on function public.period_scores(integer) from public, anon;
grant execute on function public.period_scores(integer) to authenticated;

-- Re-sort existing transactions with the new rules (hand-picked categories are left alone)
update public.transactions t
set kind = public.classify_transaction(t.user_id, t.amount, t.description, t.merchant, t.provider_category, a.account_type)
from public.accounts a
where a.id = t.account_id and not t.kind_locked;
