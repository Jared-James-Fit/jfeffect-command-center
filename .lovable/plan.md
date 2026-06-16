# Quick Apply for Coaching — Implementation Plan

## What already exists (reuse, do not duplicate)

- **CRM lead source of truth**: `clients` table + `upsertApplicantClient` in `src/lib/crm.functions.ts` (email/phone dedupe, conflict flag, activity log via `client_crm_activities`).
- **Applications**: `coaching_applications` table (41 cols incl. `client_id`, `appointment_id`, `booking_link_slug`, `lead_score`, `lead_temperature`, `application_status`, `summary`, `submitted_at`) + `submitCoachingApplication` server fn.
- **Public form**: `/coaching/apply` (current desktop-style long form — being replaced).
- **Booking**: `booking_links` + `/book/$slug` route + `appointments` table.
- **SMS**: Twilio integration via `src/lib/sms.functions.ts`, `sms-trigger.server.ts`, allowlist/dry-run controls in `sms_settings`.
- **Coaching offers**: `coaching_products` table (active offers loadable for Step 5).
- **Admin pages**: `/admin/sales/coaching-applications`, `/admin/settings/sms`, `/admin/crm.index`.
- **Org settings**: `app_settings` already holds `coaching_apply.booking_link_slug` and `coaching_apply.allow_cold_booking`.

I will extend these, not duplicate them.

## What I'll build

### Phase A — Public quiz UX (the bulk of the work)

Rewrite `src/routes/coaching.apply.tsx` end-to-end as a step-based mobile quiz:

- One question (or up to 3 tightly related) per screen, large tap-card answers, single-choice auto-advance, sticky Continue for multi-select / text steps, progress bar, Back button, session-only progress preserved in `sessionStorage`.
- Exactly two free-text boxes (`target_outcome`, `why_now`), 250-char limit each, char counter, voice-input compatible.
- Steps match the spec: 1 Main goal → 2 Desired result → 3 Biggest obstacle (with optional 80-char "other") → 4 Training (location, days/week, start timeline) → 5 Coaching fit (interest from live `coaching_products`, readiness, tracking, investment readiness — never asks for exact income) → 6 Why now (chips that prefill) → 7 Contact (name, mobile, email, optional IG, preferred channel, best time, **un-pre-checked** consent with Privacy/Terms links) → Final compact review with `Submit Application`.
- Mobile keyboards: `type="tel"`, `inputMode="email"`, `autocomplete` hints.
- Honeypot field + simple per-IP rate limit on the server fn (already runs through `supabaseAdmin`).

### Phase B — Coaching page CTAs

Add a shared `<ApplyForCoachingCTA />` button to `src/routes/coaching.tsx` in **four** positions (top hero, after explanation, near offers, near bottom) with supporting copy: "Answer a few quick questions, then book a call if coaching looks right for you." All link to `/coaching/apply`.

### Phase C — Server-side score rewrite + new fields

- Extend the `submitSchema` in `src/lib/coaching-applications.functions.ts` with new fields: `obstacle`, `obstacle_other`, `training_location`, `coaching_interest`, `readiness`, `tracking_willingness`, `investment_readiness`, `preferred_contact`, `best_time`, `consent_contact`, `why_now_tags[]`, `honeypot`.
- Reject if honeypot is filled; require consent boolean.
- Rebuild `scoreLead` to return **category scores** (goal/service fit, readiness, willingness, investment fit, urgency, contact completeness) totaling 0–100, plus an `explanation` array. Never reads protected traits.
- Migration adds the new columns + a `scoring` JSONB (category breakdown, version, explanation), `qualification_label` text, `consent_contact_at` timestamptz, `preferred_contact`, `best_time`, `obstacle`, `obstacle_other`, `training_location`, `coaching_interest`, `readiness`, `tracking_willingness`, `investment_readiness`, `application_source` (e.g. `quick_apply_v1`). Keeps legacy columns intact for back-compat.

### Phase D — Notification recipients

Migration: new `coaching_app_notification_recipients` table:
`id, name, role, phone, email, receive_application_sms, receive_booking_sms, receive_application_email, receive_booking_email, priority_only, paused, phone_verified_at, email_verified_at, created_at, updated_at`. RLS: admin-only; GRANTs included.

Seed two rows:
1. **Primary Admin** — reads phone/email from `app_settings` (`org.primary_phone`, `org.primary_email`); if absent, leaves blank with a TODO badge in the UI.
2. **Yannick Ring** — `+13435714378`, role "Media Manager / Team Member", application SMS on, booking SMS on, email off until set.

