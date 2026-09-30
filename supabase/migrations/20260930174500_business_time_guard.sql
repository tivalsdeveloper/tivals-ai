create or replace function public.telegram_transition_business_request(
  p_business_id bigint,p_reference text,p_actor text,p_customer_id bigint,p_action text,p_suggested_at timestamptz default null)
returns public.telegram_business_requests language plpgsql security invoker set search_path=public as $$
declare v_request public.telegram_business_requests%rowtype; v_next text;
begin
  select * into v_request from public.telegram_business_requests
    where business_id=p_business_id and reference=p_reference for update;
  if not found then raise exception 'Request unavailable'; end if;
  if p_actor='customer' and v_request.customer_id<>p_customer_id then raise exception 'Request unavailable'; end if;
  v_next:=case
    when p_actor='owner' and v_request.status in ('pending','rescheduled') and p_action='confirm' then 'confirmed'
    when p_actor='owner' and v_request.status in ('pending','rescheduled') and p_action='decline' then 'declined'
    when p_actor='owner' and v_request.status in ('pending','rescheduled') and p_action='suggest' then 'rescheduled'
    when p_actor='owner' and v_request.status='confirmed' and p_action='complete' then 'completed'
    when p_actor='owner' and v_request.status='pending' and v_request.request_type not in ('booking','order','payment') and p_action='complete' then 'completed'
    when p_actor='owner' and v_request.status='confirmed' and p_action='no_show' then 'no_show'
    when p_actor='customer' and v_request.status='rescheduled' and p_action='accept' then 'confirmed'
    when p_actor='customer' and v_request.status in ('pending','rescheduled','confirmed') and p_action='cancel' then 'cancelled'
    when p_actor='customer' and v_request.status='confirmed' and p_action='change' then 'rescheduled'
    else null end;
  if v_next is null then raise exception 'Invalid request transition'; end if;
  if p_action='accept' and (v_request.suggested_at is null or v_request.suggested_at<=now()) then raise exception 'Suggested time unavailable'; end if;
  if p_action='confirm' and v_request.request_type='booking' and (v_request.starts_at is null or v_request.starts_at<=now()) then raise exception 'Booking time unavailable'; end if;
  if p_action='suggest' and (p_suggested_at is null or p_suggested_at<=now()) then raise exception 'A future time is required'; end if;
  if p_action in ('cancel','change') and v_request.slot_id is not null then
    update public.telegram_business_slots set reserved=greatest(0,reserved-1)
      where business_id=p_business_id and id=v_request.slot_id;
  end if;
  update public.telegram_business_requests set status=v_next,
    suggested_at=case when p_action='suggest' then p_suggested_at else suggested_at end,
    starts_at=case when p_action='accept' then suggested_at else starts_at end,
    slot_id=case when p_action in ('cancel','change') then null else slot_id end,
    booking_reminded_at=case when p_action in ('suggest','accept','change') then null else booking_reminded_at end,
    updated_at=now() where id=v_request.id returning * into v_request;
  return v_request;
end; $$;
revoke all on function public.telegram_transition_business_request(bigint,text,text,bigint,text,timestamptz) from public, anon, authenticated;
grant execute on function public.telegram_transition_business_request(bigint,text,text,bigint,text,timestamptz) to service_role;


