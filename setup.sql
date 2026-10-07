-- Field Hunt: accounts, leaderboards, private photo storage and checked finds.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Safe to run again later; it only adds what's missing.

-- Usernames (one per account)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- One row per species a player has collected.
-- Rows are written only by the verify-find server function, after the photo is checked.
create table if not exists public.finds (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  species_key text not null,
  name text not null check (char_length(name) <= 80),
  grp text,
  rarity text,
  points int not null default 0,
  country text,
  found_at timestamptz not null default now(),
  unique (user_id, species_key)
);
alter table public.finds add column if not exists sci text;
alter table public.finds add column if not exists verdict text;
alter table public.finds add column if not exists ai_note text;
alter table public.finds add column if not exists photo_path text;
alter table public.finds add column if not exists photo_hash text;
alter table public.finds add column if not exists lat double precision;
alter table public.finds add column if not exists lng double precision;
alter table public.finds add column if not exists place text;
alter table public.finds add column if not exists checked_at timestamptz;
alter table public.finds add column if not exists kind text default 'photo';      -- 'photo' or 'sighting'
alter table public.finds add column if not exists ref_photo text;                  -- species reference picture
alter table public.finds add column if not exists user_note text;                  -- what the player noted on a sighting
alter table public.finds add column if not exists gps_acc real;                    -- GPS accuracy in metres for sightings
alter table public.finds drop constraint if exists finds_points_check;
alter table public.finds add constraint finds_points_check check (points between 0 and 200);
create index if not exists finds_photo_hash on public.finds (photo_hash);

-- Log of photo checks, used to cap checks per player per day (keeps AI costs predictable)
create table if not exists public.verify_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists verify_log_user_at on public.verify_log (user_id, at);

alter table public.profiles enable row level security;
alter table public.finds enable row level security;
alter table public.verify_log enable row level security;

-- Usernames are public (for the leaderboard). Players create their own.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles for insert with check (auth.uid() = id);

-- Players can see and delete only their own finds (locations and photos stay private).
-- No one can add or change finds directly; only the server function can, after checking the photo.
drop policy if exists "finds are public" on public.finds;
drop policy if exists "add own finds" on public.finds;
drop policy if exists "read own finds" on public.finds;
create policy "read own finds" on public.finds for select using (auth.uid() = user_id);
drop policy if exists "delete own finds" on public.finds;
create policy "delete own finds" on public.finds for delete using (auth.uid() = user_id);

-- Leaderboards: totals only, no photos or locations.
drop view if exists public.leaderboard_all;
drop view if exists public.leaderboard_week;
create view public.leaderboard_all as
  select p.username, sum(f.points)::int as points, count(f.id) filter (where f.points > 0)::int as species
  from public.finds f join public.profiles p on p.id = f.user_id
  group by p.username;
create view public.leaderboard_week as
  select p.username, sum(f.points)::int as points, count(f.id) filter (where f.points > 0)::int as species
  from public.finds f join public.profiles p on p.id = f.user_id
  where f.found_at >= now() - interval '7 days'
  group by p.username;
grant select on public.leaderboard_all, public.leaderboard_week to anon, authenticated;

-- Private photo storage: each player can only see their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
