-- Run once in Supabase SQL Editor

-- Allow 'weekly' as a valid mf_sip_schedules.frequency value, alongside the
-- existing 'monthly' and 'quarterly'.
alter table mf_sip_schedules
  drop constraint if exists mf_sip_schedules_frequency_check;

alter table mf_sip_schedules
  add constraint mf_sip_schedules_frequency_check
  check (frequency in ('weekly', 'monthly', 'quarterly'));
