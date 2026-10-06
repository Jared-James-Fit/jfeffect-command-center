-- Extra stand-ins for the tables the clients directory reads. Run AFTER
-- supabase/tests/coaching-agreement/schema.sql (which creates auth.uid(), has_role, is_assigned_coach,
-- clients and the agreement helpers) and the coaching-agreement migration.

alter table public.coaches add column if not exists full_name text;

alter table public.clients
  add column if not exists profile_picture_url text,
  add column if not exists coaching_type text,
  add column if not exists account_status text,
  add column if not exists payment_status text,
  add column if not exists needs_admin_help boolean,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists next_program_update date,
  add column if not exists last_active_at timestamptz,
  add column if not exists last_signed_in_at timestamptz,
  add column if not exists preferred_training_days text[];

create table public.pl_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, name text, start_date date, end_date date,
  status text, archived boolean not null default false
);
create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, start_date date, end_date date, status text
);
create table public.cardio_targets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, start_date date, end_date date, status text
);
create table public.submission_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, review_status text
);
create table public.pl_scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, scheduled_date date
);
create table public.pl_day_completions (
  id uuid primary key default gen_random_uuid(),
  scheduled_workout_id uuid, completed_at timestamptz
);
create table public.purchase_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, payment_status text, service_status text, archived_at timestamptz
);

-- clients_directory_accuracy.sql calls this; the body is only checked when it runs.
create table public.client_activity_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid, actor_user_id uuid, actor_role text, action text, details jsonb
);
