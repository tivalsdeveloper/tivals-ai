create table if not exists public.telegram_whatsapp_connections (
  telegram_user_id bigint primary key,
  phone_number_id text not null unique,
  waba_id text not null,
  phone_display text not null,
  token_enc text not null,
  app_secret_enc text not null,
  verify_token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.telegram_whatsapp_messages (
  message_id text primary key,
  phone_number_id text not null,
  received_at timestamptz not null default now()
);
create index if not exists telegram_whatsapp_messages_received_at_idx on public.telegram_whatsapp_messages(received_at);
alter table public.telegram_whatsapp_connections enable row level security;
alter table public.telegram_whatsapp_messages enable row level security;
revoke all on public.telegram_whatsapp_connections, public.telegram_whatsapp_messages from anon, authenticated;
grant all on public.telegram_whatsapp_connections, public.telegram_whatsapp_messages to service_role;
