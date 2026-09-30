alter table public.telegram_whatsapp_messages
  add column if not exists customer_number text,
  add column if not exists incoming_text text,
  add column if not exists reply_text text;
create index if not exists telegram_whatsapp_conversation_idx on public.telegram_whatsapp_messages(phone_number_id,customer_number,received_at desc) where reply_text is not null;
