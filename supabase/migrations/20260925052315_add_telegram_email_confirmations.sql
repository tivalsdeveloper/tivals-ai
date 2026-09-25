create table if not exists public.telegram_pending_emails (
  id uuid primary key,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  recipient text not null check (char_length(recipient) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'pending' check (status in ('pending', 'sending')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists telegram_pending_emails_owner_idx
  on public.telegram_pending_emails (telegram_user_id, expires_at desc);

alter table public.telegram_pending_emails enable row level security;

revoke all on table public.telegram_pending_emails from anon, authenticated;
grant all on table public.telegram_pending_emails to service_role;

comment on table public.telegram_pending_emails is
  'Short-lived Gmail drafts awaiting an explicit Telegram owner confirmation.';
