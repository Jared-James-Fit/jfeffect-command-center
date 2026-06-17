## Audit summary (existing systems to reuse)

Found existing infrastructure — will extend, not duplicate:

- **Public coaching page**: `src/routes/coaching.tsx`
- **Existing application form**: `src/routes/coaching.apply.tsx` + `src/routes/apply.tsx`
- **Application server fns**: `src/lib/coaching-applications.functions.ts`
- **DB table**: `coaching_applications` (58 cols — already has scoring, lead temp, contact fields)
- **CRM**: `clients` + `crm.functions.ts` + admin CRM contacts pages
- **Admin app list**: `src/routes/_authenticated/admin/sales.coaching-applications.tsx`
- **Notification recipients UI**: `src/routes/_authenticated/admin/settings_.notifications.coaching-applications.tsx` + `coaching_app_notification_recipients` table
- **SMS**: `sms_automations`, `sms_settings`, `sms_log`, `src/lib/sms-trigger.server.ts` (with dry-run/allowlist safety modes)
- **Email**: Lovable email queue + transactional system
- **Booking**: `booking_links` table, `appointments` table, `src/lib/booking-links.functions.ts`, public `book.$slug.tsx` page

## Scope

This is a multi-week build (public quiz UX rewrite + admin lead-pipeline integration + booking embed + notifications + scoring config UI + acceptance tests). Given the credit-cost of doing all of this in one pass, I'll deliver it in **4 sequential phases** so you can verify each before paying for the next.

### Phase 1 — Public quiz-style application (highest user-visible impact)
Rewrite `coaching.apply.tsx` as a true mobile-first one-question-at-a-time quiz with:
- Big tap cards, auto-advance, sticky Continue, progress bar, back, session-preserved state
- Exact 7-step flow you specified, only 2 short-answer (250 char) fields + name/phone/email/IG
- Reuses existing `coaching_applications` insert via `submitCoachingApplication` server fn (extend it for the new fields: obstacle, training_location, days_per_week, support_type, readiness, tracking_willingness, investment_readiness, why_now, best_contact, best_time, consent)
- Adds CTAs to `coaching.tsx` (top/middle/pricing/bottom)
- Post-submit success screen with dominant "Book Your Call" → embedded booking step (reuses `booking_links` slot picker, prefills name/phone/email, no re-entry)
- "Finish Without Booking" path keeps application saved + marks lead `call_not_booked`
- Honeypot + server-side rate-limit (per-IP) + Zod validation

### Phase 2 — Scoring engine + lead pipeline wiring
- `compute_application_score(application_id)` SQL function: 6 categories (goal/start/process/investment/urgency/contact), 0–100, no protected traits, version-stamped, stored on row + per-category JSON breakdown + label
- Trigger fires on insert/update of relevant fields
- On submit: upsert into `clients` (CRM lead) by email/phone dedupe; link `client_id` back to application; previous applications visible via `client_id` history
- On successful booking: move CRM lead stage → `Call Booked`, link `appointment_id`
- Admin settings page to edit weights/thresholds/labels (writes to `app_settings`)

### Phase 3 — Admin surface + notifications
- Extend `sales.coaching-applications.tsx` list: search/sort/filter by score/qualification/stage/call status/assignee/follow-up; CSV export; call-status badges
- New detail page `sales.coaching-applications.$id.tsx`: full applicant view, score explanation, quick actions (Call/Text/Email/Send Booking Link/Book For Lead/Reschedule/Assign/Convert/Close), booking history, notification history, previous applications
- Admin homepage metrics: "New Coaching Applications" + "Calls Booked" + priority list
- Wire `application_submitted` SMS automation trigger + ensure Yannick Ring (+13435714378) is seeded in `coaching_app_notification_recipients` with application+booking SMS on, email off
- Wire `application_booked` trigger; reuse existing dry-run/allowlist safety modes (no bypass)
- Email confirmation (transactional, applicant) + admin notification email
- Idempotency keys on notification sends to prevent dup on retries

### Phase 4 — Acceptance tests + polish
- Playwright smoke: full mobile flow ≤120s, double-tap dedupe, two-tab race for same slot, dedupe lead by email, abandoned booking leaves lead in `Review Needed`
- DB constraints: unique appointment per (application_id, status='booked'), unique notification by idempotency_key
- RLS audit on `coaching_applications`, `appointments` created here, `coaching_app_notification_recipients`
- Final completion report with screenshots

## Technical notes

- Schema additions to `coaching_applications` (additive, non-breaking): `obstacle`, `obstacle_other`, `training_location`, `days_per_week`, `start_timeline`, `support_type`, `readiness`, `tracking_willingness`, `investment_readiness`, `why_now`, `best_contact_method`, `best_contact_time`, `consent_contact_at`, `score_breakdown jsonb`, `score_version int`, `qualification_label`, `call_status`, `appointment_id uuid`, `client_id uuid`, `submission_ip`, `honeypot_value`
- Booking: extend `appointments` with `coaching_application_id uuid` FK + partial unique index on `(coaching_application_id) WHERE status IN ('booked','rescheduled')`
- All new tables/columns get GRANTs + RLS policies in same migration
- Public submission endpoint: server route at `/api/public/coaching-applications` with honeypot + rate-limit + Zod; or extend the existing `createServerFn` public path the form already uses
- Reuse `sms-trigger.server.ts` automation pipeline — no new SMS system
- Reuse Lovable email queue — no new email system

## Deliverables per phase

Each phase ends with: working preview, the user verifies, then I publish. Phase 1 is the biggest visible change (the quiz). Phases 2–4 are mostly admin/backend.

## Question before I start

**Do you want me to proceed phase-by-phase, or compress into a single mega-build?** Phase-by-phase keeps each turn reviewable and lets you stop after phase 1 if the quiz UX needs tweaks before backend wiring. Mega-build is faster end-to-end but harder to course-correct.

Also: **for Phase 1's booking embed, should I use the existing `book.$slug.tsx` page (one specific booking link slug for "Coaching Discovery Call"), or build a dedicated in-flow slot picker?** Reusing `book.$slug.tsx` is much faster and respects all your existing booking config; the dedicated picker is a bigger lift.