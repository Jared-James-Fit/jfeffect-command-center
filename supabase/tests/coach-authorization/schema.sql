-- Minimal stand-ins for the tables, helpers and policies that
-- 20270507093000_cleo_actions_run_as_requester.sql,
-- 20270507094000_coach_money_read_only.sql and
-- 20270507094500_coach_client_data_scoped.sql change, with each table's
-- policies as production had them before (copied from the latest migration
-- that defined them), so the migrations replace real rules.
\set ON_ERROR_STOP 1

create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth_ctx (uid uuid, role text);
insert into auth_ctx values (null, null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function auth.role() returns text language sql stable as $$ select role from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated' $$;
create function t_as_service() returns void language sql as $$ update public.auth_ctx set uid = null, role = 'service_role' $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text);

create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, unique (user_id, role));
create table business_owners (user_id uuid primary key references auth.users(id));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create function is_admin_viewer() returns boolean language sql stable as $$ select false $$;
create function is_business_owner(_uid uuid default auth.uid()) returns boolean language sql stable security definer as $$
  select exists (select 1 from business_owners where user_id = _uid) $$;
-- The production rewrite (rls_once_expr) only wraps calls in (SELECT …): same access. A no-op here.
create function rls_evaluate_once(_table text default null) returns integer language sql as $$ select 0 $$;

create table coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique, full_name text,
  status text not null default 'Active',
  archived boolean not null default false
);
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, full_name text,
  assigned_coach_id uuid references coaches(id)
);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;
create function current_coach_id() returns uuid language sql stable security definer as $$
  select id from coaches where user_id = auth.uid() and archived = false limit 1 $$;
create function is_coach_or_admin(_user_id uuid) returns boolean language sql stable security definer as $$
  select has_role(_user_id, 'admin') or exists (select 1 from coaches where user_id = _user_id and archived = false and status = 'Active') $$;
create function is_assigned_coach(_client_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from clients c join coaches co on co.id = c.assigned_coach_id
                  where c.id = _client_id and co.user_id = auth.uid() and co.archived = false and co.status = 'Active') $$;

-- ── Cleo actions (20261101090000_cleo_actions.sql) ─────────────────────────
create table cleo_actions (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users (id) on delete cascade,
  kind text not null, params jsonb not null default '{}'::jsonb, summary text not null, permission text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'cancelled', 'awaiting_approval', 'declined', 'running', 'done', 'failed')),
  result text, error text,
  decided_by uuid references auth.users (id) on delete set null, decided_at timestamptz, done_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table cleo_actions enable row level security;
grant select on cleo_actions to authenticated;
grant all on cleo_actions to service_role;
create policy "cleo actions: requester and owner read" on cleo_actions for select to authenticated
  using (requested_by = auth.uid() or public.is_business_owner(auth.uid()));

create table messenger_checkins (id uuid primary key default gen_random_uuid(), client_id uuid, status text, superseded_at timestamptz,
  reviewed_at timestamptz, reviewed_by uuid, reviewed_via text);
create table nf_submissions (id uuid primary key default gen_random_uuid(), client_id uuid, submitted_at timestamptz, status text,
  reviewed_at timestamptz, reviewed_by uuid);
create table submission_reviews (id uuid primary key default gen_random_uuid(), client_id uuid, source_type text, review_status text);
grant all on messenger_checkins, nf_submissions to service_role;

-- ── Money ──────────────────────────────────────────────────────────────────
create table purchase_records (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id),
  offer_name text, payment_status text, amount_paid_cents bigint);
alter table purchase_records enable row level security;
create policy "Admin manage purchase_records" on purchase_records for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "Coach manage assigned purchase_records" on purchase_records for all to authenticated
  using (is_assigned_coach(client_id)) with check (is_assigned_coach(client_id));
create policy "Client read own purchase_records" on purchase_records for select to authenticated
  using (exists (select 1 from clients c where c.id = purchase_records.client_id and c.user_id = auth.uid()));

create table app_members (id uuid primary key default gen_random_uuid(), user_id uuid);
create function is_assigned_coach_for_member(_member_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from app_members m join clients c on c.user_id = m.user_id where m.id = _member_id and is_assigned_coach(c.id)) $$;
create table member_payment_ledger (id uuid primary key default gen_random_uuid(), member_id uuid references app_members(id),
  amount_cents integer, status text);
alter table member_payment_ledger enable row level security;
create policy "admin_coach_full_access_payment_ledger" on member_payment_ledger for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or (has_role(auth.uid(), 'coach'::app_role) and is_assigned_coach_for_member(member_id)))
  with check (has_role(auth.uid(), 'admin'::app_role) or (has_role(auth.uid(), 'coach'::app_role) and is_assigned_coach_for_member(member_id)));

