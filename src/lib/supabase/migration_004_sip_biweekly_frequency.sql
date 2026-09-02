-- Run once in Supabase SQL Editor

-- Allow 'bi-weekly' as a valid mf_sip_schedules.frequency value, alongside
-- the existing 'weekly', 'monthly', and 'quarterly'.
alter table mf_sip_schedules
  drop constraint if exists mf_sip_schedules_frequency_check;

alter table mf_sip_schedules
  add constraint mf_sip_schedules_frequency_check
  check (frequency in ('weekly', 'bi-weekly', 'monthly', 'quarterly'));
