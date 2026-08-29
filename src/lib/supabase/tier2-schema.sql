-- Tier 2 schema additions — run manually in the Supabase SQL Editor.
--
-- The app also tries to apply these automatically at runtime (see
-- ensurePeerDataSchema() in src/lib/peers/peerSync.ts, using the same
-- exec_sql RPC helper as the mf_nav_cache.nav_history migration), so this
-- file is a documented fallback/manual path, not the only way it happens.
--
-- Note: Postgres has no `CREATE POLICY IF NOT EXISTS` — policies are made
-- idempotent here the same way the rest of schema.sql does it, with
-- `drop policy if exists` before `create policy`.
--
-- Service-role writes (all the tier1/tier2/tier3 upserts) go through
-- createServiceClient(), which bypasses RLS entirely — so no separate
-- "service role can write" policy is needed here for the app to work.

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

alter table mf_peer_data add column if not exists tier text default 'tier1';
alter table mf_peer_data add column if not exists amc text;
alter table mf_peer_data add column if not exists fund_name text;
