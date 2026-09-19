create table if not exists public.widget_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  public_key uuid not null unique default gen_random_uuid(),
  business_name text not null default '',
  business_description text not null default '',
  services text not null default '',
  contact_details text not null default '',
  faq text not null default '',
  instructions text not null default '',
  welcome_message text not null default 'Hi! How can I help?',
  allowed_domains text[] not null default '{}',
  is_active boolean not null default true,
  request_count bigint not null default 0 check (request_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

alter table public.widget_configs enable row level security;

drop policy if exists "Owners can view widget configuration" on public.widget_configs;
create policy "Owners can view widget configuration" on public.widget_configs
for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "Owners can create widget configuration" on public.widget_configs;
create policy "Owners can create widget configuration" on public.widget_configs
for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners can update widget configuration" on public.widget_configs;
create policy "Owners can update widget configuration" on public.widget_configs
for update to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners can delete widget configuration" on public.widget_configs;
create policy "Owners can delete widget configuration" on public.widget_configs
for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.widget_configs to authenticated;
revoke all on public.widget_configs from anon;

create or replace function public.set_widget_config_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_widget_config_updated_at on public.widget_configs;
create trigger set_widget_config_updated_at before update on public.widget_configs
for each row execute function public.set_widget_config_updated_at();

create or replace function public.record_widget_request(p_public_key uuid)
returns void language sql security definer set search_path = '' as $$
  update public.widget_configs
  set request_count = request_count + 1, last_used_at = now()
  where public_key = p_public_key and is_active = true;
$$;

revoke all on function public.record_widget_request(uuid) from public, anon, authenticated;
grant execute on function public.record_widget_request(uuid) to service_role;
