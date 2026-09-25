alter table public.telegram_owned_bots
  add column if not exists bot_name text not null default 'My AI',
  add column if not exists bot_purpose text not null default 'general',
  add column if not exists personality text not null default 'Friendly, natural and helpful',
  add column if not exists custom_instructions text not null default '',
  add column if not exists subjects text[] not null default '{}'::text[],
  add column if not exists education_level text not null default 'all',
  add column if not exists teaching_style text not null default 'adaptive',
  add column if not exists language text not null default 'auto',
  add column if not exists welcome_message text not null default 'Hi! How can I help you today?',
  add column if not exists voice_mode text not null default 'voice_messages',
  add column if not exists group_mode text not null default 'mentions',
  add column if not exists channel_mode text not null default 'commands',
  add column if not exists owner_only_invites boolean not null default true;

alter table public.telegram_owned_bots
  add constraint telegram_owned_bots_purpose_check check (bot_purpose in ('general','education','coding','math','custom')),
  add constraint telegram_owned_bots_level_check check (education_level in ('primary','secondary','college','professional','all')),
  add constraint telegram_owned_bots_teaching_style_check check (teaching_style in ('adaptive','step_by_step','socratic','concise','detailed')),
  add constraint telegram_owned_bots_voice_mode_check check (voice_mode in ('off','voice_messages','always')),
  add constraint telegram_owned_bots_group_mode_check check (group_mode in ('off','mentions','all')),
  add constraint telegram_owned_bots_channel_mode_check check (channel_mode in ('off','commands','all')),
  add constraint telegram_owned_bots_bot_name_length check (char_length(btrim(bot_name)) between 1 and 64),
  add constraint telegram_owned_bots_personality_length check (char_length(personality) <= 1000),
  add constraint telegram_owned_bots_instructions_length check (char_length(custom_instructions) <= 8000),
  add constraint telegram_owned_bots_welcome_length check (char_length(welcome_message) <= 500);

revoke all privileges on table public.telegram_owned_bots from anon, authenticated;
grant all privileges on table public.telegram_owned_bots to service_role;
