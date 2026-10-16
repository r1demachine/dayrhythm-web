-- DayRhythm Web: optional cloud sync.
-- Run in Supabase SQL Editor. Keep Row Level Security enabled.
create table if not exists public.dayrhythm_tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task jsonb,
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists dayrhythm_tasks_user_updated_idx
  on public.dayrhythm_tasks (user_id, updated_at desc);

alter table public.dayrhythm_tasks enable row level security;

drop policy if exists "Users can read their own DayRhythm tasks" on public.dayrhythm_tasks;
create policy "Users can read their own DayRhythm tasks"
  on public.dayrhythm_tasks for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own DayRhythm tasks" on public.dayrhythm_tasks;
create policy "Users can insert their own DayRhythm tasks"
  on public.dayrhythm_tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own DayRhythm tasks" on public.dayrhythm_tasks;
create policy "Users can update their own DayRhythm tasks"
  on public.dayrhythm_tasks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own DayRhythm tasks" on public.dayrhythm_tasks;
create policy "Users can delete their own DayRhythm tasks"
  on public.dayrhythm_tasks for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.dayrhythm_tasks to authenticated;
