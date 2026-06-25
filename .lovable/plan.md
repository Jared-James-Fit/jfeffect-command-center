
# Phase 2 — Media Home, My Work, Tasks, Quick Notes, Eisenhower

Reuses the existing `tasks` table, `media_content_records`, the current `TasksPage` Eisenhower component, and `MediaHeader`. No duplicate task or note systems.

## 1. Database (non-destructive migration)

Add to existing `public.tasks`:
- `due_time time` (optional — paired with existing `due_at` date)
- `important boolean default false`
- `priority_label text` — `urgent | high | normal | low` (mirrors numeric `priority`)
- `status_label text` — `not_started | in_progress | waiting | blocked | complete` (existing `status` open/done stays as source of truth; label adds intermediate states)
- `campaign_id uuid null`
- `linked_content_id uuid null references media_content_records(id) on delete set null`
- `linked_asset_id uuid null`
- `recurring_rule jsonb null` (RRULE-lite: `{freq, interval, until}`)
- `archived_at timestamptz null`

New tables (small, additive):
- `task_subtasks` — id, task_id (cascade), title, done, position
- `task_comments` — id, task_id (cascade), author_id, body, created_at
- `task_attachments` — id, task_id (cascade), file_url, file_name, mime_type, size_bytes
- `media_quick_notes` — id, owner_id, title, body, pinned, archived, converted_to (task|draft|content_idea|null), converted_ref_id, updated_at (migrates the localStorage notes; existing local notes auto-import on first load)
- `media_activity_events` — id, actor_id, kind (task_completed | content_submitted | content_approved | changes_requested | file_uploaded | campaign_updated | publish_date_changed), subject_type, subject_id, summary, created_at

All with GRANTs to `authenticated` + `service_role`, RLS scoped to admin/coach/media_manager (matches existing tasks policy). Existing rows untouched.

## 2. Media Home — `/media`

Rebuild `src/routes/_authenticated/media/index.tsx` as an action dashboard.

Compact status card row (each links to a filtered route, real counts only):
- Due Today → `/media/work?filter=today`
- Overdue → `/media/work?filter=overdue`
- Awaiting Review → `/media/inbox?filter=pending`
- Changes Requested → `/media/inbox?filter=changes`
- Ready to Publish → `/media/publishing?filter=ready`
- Scheduled This Week → `/media/publishing?filter=week`
- Unassigned → `/media/work?filter=unassigned`
- Blocked → `/media/work?filter=blocked`

Sections:
1. **My Priorities** — top 8 of (overdue ∪ today ∪ important) for current user. Title, type, status, priority, due, campaign, assignee, Open, Complete.
2. **Approval Queue** — `media_content_records` where reviewer = me AND approval_status = pending. Approve / Request Changes / Comment / Open.
3. **Upcoming Content** — next 10 by `publish_date` ascending. Includes `events.event_date` merged in.
4. **Needs Attention** — rule-based scan over `media_content_records` + `tasks`: missing final asset / caption / CTA / approval / publish_date / overdue tasks / unassigned / blocked.
5. **Active Campaigns** — campaigns with `status = active`, with progress counts.
6. **Recent Activity** — last 20 from `media_activity_events`.

Single server function `mediaHomeData()` returns all sections in one call. Empty states everywhere.

## 3. My Work — `/media/work`

Wrap existing `TasksPage` with a view switcher:

- **List** (default) — segments: Overdue, Today, Upcoming, No Due Date, Completed. Quick-entry row (title only required; optional inline assignee/due/priority/linked-content). Bulk select (one/multi/all visible) → Assign, Due date, Priority, Status, Complete, Archive, Delete (confirmed). Each row shows status badge, priority pill, due-date warning color, assignee initials, campaign/content link.
- **Board** — columns by status_label (Not Started · In Progress · Waiting · Blocked · Complete).
- **Eisenhower** — renders existing `TasksPage` matrix unchanged.
- **Calendar** — month grid keyed off `due_at`.

URL search params drive the view: `?view=list|board|eisenhower|calendar&filter=…`.

## 4. Quick Notes

Migrate the existing localStorage Quick Notes panel to the new `media_quick_notes` table with autosave. First load detects local notes and upserts them (one-time, idempotent). Each note row supports: Edit, Pin, Archive, Delete, **Convert to Task / Draft / Content Idea** (creates the target record with note body as description and sets `converted_to` / `converted_ref_id`).

## 5. Header

Reuses the existing `MediaHeader` with the global `+ Create` menu already built in Phase 1.

## Files

New:
- `src/lib/media-home.functions.ts` — `mediaHomeData()`
- `src/lib/media-tasks.ts` — extended task helpers (subtasks/comments/attachments/bulk ops)
- `src/lib/media-quick-notes.ts` + `.functions.ts`
- `src/lib/media-activity.ts`
- `src/components/media/home/*` — `StatusCards`, `MyPriorities`, `ApprovalQueue`, `UpcomingContent`, `NeedsAttention`, `ActiveCampaigns`, `RecentActivity`
- `src/components/media/work/*` — `WorkListView`, `WorkBoardView`, `WorkCalendarView`, `QuickAddRow`, `BulkActionBar`, `TaskRow`
- `src/components/media/quick-notes-panel.tsx` (DB-backed, replaces localStorage panel inside the Media scope only)

Modified:
- `src/routes/_authenticated/media/index.tsx` — rewritten as dashboard
- `src/routes/_authenticated/media/work.tsx` — view switcher + URL search params

Unchanged:
- `src/lib/tasks.ts` (extended, not replaced)
- `src/components/tasks/tasks-page.tsx` (used as the Eisenhower view)
- Admin scope tasks page — keeps localStorage notes

## Verification before stopping

- Read existing tasks → still listed.
- Read existing localStorage notes → imported on first Media load, then visible from DB.
- Existing Eisenhower quadrant styles persist.
- Create / assign / due-date / priority / link-to-content / complete / archive / convert flows manual-tested via Playwright.
- All 8 home status cards open the correct filtered route.

## Out of scope (Phase 3+)

Pipeline Kanban features, Calendar building beyond the simple month view, Asset Library, Campaigns detail page, Performance analytics, Templates/Brand Kit.
