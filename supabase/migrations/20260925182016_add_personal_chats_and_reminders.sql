create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.telegram_owned_bots
  add column if not exists timezone text not null default 'Africa/Johannesburg';

create table if not exists public.telegram_personal_chats (
  id uuid primary key default gen_random_uuid(),
  bot_owner_id bigint not null,
  chat_id bigint not null,
  participant_id bigint not null,
  title text not null default 'New chat' check (char_length(title) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telegram_personal_chats_one_active
  on public.telegram_personal_chats (bot_owner_id, chat_id, participant_id)
  where is_active;
create index if not exists telegram_personal_chats_recent
  on public.telegram_personal_chats (bot_owner_id, chat_id, participant_id, updated_at desc);

create table if not exists public.telegram_personal_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.telegram_personal_chats(id) on delete cascade,
  bot_owner_id bigint not null,
  chat_id bigint not null,
  participant_id bigint not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  created_at timestamptz not null default now()
);

create index if not exists telegram_personal_messages_history
  on public.telegram_personal_messages (conversation_id, created_at desc);

create table if not exists public.telegram_personal_reminders (
  id uuid primary key default gen_random_uuid(),
  bot_owner_id bigint not null,
  creator_id bigint not null,
  chat_id bigint not null,
  message text not null check (char_length(message) between 1 and 1000),
  remind_at timestamptz not null,
  timezone text not null default 'Africa/Johannesburg' check (char_length(timezone) between 1 and 80),
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists telegram_personal_reminders_due
  on public.telegram_personal_reminders (remind_at)
  where status = 'pending';
create index if not exists telegram_personal_reminders_owner
  on public.telegram_personal_reminders (bot_owner_id, creator_id, chat_id, created_at desc);

alter table public.telegram_personal_chats enable row level security;
alter table public.telegram_personal_messages enable row level security;
alter table public.telegram_personal_reminders enable row level security;

revoke all on public.telegram_personal_chats from anon, authenticated;
revoke all on public.telegram_personal_messages from anon, authenticated;
revoke all on public.telegram_personal_reminders from anon, authenticated;
revoke all on sequence public.telegram_personal_messages_id_seq from anon, authenticated;

comment on table public.telegram_personal_chats is 'Private per-participant conversation sessions for user-owned Telegram bots. Service role only.';
comment on table public.telegram_personal_messages is 'Private conversation history for user-owned Telegram bots. Service role only.';
comment on table public.telegram_personal_reminders is 'Scheduled reminders created in user-owned Telegram bots. Service role only.';
