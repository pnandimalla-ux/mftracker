-- Run once in Supabase SQL Editor

-- mf_holdings.import_id was added (migration_001) as ON DELETE SET NULL,
-- which orphans lots instead of removing them when their import is deleted.
-- Switch it to ON DELETE CASCADE so deleting an mf_cas_imports row
-- automatically removes every mf_holdings row it created.
-- Rows with import_id = NULL (manually added lots) are unaffected and are
-- never auto-deleted.
alter table mf_holdings drop constraint if exists mf_holdings_import_id_fkey;
alter table mf_holdings
  add constraint mf_holdings_import_id_fkey
  foreign key (import_id) references mf_cas_imports(id) on delete cascade;
