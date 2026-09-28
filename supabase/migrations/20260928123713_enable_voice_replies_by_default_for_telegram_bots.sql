alter table public.telegram_owned_bots alter column voice_mode set default 'always';
alter table public.telegram_user_settings alter column voice_mode set default 'always';
update public.telegram_owned_bots set voice_mode = 'always' where voice_mode = 'voice_messages';
update public.telegram_user_settings set voice_mode = 'always' where voice_mode = 'voice_messages';
