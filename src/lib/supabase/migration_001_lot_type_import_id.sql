-- Run once in Supabase SQL Editor

-- lot_type: SIP vs lumpsum per lot
alter table mf_holdings
  add column if not exists lot_type text not null default 'lumpsum'
    check (lot_type in ('sip', 'lumpsum'));

-- import_id: links holdings back to the import batch
alter table mf_holdings
  add column if not exists import_id uuid references mf_cas_imports(id) on delete set null;

create index if not exists idx_mf_holdings_import_id on mf_holdings(import_id);

-- mf_api_category: raw scheme_category from mfapi.in meta (e.g. "Equity Schemes - Focused Fund")
-- peer_group: derived peer comparison bucket (e.g. "Focused Fund", "Sectoral - MNC")
alter table mf_holdings
  add column if not exists mf_api_category text,
  add column if not exists peer_group text;

alter table mf_peer_data
  add column if not exists mf_api_category text,
  add column if not exists peer_group text;

create index if not exists idx_mf_holdings_peer_group on mf_holdings(peer_group);
create index if not exists idx_mf_peer_data_peer_group on mf_peer_data(peer_group);
