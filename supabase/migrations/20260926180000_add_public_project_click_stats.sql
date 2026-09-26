create table if not exists public.project_download_clicks (
  id bigint generated always as identity primary key,
  project text not null check (project in ('tiveltext')),
  clicked_at timestamptz not null default now(),
  hour_bucket text not null,
  visitor_hash text not null,
  unique (project, hour_bucket, visitor_hash)
);

create index if not exists project_download_clicks_project_time_idx
  on public.project_download_clicks (project, clicked_at desc);

alter table public.project_download_clicks enable row level security;
revoke all on public.project_download_clicks from anon, authenticated;
