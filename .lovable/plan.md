## Progress Metrics — Scope & Plan

Focus the first build on **manual bodyweight logging** (the stated priority). Other metrics are supported but optional. Device sync ships as a UI-only "Coming soon" stub so it can be wired later without rework.

### 1. Database (one migration)

New table `public.progress_metrics`:
- `client_id` (uuid, required), `entry_date` (date), `bodyweight` (numeric), `bodyweight_unit` (text: lb/kg), `steps`, `sleep_hours`, `resting_heart_rate`, `calories_burned`, `active_minutes`, `notes`, `source` (text: manual / apple_health / fitbit…), `created_by` (uuid)
- Index on (client_id, entry_date desc)
- RLS: admin manage, assigned coach manage, client manage own (insert/select/update/delete where their `clients.user_id = auth.uid()`)
- GRANTs to authenticated + service_role

Add `preferred_weight_unit` (text, default 'lb') to `clients` for per-client default.

### 2. Client portal

- **Dashboard card** "Log Bodyweight" — single number input, unit toggle (lb/kg, prefilled from client preference), date defaulting to today, Save button → toast "Bodyweight logged." Shows latest weight + 7-day avg + weekly change as a compact summary.
- **New route** `/portal/progress-metrics` ("Progress Metrics" page):
  - Summary tiles: latest bodyweight, 7-day avg, weekly change, last logged date
  - Simple line chart of bodyweight over time with 7d/30d/90d/All filters (use Recharts — already in deps via shadcn chart)
  - Optional "Log other metrics" expandable form (steps, sleep, RHR, calories, active minutes, notes)
  - Recent entries list with inline edit/delete
  - "Connect Health Device" panel: list of apps (Apple Health, Google Fit, Fitbit, Garmin, Oura, Whoop) all showing "Coming soon" with status pill "Not Connected"
- Add nav link in the portal sidebar.

### 3. Admin client profile

- New **Progress Metrics** card on `admin/clients.$id.tsx`:
  - Latest bodyweight, 7-day avg, weekly change, step/sleep averages if data exists
  - Recent entries list with edit (dialog) + delete (double-confirm)
  - "Add Entry" button (admin can log on client's behalf)
  - Unit preference toggle (writes to `clients.preferred_weight_unit`)
  - CSV export button (downloads all entries)

### 4. Files

- `supabase/migrations/<ts>_progress_metrics.sql` — table + GRANTs + RLS + client unit column
- `src/lib/progress-metrics.ts` — types, unit conversion, avg/change helpers
- `src/components/log-bodyweight-card.tsx` — dashboard quick-entry
- `src/components/progress-metrics-panel.tsx` — shared summary + chart + history (used by both portal page and admin profile)
- `src/components/progress-metric-dialog.tsx` — add/edit full entry
- `src/components/connect-health-device-card.tsx` — stub UI
- `src/routes/_authenticated/portal/progress-metrics.tsx` — new portal route
- Edits: `src/routes/_authenticated/portal/index.tsx` (add quick-entry card), `src/routes/_authenticated/portal/route.tsx` (nav link), `src/routes/_authenticated/admin/clients.$id.tsx` (panel)

### 5. Deferred (UI placeholders only, no work this round)

- Actual device OAuth/sync wiring
- Admin dashboard widget for "clients missing bodyweight" / sync errors
- Reminder/notification scheduling

Both can be added later against the same table without migration changes.

### Notes
- All queries use `usePortalUserId()` so Client POV mode works automatically.
- Unit conversion handled in display only; values stored as entered with their unit so history stays faithful.
- Chart uses existing `recharts` (already a shadcn dep).
