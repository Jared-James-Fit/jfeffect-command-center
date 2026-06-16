
# Goals & Setup Fix + "Never Trap the User" Refactor

## What's actually broken today (evidence)

`src/routes/_authenticated/portal/route.tsx` stacks **four full-screen hard-lock gates** around `<Outlet />`:

```
ClientProfilePictureGate
 └ ClientBasicInfoGate
    └ ClientTrainingScheduleGate
       └ ClientGoalsSetupGate   ← Goals & Setup lives here
          └ Outlet (Workouts, Messages, Account, …)
```

Each gate renders `<div className="grid min-h-[calc(100vh-4rem)] place-items-center">` with no exit, no "later", no skip — exactly what the brief calls out. Until the gate's row passes its completeness check, the entire portal (Workouts, Messages, Account, Sign Out) is unreachable. `FormPopupGate`, `LegalAcceptanceGate`, `HomeScreenSetupGate`, `BroadcastPopupGate`, `EventPopupGate` also auto-open on top.

### Finish bug — most likely root cause

`GoalsSetupFlow.tsx` hydrates `local` from the DB row, then on Finish sends the **entire local object** (including DB-only fields like `id`, `client_id`, `created_at`, `updated_at`, `last_reviewed_at/by`, `update_requested_at/by/message`) through `saveGoalsSetupFn`. The server uses `clientGoalsSetupSchema.partial().extend({ completed })` and `.parse()` — zod strips unknown keys, so those pass through. But the array columns (`available_weekdays`, `training_styles`, `equipment`, `nutrition_challenges`) are typed `.optional()` without `.nullable()`. When the DB returns `null` for any of them (older rows do), zod throws a validation error on Finish. The thrown error is shown via `toast.error(e?.message)` but the modal stays open and the gate never releases → "Finish does nothing."

We'll confirm with browser/Playwright + a DB read of a stuck row before changing schema.

## Scope

1. Reproduce + fix the Goals & Setup Finish bug.
2. Convert every account-level hard-lock gate to a soft Home checklist + dismissable banner. No setup form may block the portal.
3. Audit all auto-opening popups; document each as non-blocking, action-gated, or removed.

Out of scope this turn: redesigning legal/payment/safety logic itself, performance pass items still on the queue.

## Plan

### 1. Reproduce the Finish bug (evidence)
- Read a stuck `client_goals_setup` row via DB to confirm null array columns.
- Drive Playwright against the preview, click Finish on Step 7 with empty Final Notes, capture console + network for `saveGoalsSetupFn`.

### 2. Fix Goals & Setup save/finish
- **`src/lib/client-goals/schema.ts`** — make array columns `.nullable().optional()` (`available_weekdays`, `training_styles`, `equipment`, `nutrition_challenges`); accept `equipment_by_location: …nullable()`. `final_notes` already `.trim().nullable().optional()` — keep, ensure empty string → `null` before send.
- **`src/components/client-goals/GoalsSetupFlow.tsx`** —
  - Only send a clean whitelist of editable fields (drop `id`, `client_id`, timestamps, audit fields).
  - Trim `final_notes`, `goal_target`, `injuries_details`, `food_restrictions_details`; coerce empty → `null`.
  - Wrap `finish()` in try/catch; on error keep all answers, re-enable button, show retry / save-later / contact-coach actions.
  - Disable Finish while pending; ignore double taps (mutation `isPending` guard already there — also add `idempotencyKey` not needed since upsert by `client_id`).
  - On success: invalidate gate queries, close, toast "Setup complete — you're ready to go", redirect to Workouts if assigned else Home (caller-provided `onComplete`).
- **`src/lib/client-goals/goals.functions.ts`** — sanitize patch server-side too (whitelist), log raw error server-side, return a safe message. Keep `service_role` upsert.

### 3. Convert account gates to soft Home banners (the "never trap" change)
Replace the four blocking wrappers in `src/routes/_authenticated/portal/route.tsx` with a single non-blocking `<SetupChecklistBanner />` rendered on Home:

- `ClientProfilePictureGate` → remove gate; surface as checklist item ("Add a profile photo") and a small badge on Account.
- `ClientBasicInfoGate` → remove gate; checklist item ("Confirm basic info") linking to Account.
- `ClientTrainingScheduleGate` → remove gate; checklist item.
- `ClientGoalsSetupGate` → remove gate; checklist item with progress ("5 of 7 steps complete"), opens `/portal/goals-setup`.

New file `src/components/portal/setup-checklist-banner.tsx`:
- Card on Home only (not other routes).
- Shows items with status `Not Started | In Progress | Completed | Save Failed`.
- Buttons: **Continue Setup**, **Remind Me Later** (persists 24h dismiss in `localStorage` per item: `jf:setup-snooze:<key>`).
- Once all complete → banner hidden permanently.

Removed `<ClientGoalsSetupGate>` etc. from the layout — keep their underlying queries reusable by the banner. Files kept but no longer wrap `<Outlet />`; can be deleted in a follow-up.

### 4. Soften the other auto-popups (audit table)
| Popup | Today | After |
|---|---|---|
| Goals & Setup | Hard lock | Soft Home card + `/portal/goals-setup` page (already exists) |
| Profile Picture | Hard lock | Checklist item |
| Basic Info | Hard lock | Checklist item |
| Training Schedule | Hard lock | Checklist item |
| Home Screen Setup | Auto-modal | Already dismissable — verify Skip is visible; do not re-open every nav |
| Form popups (`FormPopupGate`) | Auto-modal | Keep, but add **Remind me later** (24h) and never re-open mid-workout route (`/portal/workouts/*`) |
| Legal Acceptance | Modal | Action-gate only — allow Home/Messages/Account/Sign Out; restrict the specific paid action. Out of scope to redesign deeply; ensure portal not blocked, document follow-up. |
| Broadcast / Event / Birthday popups | Auto-modal | Verify each has a visible Close and per-user dismiss; no change to logic this pass. |

### 5. Acceptance checks (Playwright evidence)
- Finish works with empty Final Notes.
- Finish works with "No".
- Failed save preserves answers + offers Retry / Continue Later / Contact Coach + portal stays reachable.
- Save & Continue Later closes form and returns to Home; resume from same step.
- With incomplete Goals & Setup, screenshots prove Workouts / Messages / Account / Sign Out are reachable.
- Refresh + sign-out/sign-in: completion persists.
- DB query confirms one `client_goals_setup` row per client (no duplicates) after double-tap Finish.

## Files I will touch

Create:
- `src/components/portal/setup-checklist-banner.tsx`

Edit:
- `src/lib/client-goals/schema.ts` — nullable array fields
- `src/lib/client-goals/goals.functions.ts` — whitelist + safer error
- `src/components/client-goals/GoalsSetupFlow.tsx` — clean patch, safe finish, redirect, retry UI
- `src/routes/_authenticated/portal/route.tsx` — remove 4 hard-lock wrappers, mount banner on Home only
- `src/routes/_authenticated/portal/index.tsx` — render `<SetupChecklistBanner />`
- `src/components/form-popup-gate.tsx` — add Remind Me Later (24h) + route-aware suppression on workout routes

Leave intact: legal acceptance logic, agreements tables, payments, all DB schema (no migrations needed — schema fix is in zod/code only), notifications, design system, routes, role permissions.

## Risks / decisions to confirm

1. **Legal Acceptance** — brief says "do not blindly make legal optional." I'll leave the existing legal gate alone for now and only note it in the audit; if you want action-level gating refactored, that's a separate pass.
2. **Profile picture / basic info / training schedule** — fully soft-gating these means a new member can reach Workouts before filling them in. Confirm that's acceptable (the brief explicitly says yes — "always be able to access workouts").

Reply **Approve** to implement, or tell me what to change.