New admin page `src/routes/_authenticated/admin/settings_.notifications.coaching-applications.tsx`: list + add/edit/remove, pause toggle, priority-only toggle, "Send test SMS" / "Send test email" buttons (uses existing SMS allowlist/dry-run controls — no bypass), quiet-hours field, immediate-vs-digest selector.

### Phase E — Notify on submit + booking

- After successful insert in `submitCoachingApplication`, enqueue SMS + email to all matching recipients using the existing SMS/email infrastructure. Idempotency key: `coaching_app_submit:{id}` (prevents double-send on retry).
- SMS body never includes free-text answers — only: name, qualification label, score, main goal, start timeline, secure admin review link (`/admin/sales/coaching-applications#{id}`, authenticated).
- Email uses Lovable Emails: new template `coaching-application-admin.tsx` registered in `email-templates/registry.ts`.
- Booking notification: when an appointment is created against a coaching application (detect via `appointment.application_id`), fire `coaching_app_booked:{appt_id}` SMS + email to recipients with `receive_booking_*` on.

### Phase F — Post-submission booking screen

Replace current `<Success>` with a dominant **Book Your Call** screen:
- Compact "Application received" hero, single big red `Book Your Call` button, quieter `Finish Without Booking` link.
- On click, push to existing `/book/$slug` with prefilled contact via query params (`?name=…&email=…&phone=…&application_id=…`). `book.$slug.tsx` already exists — I'll extend it to read those params, skip the name/email/phone step, and stamp `appointments.application_id` + `coaching_applications.appointment_id` + move CRM stage to "Call Booked" on confirm.
- Confirm button label: **"Confirm & Book Call"** (not "Submit").
- On failure: keep application saved, show retry, log `call_status='not_booked'`.

### Phase G — Admin enhancements

- `/admin/sales/coaching-applications` list: add columns Score, Qualification, Goal, Start, Coaching interest, Preferred contact, Call status, Appt time, Assigned, Stage, Follow-up; filters + CSV export.
- Application detail panel: quick actions (Call / Text / Email / Send Booking Link / Book For Lead / Reschedule / Assign / Create Follow-Up / Convert to Client / Close); shows score breakdown from `scoring` JSONB.
- Admin home cards: "New Coaching Applications" (unreviewed count) and "Calls Booked" (last 7d) added to `/admin/index.tsx`.

### Phase H — Acceptance verification

Run the spec's acceptance tests via Playwright (mobile viewport): full quiz under 120s, double-tap no duplicate, abandoned booking preserves application, booking does not re-ask for contact, SMS/email queued, no protected-trait inputs.

## Out of scope (call out)

- Round-robin assignment (spec says "if supported later") — recipients table includes `role` for future use, but Jared remains the default assignee.
- Marketing-style nurture sequences — only the one configurable reminder for "submitted but not booked" is included.
- Editing the existing `book.$slug` time-slot picker visual design beyond prefill — only adds query-param prefill and application linking.

## Technical details

- Migrations: 1 file adding new application columns + `coaching_app_notification_recipients` (with GRANTs, RLS admin-only, service_role full).
- New files (~10): mobile quiz component split (`src/components/coaching-apply/*` — step container, progress bar, card-answer, review), notification-recipients page + server fns, email template, score-breakdown helper, admin home metric cards.
- Modified files (~6): `coaching.apply.tsx`, `coaching.tsx`, `coaching-applications.functions.ts`, `book.$slug.tsx`, `sales.coaching-applications.tsx`, `admin/index.tsx`, `email-templates/registry.ts`, `start.ts` (no change expected — `attachSupabaseAuth` already wired).
- SMS path: continues to use existing dry-run / allowlist; submission alerts are queued, not sent inline, to satisfy the "save first, notify after" rule.
- All `coaching_applications` writes stay through the existing server fn; no new write paths.
- Single-question screens use auto-advance with 180 ms delay so users see their selection animate before transition.
- Estimated build: ~15 file changes, 1 migration, ~1200 LOC net.

## Approval

This is a big surface area. If you approve as-is I'll execute end-to-end in one go and come back with the completion report (screenshots, test results, files changed, DB changes, recipient list). If you want to slice it — e.g., ship Phases A+B+F (the user-facing quiz + CTAs + booking screen) first, then C–G as a follow-up — say the word and I'll do that instead.
