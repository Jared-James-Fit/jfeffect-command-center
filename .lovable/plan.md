## Goal

Replace the scattered client-facing nutrition pages with a single consolidated Nutrition dashboard. Add a coach approval gate for targets, three logging methods, and weekly trends + water/supplements tracking.

## What it includes

**Client dashboard (`/m/nutrition`)** — one page with these sections:
1. **Daily macros** — calories, protein, carbs, fat with progress bars vs target. Only shown after a coach has approved the target.
2. **Meal log timeline** — chronological list of today's meals with edit/delete and a date picker for past days.
3. **Weekly trends** — 7/30-day adherence chart (% target hit) and bodyweight trend line, sourced from existing `member_bodyweight_logs`.
4. **Water + supplements** — quick-tap counters with daily goals; uses existing `progress_water_entries` / `progress_water_targets` and a new `member_supplement_logs` table.

**Three logging methods** on the same "Log food" sheet:
- Quick presets — pick from saved meals (new `member_meal_presets` table).
- Manual entry — type calories + macros directly.
- AI text parse — "2 eggs and toast" → macros via Lovable AI Gateway (Gemini), shown for confirm/edit before save.

**Targets flow (auto → coach approval → client)**
1. Auto-calc on the client: Mifflin-St Jeor TDEE from `clients` (sex, age, height, weight, activity) + goal offset (cut/maintain/bulk → -500/0/+300 kcal), macro split (protein g/kg, fat 25% kcal, carbs remainder).
2. Result lands in a `member_nutrition_targets_pending` queue with `status='pending'`, NOT visible to client.
3. Coach reviews on `/admin/nutrition-dashboard`: approve as-is, edit then approve, or assign their own. On approve, write to existing `member_nutrition_targets` (active) and mark pending row `approved`.
4. Client dashboard reads only active approved targets — if none, shows "Your coach is reviewing your targets" placeholder.

**Replace existing pages** — these become redirects to `/m/nutrition`:
- `_authenticated/m/nutrition.targets-setup.tsx`
- `_authenticated/m/nutrition.targets-manage.tsx`
- `_authenticated/portal/nutrition-targets.tsx`
- `_authenticated/m/nutrition.tsx` (rebuilt as the new dashboard)
- Recipe detail (`m/nutrition.$recipeId.tsx`) is kept; surfaced via "Saved recipes" link.

Admin tools (`/admin/nutrition-dashboard`, `/admin/nutrition-targets`, `/admin/settings_.nutrition-automation`) stay; the review page gains the new approval action.

## Technical

**DB migrations (one batch)**
- `member_meal_logs` — id, client_id, logged_at, name, calories, protein_g, carbs_g, fat_g, source enum('preset'|'manual'|'ai'), preset_id nullable, raw_text nullable. RLS: client owns rows; coach (admin role) can read. GRANT to authenticated + service_role.
- `member_meal_presets` — id, client_id, name, calories, macros, created_at. Same RLS shape.
- `member_supplement_logs` — id, client_id, supplement_name, taken_at, dose. Same RLS.
- `member_supplements` (config) — id, client_id, name, daily_target_count, active.
- `member_nutrition_targets_pending` — id, client_id, computed_kcal, protein_g, carbs_g, fat_g, inputs jsonb, status enum('pending'|'approved'|'rejected'), reviewed_by, reviewed_at, note. RLS: client read own pending; admin read+update all.
- All tables: `ENABLE RLS` + `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO authenticated; GRANT ALL TO service_role;` per project rules.

**Server functions** (`src/lib/nutrition.functions.ts`, all with `requireSupabaseAuth`):
- `computeAndQueueTargets({ data: { clientId } })` — runs Mifflin-St Jeor, writes pending row.
- `logMeal`, `updateMeal`, `deleteMeal`.
- `parseMealFromText({ data: { text } })` — Lovable AI call returning `{name, calories, macros}` JSON.
- `getDashboard({ data: { date } })` — returns active target, today's logs, water + supps, 7/30-day trend aggregates. Primes TanStack Query.
- Admin: `approveTargets`, `rejectTargets`, `assignTargets`.

**Route shape**
- `_authenticated/m/nutrition.tsx` becomes the dashboard (loader uses `ensureQueryData` + `useSuspenseQuery`).
- Other client nutrition routes: replace component body with `<Navigate to="/m/nutrition" replace />` (and keep file so old links don't 404).

**UI**
- Sections as Cards in a single scrollable column on mobile, 2-col grid on desktop.
- Reuse existing chart components from `progress` pages where possible.
- "Log food" opens a Sheet with three tabs (Presets / Manual / AI).

## Out of scope (this pass)

- Barcode scan, photo recognition, macro goals per meal (breakfast/lunch split).
- Notifications when coach approves targets — added if you want, but defaults to in-app only.

Approve and I'll build it end-to-end.