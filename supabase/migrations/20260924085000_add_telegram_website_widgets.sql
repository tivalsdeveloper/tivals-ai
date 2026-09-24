-- Telegram dashboard website-widget connector.
create table if not exists public.telegram_website_widgets (
  telegram_user_id bigint primary key,
  public_key uuid not null default gen_random_uuid() unique,
  allowed_domains text[] not null default '{}'::text[],
  welcome_message text not null default 'Hi! How can I help?',
  position text not null default 'right' check (position in ('left','right')),
  is_active boolean not null default true,
  request_count bigint not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_website_widgets_public_key_idx on public.telegram_website_widgets (public_key);
alter table public.telegram_website_widgets enable row level security;
revoke all on table public.telegram_website_widgets from anon,authenticated,public;
grant all on table public.telegram_website_widgets to service_role;
