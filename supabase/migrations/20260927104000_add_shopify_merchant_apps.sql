-- Merchant-specific Shopify app credentials are encrypted by telegram-oauth.
create table if not exists public.telegram_shopify_app_credentials (
  telegram_user_id bigint primary key,
  shop_domain text not null,
  client_id text not null,
  client_secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_shopify_app_shop_domain_check check (shop_domain ~ '^[a-z0-9][a-z0-9-]{1,62}\.myshopify\.com$')
);
alter table public.telegram_shopify_app_credentials enable row level security;
revoke all on public.telegram_shopify_app_credentials from anon, authenticated;
