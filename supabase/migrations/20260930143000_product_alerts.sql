create table if not exists public.telegram_product_alert_subscribers (
  telegram_user_id bigint not null,
  channel text not null check (channel in ('telegram','whatsapp')),
  recipient text not null,
  active boolean not null default true,
  opted_in_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  primary key (telegram_user_id,channel,recipient)
);
create table if not exists public.telegram_product_alerts_sent (
  telegram_user_id bigint not null,
  product_id text not null,
  sent_at timestamptz not null default now(),
  primary key (telegram_user_id,product_id)
);
create table if not exists public.telegram_shopify_webhook_subscriptions (
  telegram_user_id bigint primary key,
  shop_domain text not null,
  create_webhook_id text not null,
  update_webhook_id text not null,
  updated_at timestamptz not null default now()
);
alter table public.telegram_product_alert_subscribers enable row level security;
alter table public.telegram_product_alerts_sent enable row level security;
alter table public.telegram_shopify_webhook_subscriptions enable row level security;
revoke all on public.telegram_product_alert_subscribers, public.telegram_product_alerts_sent, public.telegram_shopify_webhook_subscriptions from anon,authenticated,public;
grant all on public.telegram_product_alert_subscribers, public.telegram_product_alerts_sent, public.telegram_shopify_webhook_subscriptions to service_role;
