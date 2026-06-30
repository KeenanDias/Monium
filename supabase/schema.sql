-- Monium — database schema
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → Run.
-- It creates the beta_signups table and a row-level-security policy that lets
-- anonymous visitors INSERT a signup but NOT read anyone's data (safe waitlist pattern).

create table if not exists public.beta_signups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.beta_signups enable row level security;

-- allow anonymous visitors to INSERT only
-- (drop first so this whole file is safe to re-run)
drop policy if exists "anon can join beta" on public.beta_signups;
create policy "anon can join beta"
  on public.beta_signups
  for insert
  to anon
  with check (true);
