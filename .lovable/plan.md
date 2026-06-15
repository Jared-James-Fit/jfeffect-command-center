## Goals & Setup — Client Profile Section

A new mobile-first questionnaire surfaced on every client profile, plus a coach-facing summary panel, private notes, and change notifications. Existing programs, workouts, and nutrition targets stay untouched.

---

### 1. Data model (one migration)

New tables, all RLS-enabled with GRANTs:

- `client_goals_setup` — one row per client, stores all answers as structured columns + JSONB for multi-select lists.
  - `client_id` (FK clients, unique)
  - `main_goal` (enum-ish text), `main_goal_other` (text)
  - `goal_target` (text)
  - `training_days_per_week` (int 2–6)
  - `available_weekdays` (text[]) — mon..sun
  - `workout_length_minutes` (int)
  - `training_experience` (text)
  - `training_styles` (text[])
  - `training_location` (text)
  - `equipment` (text[]) — flat for single location
  - `equipment_by_location` (jsonb) — `{ locationLabel: string[] }` when multi-location
  - `nutrition_goal` (text)
  - `nutrition_preference` (text)
  - `food_restrictions_has` (bool), `food_restrictions_details` (text)
  - `nutrition_challenges` (text[]) — max 3 enforced in app + trigger
  - `injuries_has` (bool), `injuries_details` (text)
  - `final_notes` (text)
  - `completed_at`, `updated_at`, `last_reviewed_at`, `last_reviewed_by`
  - `update_requested_at`, `update_requested_by`

- `client_goals_setup_notes` — private coach notes (never visible to client).
  - `id`, `client_id`, `author_id`, `body`, `created_at`

- `client_goals_setup_audit` — change history (which fields changed, when, by whom). Powers coach notifications.

- Trigger: after update of notify-worthy columns (main_goal, training availability, equipment/location, injuries, nutrition_goal, food_restrictions, goal_target [for competition date]) → insert a row in existing `tasks` (or `coach_followups`) for the assigned coach.

RLS:
- `client_goals_setup`: client can SELECT/INSERT/UPDATE their own row; assigned coach + admin via existing `has_role` / coach-of-client check.
- `client_goals_setup_notes`: coach + admin only — no client policy.
- `client_goals_setup_audit`: coach + admin SELECT only.

### 2. Server functions (`src/lib/client-goals/goals.functions.ts`)

- `getClientGoalsSetup({ clientId })` — coach/admin or self.
- `upsertClientGoalsSetup({ clientId, patch })` — partial save (Save & continue later). Validates with zod. Writes audit rows for changed fields. Triggers notifications via DB trigger.
- `markGoalsReviewed({ clientId })` — coach/admin only.
- `requestGoalsUpdate({ clientId, message? })` — coach/admin only; sets `update_requested_at`, creates a client action request.
- `listGoalsNotes({ clientId })` / `addGoalsNote({ clientId, body })` — coach/admin only.

All use `requireSupabaseAuth`; role checks via `has_role` and the existing coach-of-client helper.

### 3. UI — client side (mobile-first)

Route: `src/routes/_authenticated/portal/goals-setup.tsx`

- Stepped flow (7 steps matching the spec): Goals → Training Availability → Experience → Gym/Equipment → Nutrition → Injuries → Final notes.
- Big tap targets, single-select chip grids, multi-select chip grids, weekday pills, length slider-as-chips.
- Sticky bottom bar: **Back / Save & continue later / Next**. Each step autosaves on Next.
- "Other" reveals a small text input inline.
- Multi-location: if `training_location = "Multiple locations"`, show "Add location" rows, each with its own equipment chip grid → saved to `equipment_by_location`.
- Entry point on portal dashboard:
  - If incomplete → prominent **Goals & Setup incomplete** card linking to the flow.
  - If complete → "Update Goals & Setup" link in `/portal/account`.

### 4. UI — coach side

New tab on the client profile: **Goals & Setup**
File: `src/components/clients/goals-setup-panel.tsx`, mounted from the existing client profile route.

Top: **Client Profile Summary** card (read-only chips/rows) showing every field listed in the spec + last updated date.

Buttons:
- **Edit** → opens the same stepped flow in a sheet, prefilled (coach can edit on client's behalf).
- **Request client update** → opens dialog with optional message; calls `requestGoalsUpdate`.
- **Mark reviewed** → calls `markGoalsReviewed`; shows reviewer + timestamp.
- **Add private coach note** → inline composer, list of past notes below.

Injuries are rendered with a `warning` badge when `injuries_has = true`.

### 5. Onboarding integration

- Add a "Goals & Setup" step to the existing client onboarding flow (non-blocking — they can skip and finish later).
- For existing clients (no row in `client_goals_setup`): no forced redirect; profile summary shows **"Goals & Setup incomplete"** with a CTA.

### 6. Equipment-aware warnings (hook only, no behavior change to existing data)

- Export a helper `useClientEquipmentSet(clientId)` returning the union of equipment across locations.
- Wire a non-blocking warning chip in the program planner's exercise picker when an exercise has a required-equipment tag missing from the client's set. Existing programs/workouts/targets remain untouched.

### 7. Files (new / edited)

**New**
- `supabase/migrations/<ts>_client_goals_setup.sql`
- `src/lib/client-goals/goals.functions.ts`
- `src/lib/client-goals/schema.ts` (zod + option constants)
- `src/components/client-goals/GoalsSetupFlow.tsx` (stepped flow, shared client + coach edit)
- `src/components/client-goals/steps/*.tsx` (one per step)
- `src/components/client-goals/GoalsSummaryCard.tsx`
- `src/components/clients/goals-setup-panel.tsx` (coach tab content)
- `src/routes/_authenticated/portal/goals-setup.tsx`

**Edited**
- Client profile route → add "Goals & Setup" tab.
- Portal dashboard → add incomplete CTA card.
- `src/routes/_authenticated/portal/account.tsx` → "Update Goals & Setup" link.
- Onboarding flow → add optional Goals & Setup step.

### 8. Out of scope (confirming)

- No changes to existing assigned programs, scheduled workouts, completed workouts, or nutrition targets.
- No automatic regeneration of plans from these answers — coach-facing summaries, filters, and warnings only.

---

### Questions before I build

1. **Coach notifications**: do you want change-notifications to land in the existing **Tasks** queue, in **Coach followups**, or as a chat DM to the assigned coach? (Default plan: a Task assigned to the coach.)
2. **"Request client update"**: should this also trigger an email/SMS to the client, or only show as an in-app banner in their portal? (Default plan: in-app banner + existing notification system, no email.)
3. **Multi-location equipment**: ok to ask for short location labels ("Home", "Hotel gym", etc.) per location, or do you want a fixed list?

I'll proceed once you confirm or pick options.
