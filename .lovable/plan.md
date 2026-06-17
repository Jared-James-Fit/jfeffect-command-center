
# JF Effect Progress Tracking — Build Plan

## What already exists (verified)

Routes, tables, and a 1,135-line `ProgressSection` component are already wired:

- **Tables:** `progress_submissions` (owner_type, client/member ids, assigned_coach_id, video_format, check_in_label, training_phase_id, bodyweight, review_status), `progress_media` (angle, drive sync status, retry_count), `progress_bodyweight`, `progress_measurements`, `progress_check_in_schedules`, `progress_review_responses`.
- **Routes:** `/portal/progress`, `/m/progress`, `/admin/clients/$id/progress`, `/admin/media-review`, plus legacy `/portal/progress-metrics` and `/portal/media`.
- **Component:** `ProgressSection` already implements Overview, Photos (4-angle upload), Videos (4-angle or continuous), Bodyweight, Measurements, Compare, Timeline, Submission detail w/ review responses, role-gated `canRequestReview`.
- **Lift Review pipeline reused via:** `uploadProgressFile` + `submitProgressForReview` + `retryProgressDriveSync` server fns and `progress-archive.server.ts` (Drive offload worker).
- **Admin nav** already lists Progress; cron worker `progress-archive-tick` exists.
- Data: 0 rows in new progress_* tables, 45 in legacy `progress_metrics`, 46 in `lift_videos`.

## What's missing vs the spec

1. **Water intake** — completely missing as a structured feature. Only exists as a free-text string on the nutrition target.
2. **Water-target auto-calculation** (bodyweight × 35 mL/kg, default 3.0 L) — missing.
3. **Profile/dashboard summary cards** for water + latest progress on client dashboard, member dashboard, admin client profile overview, admin member profile overview.
4. **Bodyweight source-of-truth consolidation** — `progress_bodyweight`, `progress_metrics.bodyweight`, and `member_bodyweight_logs` overlap. Need one read path.
5. **Member review eligibility** wired to `client_access_entitlements` so `canRequestReview` is real, not hard-coded `false`.
6. **Check-in flow integration** — attaching a progress submission to a manual check-in.
7. **Water reminders** + stop-after-target rule.
8. **Polish gaps:** consent flow (media marketing opt-in), empty states alignment, admin review queue filtering to exclude self-tracking members.

## Approach: extend the existing system, don't rebuild

Keep `ProgressSection`, `progress_submissions`, `progress_media`, `progress_bodyweight`, `progress_measurements`. Add water tables + water UI. Bridge legacy bodyweight rows through a read helper that unions the three sources but writes only to `progress_bodyweight` going forward.

---

## Phase 1 — Foundation (this turn)

### 1a. Database migration (one migration call, awaiting your approval)

New tables:

- `progress_water_targets(user_id PK, suggested_ml, active_ml, target_source enum[default|auto|user|coach|admin], calc_bodyweight_kg, calc_formula_version, mode enum[auto|custom], last_recalculated_at, set_by_user_id, created_at, updated_at)`
- `progress_water_entries(id, user_id, amount_ml int, entry_at timestamptz, entry_date date generated, source enum[quick_add|custom|check_in|admin|imported], note, created_at, updated_at)`
- `progress_consents(id, user_id, kind enum[marketing_photos|marketing_videos|testimonials], granted boolean, version, granted_at, revoked_at, created_by)`

GRANTs + RLS:

