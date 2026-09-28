alter table public.telegram_user_settings
  add column if not exists voice_mode text not null default 'voice_messages';

alter table public.telegram_user_settings
  add constraint telegram_user_settings_voice_mode_check
  check (voice_mode in ('off', 'voice_messages', 'always'));
