alter table public.telegram_pending_github_actions
  drop constraint if exists telegram_pending_github_actions_action_check;

alter table public.telegram_pending_github_actions
  add constraint telegram_pending_github_actions_action_check
  check (action in ('create_issue', 'upsert_file', 'create_repository'));

alter table public.telegram_pending_github_actions
  drop constraint if exists telegram_pending_github_actions_repository_check;

alter table public.telegram_pending_github_actions
  add constraint telegram_pending_github_actions_repository_check
  check (char_length(repository) between 0 and 200);
