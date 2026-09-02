-- Run once in Supabase SQL Editor

-- settlement_id: Zerodha Coin's per-transaction settlement identifier,
-- carried through from the CSV import. Used as the primary key for
-- detecting already-imported lots when re-importing with "add_lots".
alter table mf_holdings
  add column if not exists settlement_id text;

create index if not exists idx_mf_holdings_settlement_id
  on mf_holdings(user_id, owner, scheme_code, settlement_id);
