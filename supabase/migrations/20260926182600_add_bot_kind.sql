-- Distinguish bots connected in the business Mini App from personal bots
-- created through Telegram's managed bot flow.
alter table public.telegram_owned_bots
  add column if not exists bot_kind text not null default 'personal'
  check (bot_kind in ('personal', 'business'));

-- Existing Tivalsdeveloper1Bot was connected through the Mini App.
update public.telegram_owned_bots
set bot_kind = 'business'
where lower(username) = lower('Tivalsdeveloper1Bot');
