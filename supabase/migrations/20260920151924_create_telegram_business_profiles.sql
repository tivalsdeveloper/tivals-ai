create table if not exists public.telegram_business_profiles (
  telegram_user_id bigint primary key,
  business_name text not null default '',
  assistant_name text not null default 'Tivals AI',
  business_details text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_business_profiles_business_name_length
    check (char_length(btrim(business_name)) between 1 and 120),
  constraint telegram_business_profiles_assistant_name_length
    check (char_length(btrim(assistant_name)) between 1 and 80),
  constraint telegram_business_profiles_details_length
    check (char_length(business_details) <= 8000)
);

alter table public.telegram_business_profiles enable row level security;
revoke all on table public.telegram_business_profiles from anon, authenticated;