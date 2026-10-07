-- Field Hunt: accounts and leaderboards.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.

-- Usernames (one per account)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- One row per species a player has collected. Photos never leave the phone.
create table if not exists public.finds (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  species_key text not null,
  name text not null check (char_length(name) <= 80),
  grp text,
  rarity text,
  points int not null check (points between 0 and 150),
  country text,
  found_at timestamptz not null default now(),
  unique (user_id, species_key)
);

alter table public.profiles enable row level security;
alter table public.finds enable row level security;

-- Anyone can read usernames and finds (needed for the leaderboard).
-- Players can only create or change their own.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "finds are public" on public.finds;
create policy "finds are public" on public.finds for select using (true);
drop policy if exists "add own finds" on public.finds;
create policy "add own finds" on public.finds for insert with check (auth.uid() = user_id);
drop policy if exists "delete own finds" on public.finds;
create policy "delete own finds" on public.finds for delete using (auth.uid() = user_id);

-- Leaderboards
create or replace view public.leaderboard_all with (security_invoker = on) as
  select p.username, sum(f.points)::int as points, count(f.id)::int as species
  from public.finds f join public.profiles p on p.id = f.user_id
  group by p.username;

create or replace view public.leaderboard_week with (security_invoker = on) as
  select p.username, sum(f.points)::int as points, count(f.id)::int as species
  from public.finds f join public.profiles p on p.id = f.user_id
  where f.found_at >= now() - interval '7 days'
  group by p.username;

grant select on public.leaderboard_all, public.leaderboard_week to anon, authenticated;
