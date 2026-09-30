-- Customer requests belong to one bot owner. Public Data API roles cannot read them.
alter table public.telegram_business_profiles
  add column if not exists confirmation_mode text not null default 'manual'
    check (confirmation_mode in ('manual','auto')),
  add column if not exists response_minutes integer not null default 120
    check (response_minutes between 5 and 1440);

create table if not exists public.telegram_business_slots (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null,
  starts_at timestamptz not null,
  capacity integer not null default 1 check (capacity between 1 and 100),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= capacity),
  created_at timestamptz not null default now(),
  unique (business_id, starts_at),
  unique (business_id, id)
);

create table if not exists public.telegram_business_drafts (
  business_id bigint not null,
  customer_id bigint not null,
  chat_id bigint not null,
  summary text not null check (char_length(summary) between 1 and 1500),
  reference text,
  expires_at timestamptz not null default (now()+interval '24 hours'),
  primary key (business_id,customer_id,chat_id)
);
alter table public.telegram_business_drafts enable row level security;
revoke all on public.telegram_business_drafts from anon, authenticated;

create table if not exists public.telegram_business_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (reference ~ '^[A-F0-9]{8}$'),
  business_id bigint not null,
  customer_id bigint not null,
  source_update_id bigint,
  chat_id bigint not null,
  business_connection_id text not null default '',
  customer_name text not null default '',
  customer_username text not null default '',
  customer_phone text not null default '',
  request_type text not null check (request_type in ('booking','order','payment','form','quote','ticket','handoff','complaint','urgent','decision','rating')),
  priority text not null check (priority in ('normal','high','urgent')),
  summary text not null check (char_length(summary) between 1 and 1500),
  status text not null default 'pending' check (status in ('pending','confirmed','declined','rescheduled','cancelled','completed','no_show')),
  starts_at timestamptz,
  suggested_at timestamptz,
  slot_id uuid,
  response_minutes integer not null default 120 check (response_minutes between 5 and 1440),
  timeout_stage smallint not null default 0 check (timeout_stage between 0 and 2),
  booking_reminded_at timestamptz,
  rating_requested_at timestamptz,
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, reference),
  unique (business_id, id),
  foreign key (business_id, slot_id) references public.telegram_business_slots(business_id,id)
);
create unique index if not exists telegram_business_requests_update on public.telegram_business_requests(business_id,source_update_id) where source_update_id is not null;
create index if not exists telegram_business_requests_due on public.telegram_business_requests (business_id,status,created_at);
create index if not exists telegram_business_requests_customer on public.telegram_business_requests (business_id,customer_id,created_at desc);
create index if not exists telegram_business_requests_booking on public.telegram_business_requests (starts_at) where status='confirmed';

alter table public.telegram_business_slots enable row level security;
alter table public.telegram_business_requests enable row level security;
revoke all on public.telegram_business_slots from anon, authenticated;
revoke all on public.telegram_business_requests from anon, authenticated;

-- Atomic slot reservation and status update. Only trusted Edge Functions with service_role may call it.
create or replace function public.telegram_confirm_business_slot(p_business_id bigint,p_reference text,p_slot_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_slot public.telegram_business_slots%rowtype;
begin
  select * into v_slot from public.telegram_business_slots
    where business_id=p_business_id and id=p_slot_id and starts_at>now() for update;
  if not found or v_slot.reserved>=v_slot.capacity then return false; end if;
  update public.telegram_business_requests set status='confirmed',slot_id=p_slot_id,
    starts_at=v_slot.starts_at,updated_at=now()
    where business_id=p_business_id and reference=p_reference and status in ('pending','rescheduled');
  if not found then return false; end if;
  update public.telegram_business_slots set reserved=reserved+1 where id=p_slot_id and business_id=p_business_id;
  return true;
end; $$;
revoke all on function public.telegram_confirm_business_slot(bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.telegram_confirm_business_slot(bigint,text,uuid) to service_role;

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

create or replace function public.telegram_due_business_requests(p_now timestamptz default now())
returns setof public.telegram_business_requests language sql security invoker set search_path=public as $$
  select * from public.telegram_business_requests
  where (status='pending' and timeout_stage<2 and p_now>=created_at+(response_minutes*interval '1 minute')*(timeout_stage+1))
    or (status='confirmed' and starts_at>p_now and starts_at<=p_now+interval '24 hours' and booking_reminded_at is null)
    or (status='completed' and request_type in ('booking','ticket') and rating_requested_at is null)
  order by created_at limit 100;
$$;
revoke all on function public.telegram_due_business_requests(timestamptz) from public, anon, authenticated;
grant execute on function public.telegram_due_business_requests(timestamptz) to service_role;

-- A dedicated random scheduler token stays encrypted in Vault. Only its hash is kept in the Data API schema.
create table if not exists public.telegram_business_job_config (
  id boolean primary key default true check (id),
  token_sha256 text not null
);
alter table public.telegram_business_job_config enable row level security;
revoke all on public.telegram_business_job_config from anon, authenticated;
do $setup$
declare v_secret text;
begin
  if not exists (select 1 from public.telegram_business_job_config where id=true) then
    v_secret:=encode(gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'telegram_business_job_token');
    insert into public.telegram_business_job_config(id,token_sha256) values (true,encode(digest(v_secret,'sha256'),'hex'));
  end if;
end $setup$;
select cron.schedule('telegram-business-jobs','*/5 * * * *',$job$
  select net.http_post(
    url:='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-business-jobs',
    headers:=jsonb_build_object('Content-type','application/json','x-business-job-token',(select decrypted_secret from vault.decrypted_secrets where name='telegram_business_job_token')),
    body:='{}'::jsonb
  );
$job$);
