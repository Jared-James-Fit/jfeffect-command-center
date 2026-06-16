## Goal

Collapse the overlapping **Overview** and **Account** top-level sections of the admin client profile into a single **Client Profile** section, reorganized into 5 clear sub-tabs with large touch targets and proper mobile/iPad layouts. Preserve every existing field, action, modal, and permission.

## Top-level sections (after change)

```text
Client Profile   Training   Nutrition   Communication   Business
```

`Account` is removed as a top-level tab; all of its functionality lives under Client Profile → Login & Access / Personal Info.

## Client Profile sub-tabs

Rendered as large icon + title + description cards (same visual language as the current top-level `SectionNav`), not small text tabs:

1. **Overview** — read-only snapshot + quick actions
2. **Personal Info** — identity, contact, personal details, address, emergency contact, profile picture
3. **Goals & Intake** — intake answers, goals, training prefs, injuries, equipment, OpenPowerlifting / best lifts, "anything else"
4. **Coaching Setup** — coach, status, package, phase, start/renewal dates, payment-status summary, schedule, Drive folder, quick links, billing-source summary
5. **Login & Access** — everything currently on the Account tab (invite, reset, SMS links, set password, mark setup complete, needs-admin-help, deactivate/reactivate summary)

URL search-param `tab` values stay backward-compatible (existing `summary`, `goals-setup`, `info`, `account` continue to resolve), so deep links from elsewhere in the app keep working. New canonical values: `overview`, `personal`, `goals`, `coaching`, `login`.

## Overview redesign

- Header strip: avatar, name, email, phone, assigned coach badge, status badge, package, current program, training schedule summary
- App activity card and profile-completion / missing-info card (re-uses existing `AppActivityCard` + completion data already on `form`)
- **Quick actions** as 48–52px buttons: Open Client POV · Message Client · Manage Schedule · View Intake · Request Client Update · Assign Program
- **No editable form fields** here. Where a value is missing, show an action button instead of a dash (e.g. "Add coaching package" → jumps to Coaching Setup; "Assign coach" → opens AssignedCoachSelect inline; "Send setup link" → fires existing `sendSetup`)

The current Overview "Profile" giant edit grid (full_name, email, phone, instagram, dates, package, coach, status, payment status, all the call/SMS access switches) moves into the appropriate edit cards under Personal Info, Coaching Setup, and Communication. The switches for call/SMS access stay reachable from Communication (already exists) — Overview only links to them.

## Personal Info redesign

Single column of section cards, each with a large **Edit** button that opens an inline editor (Save / Cancel pinned to the bottom of the card via `sticky bottom-0`, with unsaved-changes guard):

- **Identity** — first_name, last_name, preferred_name, profile picture (re-uses `ProfilePictureCapture` + `adminUpdatePicture`)
- **Contact Information** — email, phone (single source of truth — same `form.email` / `form.phone` that everything else reads)
- **Personal Details** — date_of_birth, height_cm + preferred_height_unit, timezone
- **Address** — address, city, province, postal_code, country
- **Emergency Contact** — emergency_contact_name, emergency_contact_phone
- **Profile-info metadata strip** — last update, updated-by, fields updated, picture updated, timezone confirmed, basic-info completed, "Request Profile Info Update" button (existing `requestUpdate` / `clearUpdateRequest`)

This replaces the current `BasicInfoForm` wall and the duplicated email field on the Overview tab. The underlying fields are unchanged; we only re-shell them.

## Goals & Intake

- Keep the existing `GoalsSetupPanel` (currently `goals-setup` tab) — it already groups intake / goals / training prefs
- Move `PowerlifterSection` (best squat/bench/deadlift + OpenPowerlifting) here from the Overview right column
- Top of tab: large buttons — **View Intake Answers** (re-uses `IntakeAnswersBigButton`), **Request Client Update**, **Edit Goals**

## Coaching Setup

Pulled out of the current Overview right column + edit grid:

- Assigned coach (`AssignedCoachSelect`)
- Client status (`STATUSES` select)
- Coaching package, program phase, start date, renewal date
- Payment status summary + link to Business → Billing
- `TrainingScheduleCard` + large **Manage Schedule** button → `/admin/clients/$id/schedule`
- `ClientQuickLinksCard` (Drive folder + other quick links)
- Billing & Legacy Migration summary card (existing block at lines 811–850)

Detailed billing/messaging controls stay where they already live (Business / Communication) — we only show summaries here.

## Login & Access

Direct lift of the current `account` tab content (lines 1127–1175). No functional change — just the new home and a touch-friendly grid for the action buttons (two columns on mobile, four on desktop, all 44px+ tall). `SetupStatusBanner` continues to render above the tabs (unchanged).

## Mobile / iPad layout rules

- Sub-tab strip: horizontal scroll-snap row of 5 large cards on phones, 2-column grid on iPad portrait, single-row on iPad landscape and desktop
- All edit panels use single-column inputs on `< md`, two-column on `md+`
- Save/Cancel use `sticky bottom-2` inside the editing card with `safe-area-inset-bottom` padding so they stay above the iOS keyboard
- Inputs get correct `inputMode` / `type` (email, tel, numeric, date)
- No horizontal scroll: replace existing `md:grid-cols-3` overview grid with a CSS grid that collapses to single column under 768px and verifies no fixed widths

## Files touched

- `src/routes/_authenticated/admin/clients.$id.tsx` — restructure `SECTIONS`, `TAB_VALUES`, `TAB_TO_SECTION`; replace `summary` / `info` / `account` `TabsContent` blocks with new `overview` / `personal` / `goals` / `coaching` / `login` blocks; keep `training` / `nutrition` / `cardio` / `metrics` / `messages` / `lift-videos` / `documents` / `sessions` / `purchases` / `billing` / `agreements` / `notes` untouched
- New small components under `src/components/admin/client-profile/`:
  - `OverviewSnapshot.tsx` — header strip + missing-info actions
  - `EditableCard.tsx` — shared card shell with view-mode / edit-mode / sticky save / unsaved-changes guard
  - `IdentityCard.tsx`, `ContactCard.tsx`, `PersonalDetailsCard.tsx`, `AddressCard.tsx`, `EmergencyContactCard.tsx`
  - `CoachingSetupPanel.tsx` — wraps existing `AssignedCoachSelect`, `TrainingScheduleCard`, `ClientQuickLinksCard`, billing-source block
  - `LoginAccessPanel.tsx` — extraction of current `account` tab JSX
- `src/routes/_authenticated/admin/account.tsx` — leave file as-is (it's already a 34-line standalone route, not the top-level tab); top-level admin nav reference to "Account" tab (if any in `clients.$id.tsx` SECTIONS) is removed

## Data-safety guarantees

- No SQL migration, no edge function change, no schema change
- All reads/writes go through the existing `form` state and existing `save` / `saveAccountInfo` / per-field Supabase update calls
- Fields shown on the new cards are exactly the existing fields (`first_name`, `last_name`, `preferred_name`, `email`, `phone`, `date_of_birth`, `height_cm`, `preferred_height_unit`, `timezone`, `address`, `city`, `province`, `postal_code`, `country`, `emergency_contact_name`, `emergency_contact_phone`) — single source of truth preserved
- Existing deep links (`?tab=account`, `?tab=info`, `?tab=summary`, `?tab=goals-setup`) keep working via a redirect map to the new tab values
- All existing buttons, modals (delete, deactivate, reactivate, set-password, send-reset, send-link-sms, etc.) are preserved

## Verification

After build, drive Playwright at the live preview for one client:
- Desktop: load `/admin/clients/<id>`, screenshot each of the 5 sub-tabs
- Mobile (375×812): screenshot each sub-tab + one Edit-mode card with Save/Cancel pinned
- iPad portrait (834×1194) and landscape (1194×834): screenshot Overview + Personal Info Edit mode
- Verify console has no errors, no horizontal scroll on mobile
