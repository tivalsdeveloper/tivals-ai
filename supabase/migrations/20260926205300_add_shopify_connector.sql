-- Shopify store access stays in the encrypted Telegram OAuth connection table.
alter table public.telegram_oauth_connections
  drop constraint if exists telegram_oauth_connections_provider_check;
alter table public.telegram_oauth_connections
  add constraint telegram_oauth_connections_provider_check
  check (provider in ('gmail','github','tiktok','shopify'));
alter table public.telegram_oauth_states
  drop constraint if exists telegram_oauth_states_provider_check;
alter table public.telegram_oauth_states
  add constraint telegram_oauth_states_provider_check
  check (provider in ('gmail','github','tiktok','github_user','shopify'));
alter table public.telegram_oauth_states
  add column if not exists shop_domain text;
