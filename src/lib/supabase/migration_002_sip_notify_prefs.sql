-- Run once in Supabase SQL Editor

-- notify_email / notify_sms: per-SIP notification preferences
alter table mf_sip_schedules
  add column if not exists notify_email boolean not null default true,
  add column if not exists notify_sms boolean not null default false;
