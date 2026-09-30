alter table public.telegram_business_profiles
  add column if not exists languages text not null default '',
  add column if not exists staff_contact text not null default '';
