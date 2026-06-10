# Plan

Five changes, scoped to admin/coach (unless noted).

## 1. Sidebar reorg (`src/components/app-shell.tsx`)
- Move the footer block (avatar + name + email + Sign out + density toggle) up directly **below the logo header**.
- Move the search trigger **below** the new account block.
- Remove the bottom footer entirely. Nav scrolls to the very bottom of the sidebar.
- Collapsed-mode equivalents kept (avatar, sign-out, density toggle now at top).

## 2. Keyword searcher (obvious "keyword search" entry point)
- Update the existing sidebar search button: label becomes **"Search keywords…"** with a prominent ring/accent style and a "Jump anywhere" hint, plus a permanent **floating "Search keywords" pill** in the top-right of the desktop header area (already exists on mobile header — restyle to be obvious).
- The Cmd+K palette already exists; expand its placeholder to **"Type a keyword to jump…"** and group results clearly. Add aliases/keywords field per nav item is overkill — labels + group names already searchable.
- No new route — purely a UX restyle of `paletteOpen` trigger.

## 3. Mobile/tablet bottom nav (`app-shell.tsx` + `routes/_authenticated/admin/route.tsx`)
- Change admin bottom bar from 5 cols → 6 cols: Dashboard, Clients, Messages, Reviews, **Lifts**, More. (Coach already has Lifts; add a 6th slot for Tasks — see #5.)
- "More" sheet: bump each row to `py-4 text-base` with `h-12` minimum and larger icons (`h-5 w-5`) for easier tapping.

## 4. Training Intel on dashboard (`src/routes/_authenticated/admin/index.tsx`)
- Add a "Training Intelligence" card section using the existing `ClientTrainingIntelCard` / coach-intel summary data (top flags + a "View all" link to `/admin/training-intelligence`).

## 5. Task Manager (new)
**DB migration** — new tables:
- `tasks`: id, title, notes, quadrant (`do|schedule|delegate|eliminate`), status (`open|done`), priority, due_at, created_by (coach_id), assigned_to (coach_id, nullable), completed_at, completed_by, created_at, updated_at.
- `task_collaborators`: task_id, coach_id (optional — for multi-assign later; v1 we use single `assigned_to`).
- RLS: any admin/coach can SELECT/INSERT/UPDATE/DELETE all tasks (collaborative). GRANTs for `authenticated` + `service_role`.

**Server fns**: `src/lib/tasks.functions.ts` — listTasks, createTask, updateTask, toggleTaskDone, deleteTask, assignTask.

**Routes/components**:
- `src/routes/_authenticated/admin/tasks.tsx` — page with two sections:
  1. **Checklist** at top (flat list, check off, quick-add input).
  2. **Eisenhower Matrix** 2×2 grid below (Urgent×Important / Urgent×Not / Not×Important / Not×Not) — drag-or-select to move quadrant; modern card UI.
- Add to `adminNav` and `coachNav` under Core, icon `ListChecks`.
- Add to admin/coach bottom bar as 6th item (Tasks).

**Sign-in popup**:
- `src/components/tasks/task-popup-gate.tsx` rendered inside `_authenticated/admin/route.tsx` once per session (sessionStorage flag). Shows open task count + matrix preview. Primary big button = **"Skip for now"** (exits). Secondary smaller button = "Open Task Manager" → navigates to `/admin/tasks`.

## Technical details

- No changes to `clientNav` or `memberNav`.
- Mobile bottom nav grid switches to `grid-cols-6` when `bottomItems.length >= 5`.
- Popup gate keyed on session, not per-user persistence (lightweight, no extra table).
- Task list uses `useQuery` with realtime invalidation via supabase channel on `tasks` table for live collaboration.

Build order: migration → server fns → tasks page + matrix → nav + bottom bar → popup gate → sidebar reorg + search restyle → dashboard intel card → mobile More polish.