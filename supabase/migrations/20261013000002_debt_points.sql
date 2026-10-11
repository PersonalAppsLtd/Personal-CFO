-- Points: 5 points for every 1% of pay put towards debt, alongside saving (10) and investing (20).
-- The result gains columns, so the function is recreated rather than replaced.
drop function if exists public.period_scores(integer);
create function public.period_scores(p_months integer default 6)
returns table (
  period_start date, period_end date, income numeric, spending numeric, bills numeric, saved numeric, invested numeric,
  debt numeric, net numeric, saved_pct numeric, invested_pct numeric, debt_pct numeric,
  points_saved integer, points_invested integer, points_debt integer, points_budget integer, points_total integer, is_current boolean
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
      case when tt.income > 0 then round(100 * tt.debt / tt.income, 1) else 0 end as debt_pct,
      case when coalesce(tt.allowance, 0) > 0 and tt.income > 0 and tt.spending <= tt.allowance then 100 else 0 end as budget
    from totals tt
  ),
  pointed as (
    select
      s.*,
      greatest(round(s.saved_pct * 10), 0)::int as p_saved,
      greatest(round(s.invested_pct * 20), 0)::int as p_invested,
      greatest(round(s.debt_pct * 5), 0)::int as p_debt
    from scored s
  )
  select
    p.period_start, p.period_end, p.income, p.spending, p.bills, p.saved, p.invested, p.debt,
    p.income - p.spending - p.bills - p.saved - p.invested - p.debt,
    p.saved_pct, p.invested_pct, p.debt_pct,
    p.p_saved, p.p_invested, p.p_debt, p.budget,
    p.p_saved + p.p_invested + p.p_debt + p.budget,
    p.period_start = p.cur_start
  from pointed p
  order by p.period_start;
$$;
revoke execute on function public.period_scores(integer) from public, anon;
grant execute on function public.period_scores(integer) to authenticated;
