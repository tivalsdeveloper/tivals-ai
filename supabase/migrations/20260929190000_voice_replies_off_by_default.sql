alter table public.telegram_owned_bots alter column voice_mode set default 'off';
alter table public.telegram_user_settings alter column voice_mode set default 'off';
update public.telegram_owned_bots set voice_mode = 'off' where voice_mode = 'always';
update public.telegram_user_settings set voice_mode = 'off' where voice_mode = 'always';