create table coaching_packages (id uuid primary key default gen_random_uuid(), name text);
create table coaching_package_enrollments (id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id),
  package_id uuid not null references coaching_packages(id), status text not null default 'active', contracted_price_cents integer);
alter table coaching_package_enrollments enable row level security;
create policy "Staff read package enrollments" on coaching_package_enrollments for select to authenticated
  using ((select has_role((select auth.uid()), 'admin')) or client_id in (select coached_client_ids()));
create policy "Staff add package enrollments" on coaching_package_enrollments for insert to authenticated
  with check ((select has_role((select auth.uid()), 'admin')) or client_id in (select coached_client_ids()));
create policy "Staff change package enrollments" on coaching_package_enrollments for update to authenticated
  using ((select has_role((select auth.uid()), 'admin')) or client_id in (select coached_client_ids()))
  with check ((select has_role((select auth.uid()), 'admin')) or client_id in (select coached_client_ids()));

create table payment_share_links (id uuid primary key default gen_random_uuid(), purchase_record_id uuid references purchase_records(id), token text);
alter table payment_share_links enable row level security;
create policy "Staff can view payment share links" on payment_share_links for select to authenticated
  using (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'coach'));

-- ── Client data any coach could read ───────────────────────────────────────
create table nutrition_ai_plans (id uuid primary key default gen_random_uuid(), client_id uuid not null, meal_plan_text text);
alter table nutrition_ai_plans enable row level security;
create policy "staff read nutrition ai plans" on nutrition_ai_plans for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'coach'::app_role));

create table support_alerts (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id),
  coach_id uuid references coaches(id), status text not null default 'open', error_message text);
alter table support_alerts enable row level security;
create policy "Clients view own alerts" on support_alerts for select to authenticated
  using (exists (select 1 from clients c where c.id = support_alerts.client_id and c.user_id = auth.uid()));
create policy "Coaches view alerts for their clients" on support_alerts for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or (support_alerts.client_id is not null and is_assigned_coach(support_alerts.client_id)) or is_coach_or_admin(auth.uid()));
create policy "Coaches update alerts" on support_alerts for update to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or is_coach_or_admin(auth.uid()))
  with check (has_role(auth.uid(), 'admin'::app_role) or is_coach_or_admin(auth.uid()));

create table pl_completion_link_review (id uuid primary key default gen_random_uuid(), client_id uuid not null, reason text);
alter table pl_completion_link_review enable row level security;
create policy "Admins and coaches can read completion link review" on pl_completion_link_review for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'coach'::app_role));

create table pl_blocks (id uuid primary key default gen_random_uuid(), client_id uuid);
create table pl_weeks (id uuid primary key default gen_random_uuid(), block_id uuid references pl_blocks(id));
create table pl_days (id uuid primary key default gen_random_uuid(), week_id uuid references pl_weeks(id));
create table warmup_assignments (id uuid primary key default gen_random_uuid(), protocol_id uuid not null,
  scope text not null check (scope in ('exercise','pl_day','pl_block','client')),
  exercise_id uuid, pl_day_id uuid references pl_days(id), pl_block_id uuid references pl_blocks(id), client_id uuid references clients(id));
alter table warmup_assignments enable row level security;
create policy "warmup_assignments_admin_coach_all" on warmup_assignments for all to authenticated
  using (is_coach_or_admin(auth.uid())) with check (is_coach_or_admin(auth.uid()));

create table event_assignments (id uuid primary key default gen_random_uuid(), event_id uuid not null, client_id uuid not null references clients(id));
alter table event_assignments enable row level security;
create policy "event_assignments_admin_coach_all" on event_assignments for all to authenticated
  using (is_coach_or_admin(auth.uid())) with check (is_coach_or_admin(auth.uid()));

create table mass_message_log (id uuid primary key default gen_random_uuid(), body text not null, sent_by uuid);
alter table mass_message_log enable row level security;
create policy "mass_message_log_select" on mass_message_log for select to authenticated using (is_coach_or_admin(auth.uid()));
create policy "mass_message_log_insert" on mass_message_log for insert to authenticated
  with check (is_coach_or_admin(auth.uid()) and sent_by = auth.uid());

alter table submission_reviews enable row level security;
create policy "submission_reviews admin all" on submission_reviews for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "submission_reviews coach read assigned" on submission_reviews for select to authenticated
  using (is_coach_or_admin(auth.uid()) and (client_id is null or is_assigned_coach(client_id)));
