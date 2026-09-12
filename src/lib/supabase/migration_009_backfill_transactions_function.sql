-- Run once in Supabase SQL Editor

-- mf_transactions (migration_008) was added after existing imports already
-- populated mf_holdings and mf_sell_transactions, so it started out empty —
-- this backfills it from both, safe to re-run (WHERE NOT EXISTS on each
-- side means already-backfilled rows are never duplicated). Defined as a
-- real function (not a one-shot exec_sql text blob) because it needs to
-- hand back row counts to the confirm UI, which a `returns void` exec_sql
-- call can't do.
create or replace function backfill_mf_transactions()
returns table(buy_inserted bigint, sell_inserted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buy_inserted bigint;
  v_sell_inserted bigint;
begin
  with ins as (
    insert into mf_transactions (
      user_id, import_id, owner, scheme_code, scheme_name, category,
      transaction_type, lot_type, amount, units, nav, trade_date, settlement_id
    )
    select
      h.user_id, h.import_id, h.owner, h.scheme_code, h.scheme_name, h.category,
      'BUY', h.lot_type, h.invested_amount, h.units, h.avg_nav, h.as_on_date::date, h.settlement_id
    from mf_holdings h
    where not exists (
      select 1 from mf_transactions t
      where t.user_id = h.user_id and t.owner = h.owner
        and t.trade_date = h.as_on_date::date and t.amount = h.invested_amount
        and t.scheme_code = h.scheme_code and t.transaction_type = 'BUY'
    )
    returning 1
  )
  select count(*) into v_buy_inserted from ins;

  with ins2 as (
    insert into mf_transactions (
      user_id, import_id, owner, scheme_code, scheme_name, category,
      transaction_type, lot_type, amount, units, nav, trade_date, settlement_id
    )
    select
      s.user_id, s.import_id, s.owner, s.scheme_code, s.scheme_name, null,
      'SELL', null, s.amount, s.units,
      case when s.units > 0 then s.amount / s.units else null end,
      s.trade_date, s.settlement_id
    from mf_sell_transactions s
    where not exists (
      select 1 from mf_transactions t
      where t.user_id = s.user_id and t.owner = s.owner
        and t.trade_date = s.trade_date and t.amount = s.amount
        and t.scheme_code = s.scheme_code and t.transaction_type = 'SELL'
    )
    returning 1
  )
  select count(*) into v_sell_inserted from ins2;

  return query select v_buy_inserted, v_sell_inserted;
end;
$$;
