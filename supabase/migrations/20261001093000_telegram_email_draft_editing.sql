-- An email cannot be sent while its owner is editing the suggested draft.
alter table public.telegram_pending_emails
  drop constraint if exists telegram_pending_emails_status_check;
alter table public.telegram_pending_emails
  add constraint telegram_pending_emails_status_check
  check (status in ('pending', 'editing', 'sending'));