create policy "submission_reviews coach update assigned" on submission_reviews for update to authenticated
  using (is_coach_or_admin(auth.uid()) and client_id is not null and is_assigned_coach(client_id))
  with check (is_coach_or_admin(auth.uid()) and client_id is not null and is_assigned_coach(client_id));

create table scheduled_submission_responses (id uuid primary key default gen_random_uuid(), review_id uuid references submission_reviews(id));
create table submission_ai_generations (id uuid primary key default gen_random_uuid(), review_id uuid references submission_reviews(id));
create table submission_audit_events (id uuid primary key default gen_random_uuid(), review_id uuid references submission_reviews(id), note text);
create table submission_delivery_attempts (id uuid primary key default gen_random_uuid(), review_id uuid references submission_reviews(id));
alter table scheduled_submission_responses enable row level security;
alter table submission_ai_generations enable row level security;
alter table submission_audit_events enable row level security;
alter table submission_delivery_attempts enable row level security;
create policy "scheduled_responses admin all" on scheduled_submission_responses for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "submission_ai_generations admin all" on submission_ai_generations for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "audit_events admin all" on submission_audit_events for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "delivery_attempts admin all" on submission_delivery_attempts for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "scheduled_responses coach read" on scheduled_submission_responses for select to authenticated
  using (exists (select 1 from submission_reviews r where r.id = scheduled_submission_responses.review_id and is_coach_or_admin(auth.uid()) and (r.client_id is null or is_assigned_coach(r.client_id))));
create policy "submission_ai_generations coach read assigned" on submission_ai_generations for select to authenticated
  using (exists (select 1 from submission_reviews r where r.id = submission_ai_generations.review_id and is_coach_or_admin(auth.uid()) and (r.client_id is null or is_assigned_coach(r.client_id))));
create policy "audit_events coach read" on submission_audit_events for select to authenticated
  using (exists (select 1 from submission_reviews r where r.id = submission_audit_events.review_id and is_coach_or_admin(auth.uid()) and (r.client_id is null or is_assigned_coach(r.client_id))));
create policy "audit_events coach insert" on submission_audit_events for insert to authenticated
  with check (exists (select 1 from submission_reviews r where r.id = submission_audit_events.review_id and is_coach_or_admin(auth.uid()) and (r.client_id is null or is_assigned_coach(r.client_id))));
create policy "delivery_attempts coach read" on submission_delivery_attempts for select to authenticated
  using (exists (select 1 from submission_reviews r where r.id = submission_delivery_attempts.review_id and is_coach_or_admin(auth.uid()) and (r.client_id is null or is_assigned_coach(r.client_id))));

create table fillout_submissions (id uuid primary key default gen_random_uuid(), client_id uuid, payload text);
alter table fillout_submissions enable row level security;
create policy "fillout_submissions admin all" on fillout_submissions for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
create policy "fillout_submissions coach update" on fillout_submissions for update to authenticated
  using (is_coach_or_admin(auth.uid()) and (client_id is null or is_assigned_coach(client_id)))
  with check (is_coach_or_admin(auth.uid()) and (client_id is null or is_assigned_coach(client_id)));
create policy "fillout_submissions coach read" on fillout_submissions for select
  using (is_coach_or_admin(auth.uid()) and (client_id is null or is_assigned_coach(client_id)));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, service_role;

-- ── The team and their clients ─────────────────────────────────────────────
-- The owner (admin + business owner); Ana coaches Marc; Ben coaches Nico; the
-- finance login; Mia, a client with a login (a member of the app too).
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'mia@example.test');
insert into business_owners values ('00000000-0000-0000-0000-0000000000a1');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance'),
  ('00000000-0000-0000-0000-0000000000e1', 'client');
insert into coaches (id, user_id, full_name) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach');
insert into clients (id, user_id, full_name, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e01', null, 'Marc Client', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico Client', '00000000-0000-0000-0000-00000000c0b2'),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia Client', '00000000-0000-0000-0000-00000000c0a1');

insert into purchase_records (id, client_id, offer_name, payment_status, amount_paid_cents) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000c1e01', '16 Sessions', 'Unpaid', 0),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000c1e02', 'Online Coaching', 'Paid', 13000),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-0000000c1e03', 'Online Coaching', 'Paid', 13000);
insert into payment_share_links (purchase_record_id, token) values
  ('00000000-0000-0000-0000-00000000b001', 'tok-marc'), ('00000000-0000-0000-0000-00000000b002', 'tok-nico');
insert into app_members (id, user_id) values ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-0000000000e1');
insert into member_payment_ledger (member_id, amount_cents, status) values ('00000000-0000-0000-0000-0000000aa001', 2900, 'paid');
insert into coaching_packages (id, name) values ('00000000-0000-0000-0000-0000000ab001', 'Complete Online Coaching');
insert into coaching_package_enrollments (client_id, package_id, contracted_price_cents) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000ab001', 13000),
  ('00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-0000000ab001', 13000);

