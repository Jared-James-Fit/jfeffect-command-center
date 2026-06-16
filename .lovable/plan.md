## Goal

Redesign the JF Effect Notification Center so unread vs read vs archived is unmistakable, mark/clear actions are obvious, and the system stays fast at scale — for admins, coaches, clients, and members. Reuse the existing derived feed (messages, lift videos, agreements, exercise notes, group chats, check-ins, appointments) and the existing delivery tables (`jf_notification_attempts`, `sms_log`, `email_send_log`, `notification_dedupe`). No duplicate notification system. Email/SMS delivery untouched.

## Approach

Today, in-app notifications are **derived** from 10+ source tables and there is no persisted per-item read/archive state — so "mark as read" can only update scattered source columns and there is no concept of "archive" or "clear". Rather than rewriting every producer or creating a parallel system, add one small **state-only** table that tracks per-user read/archive for each derived item, keyed by `(user_id, kind, source_id)`. Items still surface from the same sources; the new table just remembers what the user has marked.

```text
derived feed (existing)  ──►  notification_state (new, tiny)
        │                              │
        └──────────► merged in `useNotificationFeed` ──► UI
```

### Technical details

**New table `public.notification_state`** (state-only, no payload):
- `id uuid pk`, `user_id uuid not null`, `kind text not null`, `source_id text not null`, `read_at timestamptz`, `archived_at timestamptz`, `created_at timestamptz default now()`
- Unique `(user_id, kind, source_id)` — idempotent upserts, prevents duplicate state rows
- Indexes: `(user_id, archived_at, read_at)`, `(user_id, kind)`
- RLS: user can only `select/insert/update/delete` rows where `user_id = auth.uid()`; grants to `authenticated` and `service_role`
- RPCs: `mark_notifications_read(items jsonb)`, `mark_all_notifications_read(items jsonb)`, `archive_notifications(items jsonb)`, `archive_read_notifications(items jsonb)`, `restore_notifications(items jsonb)` — all `security definer`, all scoped to `auth.uid()`

**Rewrite `src/components/notification-bell.tsx` (split into folder):**
- `src/components/notifications/use-notification-feed.ts` — keep the existing derived queries (admin/coach/client paths intact), then LEFT JOIN against `notification_state` in-memory by `(kind, source_id)` to compute `isRead` / `isArchived`. Source-derived "implicit read" (e.g. message already read via `conversation_state.client_last_read_at`) still counts as read.
- `src/components/notifications/notification-bell.tsx` — bell button + badge. Badge counts only `items.filter(i => !i.isRead && !i.isArchived)`; shows `99+` over 99.
- `src/components/notifications/notification-panel.tsx` — Sheet on mobile (full-screen drawer), Popover on desktop. Filters: **New** (default, with count) / **All**. Header actions: **Mark All as Read**, **Clear Read** (archives read items). Three-dot menu: View Archived, Archive All (with strong confirm). Per-item three-dot: Mark Read/Unread, Archive, Restore.
- `src/components/notifications/notification-row.tsx` — unread = bold title + subtle `bg-muted/40` + dot indicator; read = normal weight, no dot, slightly muted. Icon + title + 1-line preview + relative time. Click → mark read + navigate via existing `destinationFor`.
- `src/components/notifications/empty-states.tsx` — "You're all caught up.", "No notifications yet.", "No archived notifications."

**Full page `src/routes/_authenticated/notifications.tsx`:**
- Server-side pagination: load 20 newest derived items + their state on mount; "Load older" appends next page (cursor by `created_at` of the derived source).
- Group rows by Today / Yesterday / Earlier. Use `react-window` virtualization only if a page renders >100 rows.
- Tabs: New / All / Archived. Filter chips: Workouts, Check-Ins, Messages, Payments, Agreements, Account, Coaching, System (mapped from `kind`).
- Mobile: filters collapse behind a Filter button.

**Realtime consolidation:**
- One channel `notifications-${userId}` subscribed to the same source tables as today, plus `notification_state` filtered to `user_id=eq.${userId}`. Debounce 300ms then `invalidateQueries(["notifications"])`.
- Remove the duplicate `NotificationBell` mount in `src/routes/_authenticated/portal/messages.tsx:130` (AppShell already renders it).
- Keep `use-client-nav-badges.ts` as-is for sidebar dots (separate concern), but stop it from re-subscribing to tables the bell already watches; reuse the same query key invalidation.

**Optimistic updates:**
- `useMutation` for mark-read / archive with `onMutate` patching the cached feed; rollback on error. Debounce repeated Mark-All clicks via mutation `isPending` guard.

**Bug fixes carried in:**
- Admin `check_in_review` destination → `/admin/clients/${clientId}?tab=check-ins` (was `/portal`).
- Replace remaining `notification_dedupe` check-then-insert sites with `INSERT ... ON CONFLICT (key) DO NOTHING` + check `rowsAffected` to make dedupe atomic. (Touches: `members.functions.ts`, `setup-reminder.server.ts`, `membership-onboarding-email.server.ts` + `.functions.ts`, `stripe-webhook.ts`.)

**No changes to:** SMS sending, email sending, `jf_notification_attempts` writes, broadcasts, support_alerts, recipe_notifications, nutrition_notification_log, the `/admin/membership/notifications` delivery audit page.

## File-by-file

**New**
- `supabase/migrations/<ts>_notification_state.sql` — table + indexes + RLS + grants + RPCs
- `src/components/notifications/use-notification-feed.ts`
- `src/components/notifications/notification-bell.tsx`
- `src/components/notifications/notification-panel.tsx`
- `src/components/notifications/notification-row.tsx`
- `src/components/notifications/notification-state.functions.ts` — server fns wrapping the RPCs
- `src/components/notifications/types.ts`

**Updated**
- `src/components/app-shell.tsx` — import path for `NotificationBell`
- `src/routes/_authenticated/notifications.tsx` — paginated full page
- `src/routes/_authenticated/portal/messages.tsx` — remove duplicate `<NotificationBell />`
- `src/lib/members.functions.ts`, `src/lib/setup-reminder.server.ts`, `src/lib/membership-onboarding-email.server.ts`, `src/lib/membership-onboarding-email.functions.ts`, `src/routes/api/public/stripe-webhook.ts` — atomic dedupe upsert

**Deleted**
- `src/components/notification-bell.tsx` (replaced by folder)

## Verification

1. Build + typecheck green (auto).
2. Security scan — no new findings on `notification_state` (RLS scoped to `auth.uid()`).
3. Playwright smoke against the live preview as admin and client: bell badge updates, mark-one, mark-all, clear-read, archived view, full page load-older, mobile drawer.
4. Confirm `/admin/membership/notifications` delivery log + dry-run mode unchanged.
5. Publish to jfeffect.com and post a handoff report.

## Out of scope

- Notification preferences UI (kept as-is).
- Push notifications.
- Rewriting the sidebar nav-badges hook (only de-duplicating its realtime subscriptions).
- Migrating existing derived sources into the new table — they remain derived; only state is persisted.
