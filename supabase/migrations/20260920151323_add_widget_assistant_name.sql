alter table public.widget_configs
  add column if not exists assistant_name text not null default 'Tivals AI';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.widget_configs'::regclass
      and conname = 'widget_configs_assistant_name_length'
  ) then
    alter table public.widget_configs
      add constraint widget_configs_assistant_name_length
      check (char_length(btrim(assistant_name)) between 1 and 80);
  end if;
end
$$;