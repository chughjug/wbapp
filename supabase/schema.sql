-- Notebook — Supabase schema
-- Paste into the Supabase SQL editor and run.
--
-- Model: document METADATA lives in Postgres (small, queryable: sort by due
-- date, filter by course). Scene JSON and binary files live in Storage,
-- because scenes reach megabytes with heavy ink and imported PDF pages.

create table if not exists documents (
  id               text primary key,
  user_id          uuid        not null references auth.users on delete cascade,
  title            text        not null default 'Untitled notebook',
  course           text,
  due_date         timestamptz,
  tags             text[]      not null default '{}',
  page_count       int         not null default 1,
  default_template text        not null default 'lined',
  default_page_size text       not null default 'LETTER',
  thumbnail_path   text,
  scene_path       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_opened_at   timestamptz
);

create index if not exists documents_user_due   on documents (user_id, due_date);
create index if not exists documents_user_upd   on documents (user_id, updated_at desc);
create index if not exists documents_user_course on documents (user_id, course);

-- Row Level Security.
-- Load-bearing: the anon key ships in the client bundle by design, so these
-- policies are the only thing stopping one user reading another's notes.
alter table documents enable row level security;

drop policy if exists "own documents" on documents;
create policy "own documents" on documents
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Storage buckets. Private; reached through the policies below.
insert into storage.buckets (id, name, public)
  values ('scenes', 'scenes', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('files', 'files', false)
  on conflict (id) do nothing;

-- Objects are keyed <user_id>/<...>, so the first path segment is the owner.
-- Locking the table but leaving buckets open is a common and costly mistake,
-- so both buckets get the same ownership rule.
drop policy if exists "own scene objects" on storage.objects;
create policy "own scene objects" on storage.objects
  for all
  using (
    bucket_id in ('scenes', 'files')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('scenes', 'files')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Keep updated_at honest regardless of what the client sends.
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists documents_updated_at on documents;
create trigger documents_updated_at
  before update on documents
  for each row execute function set_updated_at();
