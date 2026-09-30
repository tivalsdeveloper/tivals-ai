create table if not exists public.telegram_business_rate_limits (
  business_id bigint not null,
  customer_id bigint not null,
  window_start timestamptz not null default now(),
  request_count integer not null default 1,
  primary key (business_id,customer_id)
);
alter table public.telegram_business_rate_limits enable row level security;
revoke all on public.telegram_business_rate_limits from anon, authenticated;
create or replace function public.telegram_business_allow_message(p_business_id bigint,p_customer_id bigint)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
  insert into public.telegram_business_rate_limits(business_id,customer_id) values (p_business_id,p_customer_id)
  on conflict (business_id,customer_id) do update
    set window_start=case when telegram_business_rate_limits.window_start<now()-interval '1 minute' then now() else telegram_business_rate_limits.window_start end,
        request_count=case when telegram_business_rate_limits.window_start<now()-interval '1 minute' then 1 else telegram_business_rate_limits.request_count+1 end
  returning request_count into v_count;
  return v_count<=12;
end; $$;
revoke all on function public.telegram_business_allow_message(bigint,bigint) from public, anon, authenticated;
grant execute on function public.telegram_business_allow_message(bigint,bigint) to service_role;
