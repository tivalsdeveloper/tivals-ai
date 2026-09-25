create table if not exists public.telegram_pending_github_actions (
  id uuid primary key,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  action text not null check (action in ('create_issue')),
  repository text not null check (char_length(repository) between 3 and 200),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'running')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists telegram_pending_github_actions_owner_idx
  on public.telegram_pending_github_actions (telegram_user_id, expires_at desc);

alter table public.telegram_pending_github_actions enable row level security;

revoke all on table public.telegram_pending_github_actions from anon, authenticated;
grant all on table public.telegram_pending_github_actions to service_role;

comment on table public.telegram_pending_github_actions is
  'Short-lived GitHub write actions awaiting explicit Telegram owner confirmation.';
