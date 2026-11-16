-- Notebook — Supabase schema
-- Paste into the Supabase SQL editor and run. Safe to re-run: every
-- statement is idempotent, so this doubles as the migration for a project
-- that was created against the first version of this file.
--
-- Model: document METADATA lives in Postgres (small, queryable: sort by due
-- date, filter by course). Scene JSON and binary files live in Storage,
-- because scenes reach megabytes with heavy ink and imported PDF pages.
--
--   table   documents                          one row per notebook
--   bucket  scenes / <uid>/<docId>/scene.json  elements + appState + file ids
--   bucket  files  / <uid>/<fileId>.json       one image or imported PDF page
--
-- Files are content-addressed (Excalidraw derives a file id from the bytes)
-- and therefore immutable: they are uploaded once and never rewritten, which
-- is what keeps one ink stroke on a notebook containing a 20 MB PDF a ~40 kB
-- upload rather than a 20 MB one.

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

-- --------------------------------------------------------------------------
-- Columns the sync layer needs (added separately so an existing project can
-- run this file as a migration).
-- --------------------------------------------------------------------------

-- The conflict mechanism. Every accepted write bumps `version`, and every
-- client UPDATE is guarded by `where version = <the version I last agreed
-- with>`. Two devices pushing from the same base cannot therefore both win:
-- Postgres matches the guard for exactly one of them and the other's update
-- touches zero rows, which the client reads as "conflict" and forks.
alter table documents add column if not exists version int not null default 1;

-- Hash of the content this row was written with. Lets a client that has lost
-- its local bookkeeping tell "identical" from "diverged" without downloading
-- the scene.
alter table documents add column if not exists content_hash text;

-- Which device wrote this version, for the conflict copy's name
-- ("Lecture 4 (conflict from iPad)"). A label the user can edit, not an
-- identifier.
alter table documents add column if not exists device text;

-- Soft delete. A hard DELETE is invisible to a device that is offline when
-- it happens: it would simply re-upload the notebook on its next pass. A
-- tombstone is how the deletion actually propagates.
alter table documents add column if not exists deleted_at timestamptz;

-- data: URL PNG of page 1, so the shelf on a new device has thumbnails
-- without downloading every scene. The client refuses to upload one over
-- 96 kB.
alter table documents add column if not exists thumbnail text;

-- Paper defaults that postdate the first schema.
alter table documents add column if not exists default_landscape boolean;
alter table documents add column if not exists default_image_fit text;

-- The CLIENT's own timestamps. `created_at` / `updated_at` are server time
-- (and `updated_at` is forced by the trigger below), which is the right
-- thing for auditing and the wrong thing for "edited 3 minutes ago" — that
-- has to mean the same on every device.
alter table documents add column if not exists client_created_at timestamptz;
alter table documents add column if not exists client_updated_at timestamptz;

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

-- Belt and braces: a client that forgets to set user_id gets the signed-in
-- user rather than a NOT NULL violation, and a client that sets somebody
-- else's is still refused by the policy's WITH CHECK above.
alter table documents alter column user_id set default auth.uid();

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

-- --------------------------------------------------------------------------
-- Verifying the policies actually deny, rather than hoping they do.
--
-- Run this block in the SQL editor AFTER creating two accounts in
-- Authentication -> Users. It impersonates each one the way PostgREST does
-- (role `authenticated` plus a JWT claim) and asserts that neither can see
-- the other's row. It cleans up after itself and raises an exception if the
-- isolation is broken, so a green run is a real result.
-- --------------------------------------------------------------------------

-- do $$
-- declare
--   a uuid; b uuid; leaked int;
-- begin
--   select id into a from auth.users order by created_at limit 1;
--   select id into b from auth.users where id <> a order by created_at limit 1;
--   if b is null then
--     raise exception 'create two users first';
--   end if;
--
--   insert into documents (id, user_id, title) values ('rls-probe-a', a, 'A');
--   insert into documents (id, user_id, title) values ('rls-probe-b', b, 'B');
--
--   set local role authenticated;
--   perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
--   select count(*) into leaked from documents where id = 'rls-probe-b';
--   if leaked <> 0 then
--     raise exception 'RLS FAILED: user A can read user B''s document';
--   end if;
--   begin
--     update documents set title = 'stolen' where id = 'rls-probe-b';
--     if found then raise exception 'RLS FAILED: user A can write user B''s document'; end if;
--   exception when insufficient_privilege then null;
--   end;
--
--   reset role;
--   delete from documents where id in ('rls-probe-a', 'rls-probe-b');
--   raise notice 'RLS OK: cross-user read and write are both denied';
-- end $$;
