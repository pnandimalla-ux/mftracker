-- Run once in Supabase SQL Editor

-- SELL rows from Coin CSV imports were previously discarded after being used
-- to net/reduce BUY lots (mf_holdings never stores a SELL row). That means
-- there was nowhere for a calendar or transaction history view to read a
-- SELL event back from. This table records every parsed SELL row (whether it
-- was netted against a same-CSV BUY or applied against pre-existing
-- mf_holdings) purely for display/history — nothing else reads it.
create table if not exists mf_sell_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  owner text not null check (owner in ('praveen', 'geetha')),
  scheme_code text,
  scheme_name text not null,
  units numeric(18,4) not null default 0,
  amount numeric(18,2) not null default 0,
  trade_date date not null,
  settlement_id text,
  import_id uuid references mf_cas_imports(id) on delete cascade,
  created_at timestamptz default now()
);

alter table mf_sell_transactions enable row level security;
drop policy if exists "Users see own sell transactions" on mf_sell_transactions;
create policy "Users see own sell transactions" on mf_sell_transactions for all using (auth.uid() = user_id);

create index if not exists idx_mf_sell_transactions_dedup
  on mf_sell_transactions(user_id, owner, scheme_code, settlement_id);
create index if not exists idx_mf_sell_transactions_date
  on mf_sell_transactions(user_id, trade_date);
