-- Handy queries for checking beta signups.
-- Run in Supabase → SQL Editor (or just browse Table Editor → beta_signups).

-- Everyone who signed up, newest first
select name, email, created_at
from public.beta_signups
order by created_at desc;

-- Total signups
select count(*) as total_signups
from public.beta_signups;

-- Signups in the last 7 days
select name, email, created_at
from public.beta_signups
where created_at > now() - interval '7 days'
order by created_at desc;

-- Signups per day (for a quick growth check)
select date_trunc('day', created_at)::date as day, count(*) as signups
from public.beta_signups
group by day
order by day desc;
