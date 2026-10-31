-- Run once in Supabase SQL Editor

-- Zerodha Coin exports orders that haven't settled yet as status PROCESSING
-- with units = 0 / nav = 0. They can't go into mf_holdings (zero units would
-- show as a full loss), so they're kept here until a later import shows the
-- same order as COMPLETE (or FAILED / CANCELLED), at which point the confirm
-- route deletes the pending row. Deleting the import that created a row
-- removes it too (import_id cascade).
create table if not exists mf_pending_orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  import_id uuid references mf_cas_imports(id) on delete cascade,
  owner text not null check (owner in ('praveen', 'geetha')),
  isin text,
  scheme_code text,
  scheme_name text not null,
  category text,
  lot_type text not null check (lot_type in ('sip', 'lumpsum')),
  amount numeric(18,2) not null,
  trade_date date not null,
  ordered_at text,
  remarks text,
  created_at timestamptz default now(),
  unique (user_id, owner, isin, trade_date, amount, lot_type)
);

alter table mf_pending_orders enable row level security;
drop policy if exists "Users see own pending orders" on mf_pending_orders;
create policy "Users see own pending orders" on mf_pending_orders for all using (auth.uid() = user_id);

create index if not exists idx_mf_pending_orders_match
  on mf_pending_orders(user_id, owner, scheme_code, trade_date);
