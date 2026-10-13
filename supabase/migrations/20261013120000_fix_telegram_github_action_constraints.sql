-- Repair Telegram GitHub pending-action constraints.
-- /challenge create uses create_challenge, which was not allowed by the
-- original constraint. Keep the allowed values explicit and bounded.
alter table public.telegram_pending_github_actions
  drop constraint if exists telegram_pending_github_actions_action_check;

alter table public.telegram_pending_github_actions
  add constraint telegram_pending_github_actions_action_check
  check (action in (
    'create_issue',
    'upsert_file',
    'create_repository',
    'create_challenge',
    'select_repository'
  ));

alter table public.telegram_pending_github_actions
  drop constraint if exists telegram_pending_github_actions_repository_check;

alter table public.telegram_pending_github_actions
  add constraint telegram_pending_github_actions_repository_check
  check (char_length(repository) between 0 and 200);
