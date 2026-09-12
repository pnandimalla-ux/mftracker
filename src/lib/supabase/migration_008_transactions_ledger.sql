-- Run once in Supabase SQL Editor

-- Full immutable ledger — one row per transaction event (BUY or SELL),
-- populated by the Coin CSV confirm route alongside mf_holdings /
-- mf_sell_transactions. Powers the Reports page; nothing else reads it, so
-- it's safe to backfill or rebuild without touching portfolio math.
create table if not exists mf_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  import_id uuid references mf_cas_imports(id) on delete cascade,
  owner text not null check (owner in ('praveen', 'geetha')),
  scheme_code text,
  scheme_name text not null,
  category text,
  transaction_type text not null check (transaction_type in ('BUY', 'SELL')),
  lot_type text check (lot_type in ('sip', 'lumpsum')),
  amount numeric not null,
  units numeric,
  nav numeric,
  trade_date date not null,
  settlement_id text,
  created_at timestamptz default now()
);

alter table mf_transactions enable row level security;
drop policy if exists "Users see own transactions" on mf_transactions;
create policy "Users see own transactions" on mf_transactions for all using (auth.uid() = user_id);

create index if not exists idx_mf_transactions_dedup
  on mf_transactions(user_id, owner, scheme_code, settlement_id);
create index if not exists idx_mf_transactions_date
  on mf_transactions(user_id, trade_date);
