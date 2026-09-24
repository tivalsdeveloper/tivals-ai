-- Expand Telegram business knowledge for catalog, staff, FAQs and booking settings.
alter table public.telegram_business_profiles
  add column if not exists email text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists address text not null default '',
  add column if not exists website_url text not null default '',
  add column if not exists payment_options text not null default '',
  add column if not exists business_hours jsonb not null default '{}'::jsonb,
  add column if not exists booking_reminders boolean not null default false,
  add column if not exists booking_confirmations boolean not null default false,
  add column if not exists booking_instructions text not null default '';

create table if not exists public.telegram_business_catalog (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  item_type text not null check (item_type in ('product','service')),
  name text not null check (char_length(name) between 1 and 160),
  price text not null default '',
  currency text not null default 'ZAR' check (char_length(currency) between 3 and 8),
  details text not null default '',
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_business_specialists (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null default '',
  about text not null default '',
  services text[] not null default '{}'::text[],
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_business_faqs (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) between 1 and 4000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_business_catalog_owner_idx on public.telegram_business_catalog (telegram_user_id,sort_order,created_at);
create index if not exists telegram_business_specialists_owner_idx on public.telegram_business_specialists (telegram_user_id,sort_order,created_at);
create index if not exists telegram_business_faqs_owner_idx on public.telegram_business_faqs (telegram_user_id,sort_order,created_at);

alter table public.telegram_business_profiles enable row level security;
alter table public.telegram_business_catalog enable row level security;
alter table public.telegram_business_specialists enable row level security;
alter table public.telegram_business_faqs enable row level security;

revoke all on table public.telegram_business_profiles from anon,authenticated,public;
revoke all on table public.telegram_business_catalog from anon,authenticated,public;
revoke all on table public.telegram_business_specialists from anon,authenticated,public;
revoke all on table public.telegram_business_faqs from anon,authenticated,public;

grant all on table public.telegram_business_profiles to service_role;
grant all on table public.telegram_business_catalog to service_role;
grant all on table public.telegram_business_specialists to service_role;
grant all on table public.telegram_business_faqs to service_role;
