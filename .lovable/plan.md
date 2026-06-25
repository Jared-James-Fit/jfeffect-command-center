## Scope check first

Before I build, two things in your request don't match what's in the repo. I need your call on each before touching code, otherwise I'll ship the wrong thing.

### 1. "Workout/program builder" — which builder(s)?

You named three builders: admin program builder, client program builder, member program builder. The repo only has one:

- `src/components/program-builder.tsx` — used by the admin program library template editor and the admin blocks editor. There is no separate client builder or member builder; clients/members only **log** workouts, they don't build them.
- The one place that actually uses `@dnd-kit` is the schedule calendar, not the program builder.
- `program-builder.tsx` uses raw HTML5 drag (`onDragStart` / `onDragEnd` attributes), not a DnD library — which is exactly why the snap/drop feels imprecise on desktop and is unresponsive on touch (HTML5 drag has no touch support).

Fix plan for the builder:
- Replace the HTML5 drag in `program-builder.tsx` with `@dnd-kit` (already installed) using `PointerSensor` + `TouchSensor` + `KeyboardSensor`, `closestCenter`, `verticalListSortingStrategy`, and a `DragOverlay` for the drop indicator.
- Apply the same pattern to any other sort handles in the same file (exercises within a day, sets within an exercise, days within a week — whichever currently use HTML5 drag).
- Add a visible drop indicator line between rows and a grab cursor on the handle; long-press activation on touch.

Confirm: **builder = `program-builder.tsx` only**, or do you also want me to find/build admin/client/member-specific builders that don't exist yet?

### 2. "Three workout views" — there are only two

Routes that render `WorkoutDayView`:
- `/_authenticated/portal/workouts.$dayId.tsx` (client logging) — uses `client-adapter`
- `/_authenticated/m/workouts.$enrollmentId.$week.$day.tsx` (member logging) — uses `member-adapter`

There is **no** admin/coach route that renders `WorkoutDayView` for viewing a client's workout. The closest existing pages are `admin/clients.$id.tsx`, `admin/client-programs.$clientId_.tsx`, and `admin/client-pov.tsx` — none of them mount the shared workout view.

Two options — pick one:

- **A. Parity across the two that exist.** Audit `client-adapter` vs `member-adapter` and make sure the shared `WorkoutDayView` exposes every feature (KG/LB toggle, exercise notes, exercise history, swap exercise, warm-up button, rest timer, quick fill, apply to remaining sets, set status checkmark, cues, How To video) in both. Anything gated only in one adapter gets enabled in the other. No new route.
- **B. Also add an admin coach view.** Create `admin/clients.$id.workouts.$dayId.tsx` that renders `WorkoutDayView` through a new read/write `coach-adapter`, then do the parity audit across all three.

Confirm: **A or B?**

## What I'll do once you confirm

Assuming **builder = `program-builder.tsx`** and **option A** for parity:

1. Pull latest from GitHub (auto-sync) and verify build is green.
2. Refactor drag-and-drop in `program-builder.tsx` to `@dnd-kit` with touch support, drop indicator, and a regression test that reorders two items and asserts the new order.
3. Diff `client-adapter` vs `member-adapter` for the 11 features you listed, plus walk `WorkoutDayView` for any feature that's behind an adapter capability flag. Fill the gaps in whichever adapter is missing them — never remove.
4. Manual verification on the preview for each route (drag a set, toggle KG/LB, open history, swap exercise, start rest timer, mark set complete, open How To, etc.).
5. Report files changed and any feature that was already present in both.

Answer the two confirmations and I'll proceed.