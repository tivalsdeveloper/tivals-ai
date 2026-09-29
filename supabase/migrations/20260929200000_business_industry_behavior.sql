alter table public.telegram_business_profiles
  add column if not exists industry text not null default 'other',
  add column if not exists behavior text not null default 'friendly';
