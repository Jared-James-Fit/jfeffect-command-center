## Membership Platform — Phase 1 + 2

A separate subscription-side of the app. App Members and Program-Only Members live in their own table, have their own portal, can pick a workout plan from a Plan Library, follow it, complete and log workouts, and have access governed by the Stripe products they own.

Coaching Clients continue to use the existing `clients` table and `/portal/*` routes. Nothing about that flow changes.

---

### 1. Data model (one migration)

New tables, all RLS-protected.

**`app_members`** — member identities (separate from `clients`)
- `user_id` → `auth.users.id` (unique, nullable for invited-but-not-signed-up)
- `email`, `full_name`, `avatar_url`
- `account_type`: `app_member` | `program_only`
- `status`: `Active` | `Trial` | `Past Due` | `Cancelled` | `Expired` | `Deactivated` | `Archived`
- `stripe_customer_id`
- `setup_token`, `setup_token_expires_at` (for "Copy/Send Setup Link")
- `messaging_permission`: `none` | `support_only` | `upgrade_only`
- `last_signed_in_at`, `last_active_at`
- `admin_notes`

**`access_levels`** — catalog of access keys (seeded)
- `key` (e.g. `app_membership`, `program_library`, `powerlifting_plans`, `resource_library`, `coaching_access`)
- `label`, `description`

**`product_access_grants`** — wires existing `offers`/products to access levels + account type
- `offer_id` → existing `offers` table
- `account_type_granted`: `coaching_client` | `app_member` | `program_only`
- `access_level_keys`: text[]
- `included_plan_ids`: uuid[] (for Program-Only)
- `is_subscription`: bool

**`member_access`** — what each member currently has access to
- `member_id` → `app_members`
- `access_level_key`
- `source`: `subscription` | `one_time` | `admin_grant`
- `offer_id` (nullable), `purchase_record_id` (nullable)
- `granted_at`, `expires_at` (nullable)
- `active`: bool

**`member_plans`** — the published, member-facing plan library (frozen copies)
- `name`, `description`, `cover_image_url`
- `training_style`, `goal`, `difficulty`
- `weeks`, `days_per_week`, `est_minutes_per_workout`
- `equipment_needed`: text[]
- `tags`: text[]
- `status`: `Draft` | `Published` | `Archived`
- `featured`: bool
- `tracking_enabled`: bool, `logging_enabled`: bool
- `required_access_level`: text (FK key into `access_levels`)
- `source_template_id` (nullable) — links back to `pl_templates` it was published from
- `source_block_id` (nullable) — or the coaching block it was published from
- `published_payload` — jsonb snapshot of weeks/days/rows at publish time (frozen)

**`member_plan_enrollments`** — a member's active/completed plans
- `member_id`, `plan_id`
- `status`: `Active` | `Completed` | `Abandoned`
- `started_at`, `completed_at`
- `current_week`, `workouts_completed`, `workouts_total`

**`member_workout_completions`** — per-workout completion
- `enrollment_id`, `week_index`, `day_index`
- `completed_at`, `notes`

**`member_set_logs`** — optional per-set logging
- `enrollment_id`, `week_index`, `day_index`, `exercise_index`, `set_index`
- `reps`, `load_kg`, `load_lb`, `rpe`, `rir`, `notes`

RLS pattern (all member-facing tables): "member can read/write rows where `member_id = (select id from app_members where user_id = auth.uid())`"; admin (`has_role`) full access; everything else denied.

Seed `access_levels` with: `app_membership`, `program_library`, `powerlifting_plans`, `bodybuilding_plans`, `fat_loss_plans`, `resource_library`, `nutrition_tools`, `coaching_access`, `premium_member`.

---

### 2. Server functions

`src/lib/members.functions.ts`
- `createAppMember`, `updateAppMember`, `deactivateMember`, `archiveMember`, `listMembers` (with filter by account_type/status)
- `generateSetupLink` (returns URL with `setup_token`), `generatePasswordResetLink`
- `grantAccess`, `revokeAccess`, `listMemberAccess`
- `assignPlanToMember` (admin-side manual unlock)

`src/lib/member-plans.functions.ts`
- `listMemberPlans` (admin: all; member: only ones their access_levels unlock)
- `getMemberPlan(id)` (with `published_payload`)
- `createMemberPlan` (blank), `updateMemberPlan`, `publishMemberPlan`, `archiveMemberPlan`, `duplicateMemberPlan`, `deleteMemberPlan`
- `publishFromTemplate(templateId)` — snapshot `pl_templates` payload → new `member_plans` row, `status='Draft'`
- `publishFromBlock(blockId)` — snapshot block tree → new `member_plans` row
- `startPlan(planId)` — creates `member_plan_enrollments`, handles "already have active plan" check (returns conflict; client confirms)
- `completeWorkout(enrollmentId, weekIndex, dayIndex, notes?)`
- `logSet(enrollmentId, weekIndex, dayIndex, exerciseIndex, setIndex, { reps, load, rpe, rir, notes })`
- `getEnrollmentProgress(enrollmentId)`

