-- MFTracker database schema
-- Safe to re-run: tables use IF NOT EXISTS, policies are dropped and recreated.

create extension if not exists pgcrypto;

-- ============================================================
-- TABLE 1: mf_holdings
-- ============================================================
create table if not exists mf_holdings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  owner text not null check (owner in ('praveen', 'geetha')),
  scheme_code text not null,
  scheme_name text not null,
  category text not null,
  amc text,
  units numeric(18,4) not null default 0,
  avg_nav numeric(18,4) not null default 0,
  invested_amount numeric(18,2) not null default 0,
  as_on_date date not null default current_date,
  created_at timestamptz default now()
);
alter table mf_holdings enable row level security;
drop policy if exists "Users see own holdings" on mf_holdings;
create policy "Users see own holdings" on mf_holdings for all using (auth.uid() = user_id);

-- ============================================================
-- TABLE 2: mf_nav_cache
-- ============================================================
create table if not exists mf_nav_cache (
  scheme_code text primary key,
  scheme_name text,
  nav numeric(18,4),
  nav_date date,
  fetched_at timestamptz default now()
);
-- Cache of each scheme's full NAV history (from mfapi.in), so looking up an
-- older date's NAV doesn't re-download years of data every time. Refreshed
-- on a 24h TTL — see nav_history_fetched_at, checked separately from the
-- latest-NAV fetched_at column above.
alter table mf_nav_cache add column if not exists nav_history jsonb;
alter table mf_nav_cache add column if not exists nav_history_fetched_at timestamptz;
alter table mf_nav_cache enable row level security;
drop policy if exists "Authenticated users read nav" on mf_nav_cache;
create policy "Authenticated users read nav" on mf_nav_cache for select using (auth.role() = 'authenticated');

-- ============================================================
-- TABLE 3: mf_peer_data
-- ============================================================
create table if not exists mf_peer_data (
  scheme_code text primary key,
  category text,
  r6m numeric(8,2),
  r1y numeric(8,2),
  r3y numeric(8,2),
  r5y numeric(8,2),
  expense_ratio numeric(6,3),
  aum_cr numeric(18,2),
  peer_rank_6m integer,
  peer_rank_1y integer,
  peer_rank_3y integer,
  peer_rank_5y integer,
  peer_count integer,
  updated_at timestamptz default now()
);
-- tier: which sync produced this row — 'tier1' (weekly, held categories),
-- 'tier2' (monthly, all categories), or 'tier3' (on-demand, new holding).
alter table mf_peer_data add column if not exists tier text default 'tier1';
alter table mf_peer_data add column if not exists amc text;
alter table mf_peer_data add column if not exists fund_name text;
alter table mf_peer_data enable row level security;
drop policy if exists "Authenticated users read peers" on mf_peer_data;
create policy "Authenticated users read peers" on mf_peer_data for select using (auth.role() = 'authenticated');

-- ============================================================
-- TABLE 3b: mf_category_stats (tier 2 — cross-category AI intelligence)
-- ============================================================
create table if not exists mf_category_stats (
  category text primary key,
  avg_r6m numeric(8,2),
  avg_r1y numeric(8,2),
  avg_r3y numeric(8,2),
  avg_r5y numeric(8,2),
  best_fund_code text,
  best_fund_name text,
  best_fund_r1y numeric(8,2),
  worst_fund_code text,
  worst_fund_name text,
  worst_fund_r1y numeric(8,2),
  benchmark_r1y numeric(8,2),
  category_vs_benchmark numeric(8,2),
  trend text,
  fund_count integer,
  tier text default 'tier2',
  updated_at timestamptz default now()
);
alter table mf_category_stats enable row level security;
drop policy if exists "Auth read category stats" on mf_category_stats;
create policy "Auth read category stats" on mf_category_stats for select using (auth.role() = 'authenticated');

-- ============================================================
-- TABLE 4: mf_fund_holdings
-- ============================================================
create table if not exists mf_fund_holdings (
  id uuid default gen_random_uuid() primary key,
  scheme_code text not null,
  stock_name text not null,
  isin text,
  allocation_pct numeric(6,3),
  market_value_cr numeric(18,2),
  as_of_month date not null,
  created_at timestamptz default now()
);
alter table mf_fund_holdings enable row level security;
drop policy if exists "Authenticated users read fund holdings" on mf_fund_holdings;
create policy "Authenticated users read fund holdings" on mf_fund_holdings for select using (auth.role() = 'authenticated');

-- ============================================================
-- TABLE 5: mf_ai_recommendations
-- ============================================================
create table if not exists mf_ai_recommendations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  owner text not null check (owner in ('praveen', 'geetha')),
  scheme_code text,
  action text not null check (action in ('HOLD', 'SWITCH', 'REBALANCE', 'EXIT')),
  reason text,
  suggested_fund text,
  ltcg_note text,
  generated_at timestamptz default now()
);
alter table mf_ai_recommendations enable row level security;
drop policy if exists "Users see own recommendations" on mf_ai_recommendations;
create policy "Users see own recommendations" on mf_ai_recommendations for all using (auth.uid() = user_id);

-- ============================================================
-- TABLE 6: mf_cas_imports
-- ============================================================
create table if not exists mf_cas_imports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  owner text not null check (owner in ('praveen', 'geetha')),
  filename text,
  imported_at timestamptz default now(),
  status text check (status in ('success', 'partial', 'failed')),
  rows_imported integer default 0
);
alter table mf_cas_imports enable row level security;
drop policy if exists "Users see own imports" on mf_cas_imports;
create policy "Users see own imports" on mf_cas_imports for all using (auth.uid() = user_id);

-- ============================================================
-- TABLE 7: mf_sip_schedules
-- ============================================================
create table if not exists mf_sip_schedules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  owner text not null check (owner in ('praveen', 'geetha')),
  scheme_code text,
  scheme_name text not null,
  category text,
  amount numeric(18,2) not null,
  sip_date integer not null check (sip_date between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly')),
  start_date date not null,
  end_date date,
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table mf_sip_schedules enable row level security;
drop policy if exists "Users see own SIPs" on mf_sip_schedules;
create policy "Users see own SIPs" on mf_sip_schedules for all using (auth.uid() = user_id);

-- ============================================================
-- TABLE 8: mf_sync_log
-- ============================================================
create table if not exists mf_sync_log (
  id uuid default gen_random_uuid() primary key,
  cron_name text not null,
  status text check (status in ('success', 'partial', 'failed')),
  rows_updated integer default 0,
  error_message text,
  run_at timestamptz default now()
);
alter table mf_sync_log enable row level security;
drop policy if exists "Authenticated users read sync log" on mf_sync_log;
create policy "Authenticated users read sync log" on mf_sync_log for select using (auth.role() = 'authenticated');
