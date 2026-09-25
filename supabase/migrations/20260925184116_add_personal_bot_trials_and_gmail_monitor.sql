alter table public.telegram_oauth_connections
  add column if not exists last_refreshed_at timestamptz,
  add column if not exists persistent_until timestamptz,
  add column if not exists refresh_failures smallint not null default 0,
  add column if not exists needs_reconnect boolean not null default false;

update public.telegram_oauth_connections
set persistent_until = greatest(coalesce(persistent_until, now()), now() + interval '30 days')
where provider = 'gmail' and refresh_token_enc is not null;

alter table public.telegram_pending_emails
  add column if not exists gmail_thread_id text,
  add column if not exists in_reply_to text,
  add column if not exists email_references text,
  add column if not exists source_message_id text;

create table if not exists public.telegram_personal_bot_trials (
  telegram_user_id bigint primary key,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > started_at)
);

insert into public.telegram_personal_bot_trials (telegram_user_id)
select telegram_user_id from public.telegram_owned_bots
on conflict (telegram_user_id) do nothing;

create table if not exists public.telegram_gmail_monitor_settings (
  telegram_user_id bigint primary key,
  enabled boolean not null default false,
  notify_chat_id bigint,
  interval_minutes smallint not null default 60 check (interval_minutes between 60 and 1440),
  auto_draft_replies boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_gmail_monitor_events (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  sender text not null,
  sender_email text,
  subject text not null default '(No subject)',
  snippet text not null default '',
  internet_message_id text,
  email_references text,
  internal_date timestamptz,
  status text not null default 'detected' check (status in ('detected','notified','drafted','ignored','replied','failed')),
  pending_email_id uuid references public.telegram_pending_emails(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, gmail_message_id)
);

create index if not exists telegram_gmail_monitor_events_owner_recent
  on public.telegram_gmail_monitor_events (telegram_user_id, created_at desc);

alter table public.telegram_personal_bot_trials enable row level security;
alter table public.telegram_gmail_monitor_settings enable row level security;
alter table public.telegram_gmail_monitor_events enable row level security;

revoke all on public.telegram_personal_bot_trials from anon, authenticated;
revoke all on public.telegram_gmail_monitor_settings from anon, authenticated;
revoke all on public.telegram_gmail_monitor_events from anon, authenticated;
grant all on public.telegram_personal_bot_trials to service_role;
grant all on public.telegram_gmail_monitor_settings to service_role;
grant all on public.telegram_gmail_monitor_events to service_role;

comment on table public.telegram_personal_bot_trials is 'Seven-day personal bot trials. Service role only.';
comment on table public.telegram_gmail_monitor_settings is 'Owner-controlled hourly Gmail monitoring preferences. Service role only.';
comment on table public.telegram_gmail_monitor_events is 'Deduplicated Gmail notifications and confirmed AI reply state. Service role only.';
