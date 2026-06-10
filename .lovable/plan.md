# Events System

A full Events module for admin/coaches to plan and broadcast key client dates (meets, shoots, weigh-ins, calls, deadlines, etc.) with assignment, quick links, deadlines, reminders, countdowns, and a polished client view.

## 1. Data model (new migration)

Tables (all `public`, with GRANTs + RLS):

- `events`
  - id, name, event_type (enum), event_date (date), start_time, end_time, timezone, location, description, client_facing_notes, internal_notes, importance (Low/Medium/High/Critical), status (Draft/Active/Completed/Archived), audience_scope (selected_clients / all_coaching / app_members / program_only), created_by, created_at, updated_at, archived_at
- `event_quick_links` — event_id, title, url, link_type, visible_to_client, internal_note, sort_order
- `event_deadlines` — event_id, title, due_date, notes, visible_to_client, sort_order
- `event_reminders` — event_id, offset_key ('w12','w8','w4','w2','w1','d3','d1','day_of'), enabled, message, visible_to_client
- `event_assignments` — event_id, client_id (FK clients), assigned_at, unique(event_id, client_id)
- `event_popup_acks` — event_id, client_id, offset_key, acknowledged_at
- `event_format_prompt` — singleton row per admin user storing customizable ChatGPT prompt

Enums: `event_type`, `event_importance`, `event_status`, `event_link_type`, `event_audience_scope`.

RLS:
- Admins & active coaches: full read/write.
- Clients: read events only if assigned (or via audience scope) AND status='Active' or 'Completed'. Only see `client_facing_notes`, links/deadlines/reminders where `visible_to_client=true`. Internal fields hidden via column-level select via a `client_event_view` view or filtered server-side in fetch functions.

## 2. Admin/Coach UI

New route: `src/routes/_authenticated/admin/events.tsx` (list) and `events.$id.tsx` (editor).

- Events list: filter by status, importance, type, date, assigned client. Cards show name, type, date, countdown, importance badge, assignee chips, link chips. Quick actions: View, Edit, Duplicate, Archive, Assign, Preview as client, Message assigned.
- Editor (single page, tabbed or stacked sections):
  - Details (name, type, date, times, location, importance, status, description)
  - Notes (client-facing + internal)
  - Quick Links (inline add row, paste URL → auto-draft with type guess from domain, drag-reorder, visibility toggle)
  - Deadlines (inline rows, visibility toggle)
  - Reminders (8 toggle rows w/ editable message + client-visible toggle)
  - Assign Clients (search + multi-select + audience scope)
  - Preview as Client (modal renders client detail page)
- Format Guide tab: textarea with default prompt, Copy / Save / Reset buttons.
- Parse Event: textarea + "Parse" button → fills form locally; admin reviews before save.

Admin dashboard widget: `UpcomingEventsPanel` injected into existing `src/routes/_authenticated/admin/index.tsx` showing next ~5 events with countdown, importance, quick actions.

## 3. Client UI

- New route `src/routes/_authenticated/portal/events.tsx` (list) and `events.$id.tsx` (detail).
- Detail page shows: name, type, date/time, countdown, location, importance, description, client notes, client-visible deadlines, client-visible links (as button cards), client-visible reminder notes, status, Add-to-Calendar (.ics download), Message Coach button.
- Portal dashboard (`portal/index.tsx`): Upcoming Event card with countdown + "View Event Details".
- Program page: small countdown chip if event linked (event_type in competition-ish set & active).
- Notification bell: feed entries for new event assignments + reminder firings + popups.
- Popup component: triggers on app open for High/Critical events at threshold milestones (w12,w8,w4,w1,tomorrow,today) — only once per offset_key (uses `event_popup_acks`).

## 4. Reminders / countdown

- Pure client-side `computeCountdown(eventDate)` util → label ("12 weeks out", "Tomorrow", "Today", "Completed").
- Server cron (pg_cron daily 09:00 UTC) calls `/api/public/hooks/event-reminders` which:
  - For each active event whose offset matches today's distance and reminder.enabled, inserts a notification row (uses existing notification surface) per assigned client.
  - Marks event Completed when date passed.
- Coach planning reminders shown on admin dashboard from same data.

## 5. Server functions

`src/lib/events.functions.ts` (auth-protected via `requireSupabaseAuth`):
- listEvents, getEvent, upsertEvent, duplicateEvent, archiveEvent, deleteEvent
- upsertQuickLink, deleteQuickLink, reorderLinks
- upsertDeadline, deleteDeadline
- upsertReminder
- assignClients, unassignClient, listAssignments
- listClientEvents, getClientEvent (filters internal fields)
- ackEventPopup
- parseFormattedEvent (pure text parser; can also live client-side)
- getFormatPrompt, saveFormatPrompt, resetFormatPrompt

## 6. Design

Reuses existing JF Effect tokens (red for High/Critical). Tailwind + shadcn cards, badges, dialogs. Subtle Framer Motion / CSS transitions (120–250 ms), `prefers-reduced-motion` respected. Skeleton loaders for lists.

## 7. Out of scope (v1)

- Google Calendar two-way sync (Add to Calendar = .ics download only).
- SMS reminder channel (in-app + dashboard only; SMS hookup deferred).
- OCR of screenshots (workflow is: screenshot → ChatGPT with saved prompt → paste → Parse).

## 8. Files (high level)

New:
- `supabase/migrations/<ts>_events_system.sql`
- `src/lib/events.functions.ts`, `src/lib/events-utils.ts` (countdown, parser, ics)
- `src/components/events/*` (EventCard, EventEditor, QuickLinksEditor, DeadlinesEditor, RemindersEditor, AssignClientsDialog, ClientEventDetail, EventPopup, UpcomingEventsPanel, FormatGuideTab)
- `src/routes/_authenticated/admin/events.tsx`, `events.$id.tsx`
- `src/routes/_authenticated/portal/events.tsx`, `events.$id.tsx`
- `src/routes/api/public/hooks/event-reminders.ts`

Edited:
- `src/routes/_authenticated/admin/index.tsx` (UpcomingEventsPanel)
- `src/routes/_authenticated/portal/index.tsx` (upcoming event card + popup mount)
- `src/components/app-shell.tsx` or sidebar (add "Events" nav for admin + client)
- `src/components/notification-bell.tsx` (event notification kinds)

## 9. Build order

1. Migration + enums + RLS + GRANTs
2. Server fns + countdown/parser utils
3. Admin list + editor (incl. quick links, deadlines, reminders, assign, preview)
4. Client list + detail + popup + dashboard card + nav entries
5. Notification integration + cron endpoint
6. Format Guide + Parser UI
7. Polish: animations, reduced-motion, skeletons, mobile QA