`src/lib/access.functions.ts`
- `currentMember()` — resolves `auth.uid()` → `app_members` row + active access levels
- `memberCanAccess(planId)` — checks plan's `required_access_level` against member's `member_access`

---

### 3. Stripe webhook updates

`src/routes/api/public/stripe-webhook.ts`:
- On `checkout.session.completed` / `invoice.paid`: look up `product_access_grants` for the offer. Branch by `account_type_granted`:
  - `coaching_client` → existing flow (unchanged)
  - `app_member` / `program_only` → upsert `app_members` row (match by email), insert/refresh `member_access` rows for each `access_level_key`, set `stripe_customer_id`, mark `status='Active'`. If member has no `user_id` yet, generate a `setup_token` so admin can copy/send the setup link.
- On `customer.subscription.deleted` / `invoice.payment_failed` (after retries): set member status to `Cancelled` / `Past Due`; mark related `member_access.active=false` at period end.
- On `customer.subscription.updated` (period end change): keep `member_access` aligned.

Webhook still uses `supabaseAdmin`; no client exposure.

---

### 4. Auth & routing

Add `/member-setup?token=...` (public) — verifies `setup_token`, lets user set password via `supabase.auth.updateUser`, links `app_members.user_id`.

Add a role-aware redirect right after sign-in on `/auth`:
- If user has an `app_members` row → redirect to `/m` (member portal)
- Else (existing path) → `/portal` (client) or `/admin` (admin)

New protected subtree: **`src/routes/_authenticated/m/`** (member portal)
- `route.tsx` — gate that requires an `app_members` row; redirects coaching clients to `/portal`
- `index.tsx` — dashboard: continue plan, my plans summary, access status, upgrade CTA
- `plans.tsx` — Plan Library (member view, filters: goal/style/duration/days/difficulty/equipment, locked badge for plans they can't access)
- `plans.$planId.tsx` — plan detail + Start Plan button
- `my-plans.tsx` — active + completed enrollments
- `my-plans.$enrollmentId.tsx` — week-by-week view, links to workouts
- `workouts.$enrollmentId.$week.$day.tsx` — workout view with completion + set logging
- `resources.tsx` — placeholder list (uses existing `resources` table filtered by access)
- `tools.tsx` — placeholder shell (links/cards admin can curate later)
- `account.tsx` — subscription status, password change, sign out

Admin side, additions under `src/routes/_authenticated/admin/`:
- `members.index.tsx` — App Members list with tabs: All / App Members / Program-Only / Prospects / Deactivated. Bulk actions: deactivate, archive, grant access.
- `members.$memberId.tsx` — member profile + access management + setup-link/reset-link controls + purchase history
- `members.new.tsx` — manual create App Member
- `member-plans.index.tsx` — Plan Library admin (Drafts / Published / Archived)
- `member-plans.$planId.tsx` — edit plan metadata + view frozen payload
- `member-plans.new.tsx` — create blank, or "Publish from Template", or "Publish from Block"
- Add `account_type_granted` + `access_level_keys` editors to existing offer/product admin pages

Update Admin Dashboard counts to separate Active Coaching Clients vs Active App Members vs Program-Only.

Sidebar (`src/lib/admin-nav.ts`): add "Members" group with App Members, Plan Library; keep Clients group for coaching.

---

### 5. Workout tracking UX

Member workout view mirrors the existing client workout view structure but reads from `member_plans.published_payload` (no live editing) and writes to `member_workout_completions` + `member_set_logs`. Tracking + logging fields show only when `member_plans.tracking_enabled` / `logging_enabled` is true. Mobile-first; same compact table layout as the coaching portal, but no coach-only sections.

Progress % = `workouts_completed / workouts_total`. On the last workout completion, mark enrollment `Completed`, move it from My Plans → Completed, show "Restart" + "Browse Library".

"Already have an active plan" guard on `startPlan` — returns a conflict that the UI handles with a confirmation modal (Continue / Switch / Start anyway).

---

### 6. Out of scope for this milestone

Resource upload UI, tools/calculators, "Apply for Coaching" CTA wiring, agreement-per-product enforcement for non-coaching products, announcements, analytics, multi-active-plans toggle, member-facing global search. These are Phase 3+ in your spec; we'll come back to them.

---

### 7. Build order

1. Migration (tables + RLS + seed access levels).
2. Server functions (`members`, `member-plans`, `access`).
3. Stripe webhook branch for member account types.
4. `/member-setup` + sign-in redirect logic.
5. Member portal routes (`/m/*`).
6. Admin: App Members list + profile + manual create + setup-link controls.
7. Admin: Plan Library + Publish-from-Template / Publish-from-Block actions.
8. Admin dashboard counts + sidebar grouping.
9. Smoke test the testing-requirements checklist from the spec.