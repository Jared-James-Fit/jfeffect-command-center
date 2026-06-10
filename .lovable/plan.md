# Google Calendar Appointments & Booking System

A full appointment, booking-link, and SMS-reminder system for coaches/admin, with per-coach Google Calendar OAuth, public booking pages, and client/coach dashboards.

## Scope summary
- Per-coach Google OAuth (each coach connects their own calendar).
- In-app calendar (today/upcoming, week, month-lite).
- Create/edit/reschedule/cancel appointments — synced both ways to Google Calendar.
- Optional Google Meet link on each appointment.
- Booking links (private/public) with availability windows, buffers, duration, daily caps.
- Public booking page (no app account required).
- Client-portal booking + upcoming appointment card.
- SMS reminders to attendee + host with configurable timings (uses existing Twilio).
- Bell notifications + dashboard cards on both admin and client side.
- Sidebar entry: **Calendar** (admin/coach) and **Appointments** (client).

---

## PART A — Google OAuth (per-coach)

The existing `google_calendar` connector authenticates ONE workspace account, so it can't represent each coach individually. We'll add a per-user OAuth flow:

- New secrets: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (user provides from Google Cloud Console — I'll request them when we get here).
- New table `google_calendar_connections` (per coach: tokens, refresh_token, selected_calendar_id, status, expiry).
- Server routes: `/api/public/google/oauth/start` (signed state → redirect to Google) and `/api/public/google/oauth/callback` (exchange code, store tokens).
- Server fns: `connectGoogle`, `disconnectGoogle`, `listCalendars`, `setSelectedCalendar`, `refreshSync`, `getConnectionStatus`.
- A small helper `googleClient.ts` that auto-refreshes tokens.

Status surfaced as: Connected / Not Connected / Reconnect Required.

## PART B — Data model (new tables)

- `appointments` — id, host_coach_id, client_id (nullable), external_name/email/phone, type (enum), title, starts_at, ends_at, timezone, location, meet_link, google_event_id, status (Scheduled/Completed/Cancelled/NoShow), attendee_notes, internal_notes, source (manual/booking_link), booking_link_id, sms_enabled, created_by, timestamps.
- `appointment_reminders` — id, appointment_id, audience (attendee/host), offset_minutes, status (pending/sent/failed), scheduled_for, sent_at.
- `booking_links` — id, slug (unique), name, type, host_coach_id, duration_minutes, buffer_before, buffer_after, max_per_day, timezone, meet_enabled, collect_phone, collect_notes, allow_reschedule, sms_enabled, active, created_at.
- `booking_link_availability` — id, booking_link_id, day_of_week (0-6), start_time, end_time.
- `appointment_audit_log` — basic action log (created, rescheduled, cancelled, sync_failed).

All with proper GRANTs + RLS:
- Coaches/admin: see/manage own hosted appointments; admin sees all.
- Clients: see appointments where `client_id = self`.
- Public booking page calls server fn with admin client to read only `booking_links` (active) + computed free slots.

## PART C — Server functions / routes

`src/lib/appointments.functions.ts`, `src/lib/booking.functions.ts`, `src/lib/google-cal.functions.ts`:
- `listAppointments({ range })`, `getAppointment`, `createAppointment`, `updateAppointment`, `cancelAppointment`, `markStatus`.
- `listBookingLinks`, `upsertBookingLink`, `deleteBookingLink`, `getBookingLinkPublic(slug)`, `computeAvailableSlots(slug, date)`, `bookSlotPublic(slug, payload)`.
- All Google sync goes through the host coach's stored tokens — create/update/delete events; if Meet enabled, request `conferenceData` with `createRequest`.
- `sendBookingLinkSms(clientId, linkId, msg)` and `sendBookingLinkChat(...)` reusing existing Twilio + chat infra.

Public route: `src/routes/api/public/book/$slug.ts` (booking page render uses an unauthenticated SSR route + public server fn).

Cron: `src/routes/api/public/hooks/appointment-reminders.ts` runs every 5 min via `pg_cron`, queries due `appointment_reminders`, sends SMS via Twilio, marks sent/failed.

## PART D — UI

**Admin/Coach** (sidebar entry "Calendar"):
- `/admin/calendar` — Today + Upcoming list, week grid, simple month, filter by coach (admin only).
- `/admin/calendar/new` — appointment form (all fields from spec).
- `/admin/calendar/$id` — detail/edit, reschedule, cancel, status, join Meet, notes (split client-visible vs internal).
- `/admin/calendar/connections` — Google connect/disconnect, choose calendar, refresh.
- `/admin/booking-links` — list + create/edit, copy link, send via SMS/chat, preview.
- Dashboard card: **Upcoming Appointments** (today + next 3, Join Meet button, quick actions).
- Bell notifications: new booking, starting soon, cancelled, SMS failed.

**Client portal** (sidebar entry "Appointments"):
- `/portal/appointments` — upcoming + past.
- Dashboard card: upcoming appointment with Join Meet + View Details.
- Booking page link (if coach sends one) opens public booker.
- Reschedule/cancel button when allowed.

**Public booking page** (no auth):
- `/book/$slug` — coach name/photo, type, duration, date picker, slot list (free only), attendee form, confirmation screen.

**Quick send hooks**:
- Messages composer: "Send Booking Link" action.
- Client profile: "Send Booking Link" button.
- SMS builder: `{{booking_link}}` variable.

## PART E — Performance, design, security

- Today/upcoming loaded first (single small query); week/month lazy-loaded on tab switch.
- Skeleton loaders, subtle transitions (respects `prefers-reduced-motion`), reuses existing JF Effect tokens, shadcn cards + small status badges.
- RLS enforces visibility; public booking fn returns only free/busy + coach display name (never event titles/notes).
- Double-book prevention: before insert, re-query Google + local appointments in the slot window inside a single transaction; surface clear error if Google sync fails.

## Out of scope (v1)
- Multi-host round-robin booking.
- Payment-on-booking (Stripe checkout for paid slots) — can layer on later using existing Stripe integration.
- Two-way realtime push from Google (we'll poll + manual refresh; webhooks deferred).
- ICS download (easy follow-up).

## Build order
1. Migration (tables + RLS + GRANTs).
2. Google OAuth secrets + connection flow.
3. Server fns + cron route.
4. Admin Calendar pages + sidebar entry.
5. Booking links admin + public booking page.
6. Client portal appointment views + dashboard cards.
7. Notifications + SMS reminders wiring.
8. Polish + mobile pass.

---

**Heads-up before I start:** I'll need you to create an OAuth Client in Google Cloud Console (Web application, with the `/api/public/google/oauth/callback` redirect URI I'll give you) and paste the Client ID + Client Secret when I prompt — that's the only blocker for per-coach Google Calendar. Everything else I'll wire up from here. Approve the plan and I'll begin with the migration.