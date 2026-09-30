-- Unique callback IDs prevent a Telegram retry from executing a button twice.
create table if not exists public.telegram_button_presses (
  business_id bigint not null,
  callback_id text not null,
  customer_id bigint not null,
  action text not null check (length(action) <= 64),
  pressed_at timestamptz not null default now(),
  primary key (business_id, callback_id)
);
create index if not exists telegram_button_presses_customer_idx
  on public.telegram_button_presses (business_id, customer_id, pressed_at desc);
alter table public.telegram_button_presses enable row level security;
revoke all on public.telegram_button_presses from anon, authenticated;
