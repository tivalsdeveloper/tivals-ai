-- Keep a short-lived owner choice while Telegram creates a managed bot.
alter table public.telegram_user_settings
  add column if not exists pending_bot_kind text
    check (pending_bot_kind in ('personal', 'business')),
  add column if not exists pending_bot_expires_at timestamptz;
