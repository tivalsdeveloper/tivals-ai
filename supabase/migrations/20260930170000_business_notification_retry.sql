alter table public.telegram_business_requests add column if not exists owner_notified_at timestamptz;
create or replace function public.telegram_due_business_requests(p_now timestamptz default now())
returns setof public.telegram_business_requests language sql security invoker set search_path=public as $$
  select * from public.telegram_business_requests
  where owner_notified_at is null
    or (status='pending' and timeout_stage<2 and p_now>=created_at+(response_minutes*interval '1 minute')*(timeout_stage+1))
    or (status='confirmed' and starts_at>p_now and starts_at<=p_now+interval '24 hours' and booking_reminded_at is null)
    or (status='completed' and request_type in ('booking','ticket') and rating_requested_at is null)
  order by created_at limit 100;
$$;
revoke all on function public.telegram_due_business_requests(timestamptz) from public, anon, authenticated;
grant execute on function public.telegram_due_business_requests(timestamptz) to service_role;
