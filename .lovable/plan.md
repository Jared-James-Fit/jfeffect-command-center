# Training Block Overhaul — Implementation Plan

This builds on the existing `pl_blocks` / `pl_weeks` / `pl_days` / `pl_exercise_rows` / `pl_row_results` / `pl_day_completions` system. No disconnected pages — everything attaches to existing screens.

## Phase 1 — Horizontal Week Layout (everywhere)

Replace stacked/collapsible weeks with horizontal columns, always open, vertical divider between weeks.

Files:
- `src/routes/_authenticated/portal/workouts.index.tsx` — replace `WeekSection` collapsibles with a horizontally scrollable strip of week columns.
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` (library editor) — same horizontal column layout.
- `src/components/assigned-programs-card.tsx` — admin client view, same layout.
- New shared `src/components/block-week-columns.tsx` — renders an array of weeks as horizontal columns. Each column shows: Week #, date range, training days, est time, notes, status badge, list of workouts (always expanded). Mobile = horizontal scroll snap, dividers between columns.

## Phase 2 — Block Progress Analytics

New section embedded **inside** each block view (active + archived), below the week columns, above the Workout Archive list.

New files:
- `src/lib/block-analytics.ts` — pure calc helpers (volume, e1RM via Epley, top set, avg RPE, completion %, PRs, trends). Only uses completed sets from `pl_row_results` filtered to that block. Respects client unit (kg/lb) — read from `clients.weight_unit` or default.
- `src/lib/block-analytics.functions.ts` — `getBlockAnalytics(blockId)` server fn returning summary + per-week aggregates + per-exercise series. Single round trip.
- `src/components/block-progress-section.tsx` — main UI:
  - Summary cards (workouts done/total/%, sets done/total, total volume, avg RPE, missed workouts, manual weeks, total training time).
  - Block graph with metric toggle (Weekly Volume default, Workouts Completed, Avg RPE, Top Set, e1RM, Completion %). Use existing `recharts` (already a shadcn dep).
  - Exercise selector (only exercises present in this block). Exercise graph with metric toggle (Top Set default, e1RM, Volume, Avg RPE, Reps, Sets, Frequency).
  - PRs list (Highest Load, Highest e1RM, Highest Volume Session, Highest Rep PR) with "New Block PR" badge.
  - Block Insights (Most Improved, Most Stalled, Largest e1RM gain, Highest/Lowest compliance exercise, Avg RPE trend, Volume trend, Most consistent week) — derived rules, no AI.
  - Compliance block (completion %, missed workouts/weeks, manual completions, "Low Compliance" flag when <70% — configurable in `clients` settings later).
  - Flags strip (Missed Workout, Missed Week, Manual Completion, New PR, Volume Drop/Increase >20%, Load Drop, RPE Spike, Deload Week).
  - Filters: Week, Exercise, Workout Day, Movement Category (squat/bench/deadlift/upper/lower/accessories — derived from `exercises.category` already on the table).
  - Empty state: "No training data logged yet…"
  - Drilldown: graph point click opens existing workout day route (`/portal/workouts/$dayId`).

## Phase 3 — Block Card Polish (already mostly done)

`src/components/block-summary-card.tsx` already shows name/status/duration/dates/current week/progress %/week strip + admin Edit Dates + end-passed banner. Confirm both admin and client mount it; add to client `portal/program.tsx` if missing.

## Phase 4 — Export

Admin-only buttons in Block Progress:
- CSV export — client-side, builds CSV string from analytics payload.
- PDF Summary — use existing `jspdf` if present; else add `jspdf` + `jspdf-autotable`. Server fn not required.

## Phase 5 — Wire Into Pages

- `src/routes/_authenticated/portal/workouts.index.tsx` (client): for each block, render BlockSummaryCard → horizontal week columns → `<BlockProgressSection clientView blockId />` → existing archive section stays below.
- `src/components/assigned-programs-card.tsx` (admin client detail page): same structure, admin variant (export buttons, edit-archived toggle when block is Archived).
- Archive: clicking an archived block opens a read-only block detail with the same BlockProgressSection.

## Out of scope (explicit)

- No new analytics route, no separate dashboard.
- No data backfill / migrations beyond what's needed for movement categories — `exercises.category` already exists.
- No unit conversion. Use client's `weight_unit` as-is.
- No "Planned vs Completed" weight tracking beyond what's already stored (we use prescribed vs logged from existing rows).

## Open Questions

1. **Mobile horizontal weeks** — swipe-snap one week per screen, or free horizontal scroll showing partial next week? (default: free scroll with snap on column edges)
2. **Low Compliance threshold** — global 70% default, or per-client setting? (default: global 70%, hardcoded for now)
3. **PDF export** — full styled report or simple table-only summary? (default: table-only summary to avoid heavy deps)
4. **Movement category source** — use `exercises.category` text as-is, or add a normalized enum mapping? (default: lowercase string match on existing `category` field)

Reply with answers or "go with defaults" and I'll ship Phases 1–5 in one batch.