- water tables: owner read/write by `auth.uid()`; assigned coach + admin read/write via `has_role` and (for clients) the existing `assigned_coach_id` check used elsewhere.
- All values stored in mL (base unit). Display conversion in TS.
- Add `progress_submissions.linked_check_in_id uuid` if not present (it's already there — confirmed).
- Add `clients.water_target_locked_by_coach boolean default false` (so user can't override coach-set targets without confirmation).

Indexes: `progress_water_entries(user_id, entry_date desc)`, `progress_water_targets(user_id)`.

No destructive changes. `progress_metrics`, `member_bodyweight_logs` left untouched; a new read helper unions them for the trend chart.

### 1b. Water domain code (no UI yet)

- `src/lib/water.ts` — types, mL↔(L/oz) conversions, `suggestTargetMl(bodyweightKg)` clamped to 2000–5000 and rounded to nearest 100, default 3000.
- `src/lib/water.functions.ts` — `getWaterToday`, `addWaterEntry`, `undoLastWaterEntry`, `editWaterEntry`, `deleteWaterEntry`, `getWaterHistory`, `getWaterTarget`, `setWaterTarget({mode, customMl, setBy})`, `recalculateAutoTarget(userId)` (refreshes auto target only if Δbodyweight ≥ 2 kg). All `requireSupabaseAuth`-gated; admin/coach variants accept `targetUserId` and check role/assignment.
- `src/lib/bodyweight.ts` — `getLatestBodyweightKg(userId)` reads in priority: latest `progress_bodyweight` → latest `progress_metrics.bodyweight` → `clients.starting_bodyweight` → null. Single source for the water calc.

### 1c. Permissions / review eligibility

- `src/lib/progress-access.ts` — `canRequestProgressReview(ctx)` checks `client_access_entitlements` (status='active', tier includes 'reviews') for members; always true for coaching clients.
- Wire it into `/m/progress.tsx` (replace hard-coded `false`) and into the admin review queue filter so standard members never appear in the queue.

### 1d. Navigation & placement audit

- `Progress` already in portal + member nav — confirm and add to mobile primary nav if missing (≤2 taps).
- Add an admin route already exists; nothing to add.

---

## Phase 2 — Core user tools (this turn)

### 2a. Water UI components

- `src/components/progress/water-tracker-card.tsx` — compact "1.5 L of 3.0 L • 1.5 L remaining" card with quick-add chips (+250 / +500 / +750 / +1 L / Custom), Undo, target reached state, link to history. Mobile-first, tap targets ≥44px, neutral states (no red).
- `src/components/progress/water-history-sheet.tsx` — daily totals, target line, 7-day average, streak (target-reached days). No aggressive warnings.
- `src/components/progress/water-target-dialog.tsx` — toggle Auto / Custom, shows source badge (Suggested / Coach Set / Custom), "Use automatic suggestion" button, mL/L/oz input. Admin/coach version exposed inside admin client/member profile.
- Add a `Water` tab in `ProgressSection` and a Water row in Overview + Timeline (compact daily summary only, not per-entry).

### 2b. Bodyweight read consolidation

- Update `BodyweightTab` and the dashboard summary cards to read via `getCombinedBodyweightSeries(userId)` so legacy 45 `progress_metrics` rows continue to show the trend.
- New writes still go to `progress_bodyweight`. A trigger on `progress_bodyweight` insert calls `recalculateAutoTarget` (in SQL: simple update if mode='auto' and Δkg≥2).

### 2c. Dashboard & profile summary cards

- `src/components/progress/progress-summary-card.tsx` — used in:
  - Portal client dashboard (`/portal/index.tsx`)
  - Member dashboard (`/m/index.tsx`)
  - Admin client profile overview (`/admin/clients.$id.tsx`)
  - Admin member profile (`/admin/members.$memberId.tsx`)
  Shows: latest submission, latest bodyweight, today's water (with Add Water inline), next scheduled check-in, pending review badge, "Open Progress" button. Rows with no data are hidden.
- Reuse the same component, parametrized by `ctx`.

### 2d. Check-in integration

- In the existing portal check-in flow (`/portal/check-in.tsx`), add an optional "Progress" section that lists today's draft progress submission (if any) and exposes "Attach existing" / "Start new". Saves `linked_check_in_id` on the submission. Today's water + bodyweight surface inline.

### 2e. Member review-eligibility UX

- Member submission flow: when `canRequestReview` is false, primary button reads "Save to My Progress". When true, "Submit for Review" appears and shows tier source ("Included with your membership" / "Review credit available").

### 2f. Notifications hygiene

- Extend the existing notification dedupe to stop water reminders after the daily target is reached (unless `water_reminders_continue_after_target` is set on user prefs).

---

## Out of scope this turn (Phase 3+)

- Admin review queue page redesign (existing `progress-review-queue.tsx` already works; only adding the eligibility filter this turn).
- Paid-review purchase flow (foundation in place via `client_access_entitlements`, sale UI deferred).
- Media-consent capture UI (consent table created in Phase 1, capture screen Phase 3).
- Heavy gallery virtualization, batch admin tools, transformation marketing flows.

## Technical details

```text
Data flow for water:
quick-add tap → addWaterEntry server fn → insert progress_water_entries
  → invalidate ["water-today", userId] + ["water-history", userId]
  → after-insert: if target reached & has reminders, mark today done in notification_state

Auto target recalculation:
new progress_bodyweight row → after-trigger calls public.maybe_refresh_water_target(user_id)
  → if mode='auto' and |new_kg - calc_bodyweight_kg| >= 2 then update suggested_ml + active_ml
```

```text
File touch list (Phase 1–2):
  + supabase migration (1 call)
  + src/lib/water.ts
  + src/lib/water.functions.ts
  + src/lib/bodyweight.ts
  + src/lib/progress-access.ts
  + src/components/progress/water-tracker-card.tsx
  + src/components/progress/water-history-sheet.tsx
  + src/components/progress/water-target-dialog.tsx
  + src/components/progress/progress-summary-card.tsx
  ~ src/components/progress/progress-section.tsx        (add Water tab, water row in Overview/Timeline)
  ~ src/routes/_authenticated/m/progress.tsx            (canRequestReview from entitlements)
  ~ src/routes/_authenticated/m/index.tsx               (summary card)
  ~ src/routes/_authenticated/portal/index.tsx          (summary card)
  ~ src/routes/_authenticated/admin/clients.$id.tsx     (summary card)
  ~ src/routes/_authenticated/admin/members.$memberId.tsx (summary card)
  ~ src/routes/_authenticated/portal/check-in.tsx       (optional progress section)
  ~ src/components/progress/progress-review-queue.tsx   (filter ineligible members)
```

## Testing this turn

- Add water + undo + custom amount + edit + delete; verify entries land in `progress_water_entries` and today's total recomputes.
- Set auto target → log new bodyweight in kg → suggestion refreshes only if Δ≥2 kg.
- Set custom target as coach → user sees "Coach Set" badge and cannot silently overwrite.
- Member without entitlement sees "Save to My Progress" and never appears in admin review queue.
- Add an entitlement with tier='reviews' active → member sees "Submit for Review".
- Existing 45 `progress_metrics` bodyweight rows still render in the bodyweight chart.
- Lift Review uploads still work (no shared code touched).

## After Phase 2 you'll review, then Phase 3 = coaching review polish + scheduling + reminders + consent UI + admin queue page improvements.