insert into nutrition_ai_plans (client_id, meal_plan_text) values
  ('00000000-0000-0000-0000-0000000c1e01', 'Marc plan'), ('00000000-0000-0000-0000-0000000c1e02', 'Nico plan');
insert into support_alerts (client_id, coach_id, error_message) values
  ('00000000-0000-0000-0000-0000000c1e01', null, 'Marc workout failed'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico workout failed'),
  (null, null, 'Google setup broken'),
  (null, '00000000-0000-0000-0000-00000000c0a1', 'Ana calendar alert');
insert into pl_completion_link_review (client_id, reason) values
  ('00000000-0000-0000-0000-0000000c1e01', 'marc'), ('00000000-0000-0000-0000-0000000c1e02', 'nico');
insert into pl_blocks (id, client_id) values
  ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000c1e01'),
  ('00000000-0000-0000-0000-0000000bb002', '00000000-0000-0000-0000-0000000c1e02');
insert into pl_weeks (id, block_id) values
  ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000bb001'),
  ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000bb002');
insert into pl_days (id, week_id) values
  ('00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-0000000ee001'),
  ('00000000-0000-0000-0000-0000000dd002', '00000000-0000-0000-0000-0000000ee002');
insert into warmup_assignments (protocol_id, scope, exercise_id, client_id, pl_block_id, pl_day_id) values
  (gen_random_uuid(), 'exercise', gen_random_uuid(), null, null, null),
  (gen_random_uuid(), 'client', null, '00000000-0000-0000-0000-0000000c1e01', null, null),
  (gen_random_uuid(), 'client', null, '00000000-0000-0000-0000-0000000c1e02', null, null),
  (gen_random_uuid(), 'pl_block', null, null, '00000000-0000-0000-0000-0000000bb001', null),
  (gen_random_uuid(), 'pl_block', null, null, '00000000-0000-0000-0000-0000000bb002', null),
  (gen_random_uuid(), 'pl_day', null, null, null, '00000000-0000-0000-0000-0000000dd001'),
  (gen_random_uuid(), 'pl_day', null, null, null, '00000000-0000-0000-0000-0000000dd002');
insert into event_assignments (event_id, client_id) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000c1e01'), (gen_random_uuid(), '00000000-0000-0000-0000-0000000c1e02');
insert into mass_message_log (body, sent_by) values
  ('From Ana', '00000000-0000-0000-0000-0000000000c1'), ('From the owner', '00000000-0000-0000-0000-0000000000a1');
insert into submission_reviews (id, client_id, source_type, review_status) values
  ('00000000-0000-0000-0000-0000000fe001', '00000000-0000-0000-0000-0000000c1e01', 'fillout', 'pending'),
  ('00000000-0000-0000-0000-0000000fe002', '00000000-0000-0000-0000-0000000c1e02', 'fillout', 'pending'),
  ('00000000-0000-0000-0000-0000000fe003', null, 'fillout', 'pending');
insert into scheduled_submission_responses (review_id) values
  ('00000000-0000-0000-0000-0000000fe001'), ('00000000-0000-0000-0000-0000000fe002'), ('00000000-0000-0000-0000-0000000fe003');
insert into submission_ai_generations (review_id) values
  ('00000000-0000-0000-0000-0000000fe001'), ('00000000-0000-0000-0000-0000000fe002'), ('00000000-0000-0000-0000-0000000fe003');
insert into submission_audit_events (review_id, note) values
  ('00000000-0000-0000-0000-0000000fe001', 'm'), ('00000000-0000-0000-0000-0000000fe002', 'n'), ('00000000-0000-0000-0000-0000000fe003', 'x');
insert into submission_delivery_attempts (review_id) values
  ('00000000-0000-0000-0000-0000000fe001'), ('00000000-0000-0000-0000-0000000fe002'), ('00000000-0000-0000-0000-0000000fe003');
insert into fillout_submissions (client_id, payload) values
  ('00000000-0000-0000-0000-0000000c1e01', 'marc'), ('00000000-0000-0000-0000-0000000c1e02', 'nico'), (null, 'website lead');
insert into messenger_checkins (client_id, status) values
  ('00000000-0000-0000-0000-0000000c1e01', 'completed'), ('00000000-0000-0000-0000-0000000c1e02', 'completed');
insert into nf_submissions (client_id, submitted_at, status) values
  ('00000000-0000-0000-0000-0000000c1e01', now(), 'submitted');
