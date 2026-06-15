## Goal
Rebuild `/portal` as a mobile-first, scannable home: one clear "what to do next" above the fold, large quick actions, compact action centre, slimmer training block + bodyweight, and move low-priority info to `More`. No backend, schema, route or permission changes — only presentation and IA.

## Scope of changes (files)

1. **`src/routes/_authenticated/portal/index.tsx`** — full UI rewrite of `PortalHome`. Reuse existing queries (client, forms, agreements, purchases, phases, coachUpdates, appointments) untouched. Replace layout with the new hierarchy below. Keep `ManualCheckInReviewModal`, `ClientActionRequestModal`, `UpcomingEventsPanel`, `HomeScreenSetupCard` rendering (they're gates/popups, not visible cards). Drop large inline `LogBodyweightCard`, "Your Coaching", "Billing & Subscription", oversized "Today/This Week" horizontal scroller, and the dashed appointment empty-state from the dashboard.

2. **`src/components/client-pov-banner.tsx`** — compact 56px sticky banner: eye icon + "Viewing as {name}" + small "Client POV" chip + Exit button. Single row, no truncation of name, no oversized secondary row.

3. **`src/lib/admin-nav.ts`** — add `clientBottomNav` (Home, Workouts, Messages, Nutrition, More) that the portal shell uses as `bottomItems`. Keep `clientNav` intact for the side drawer (so nothing is removed). Rename the first item label to `Home`.

4. **`src/routes/_authenticated/portal/route.tsx`** — pass the new `clientBottomNav` into `AppShell` via the existing `bottomItems` prop.

5. **`src/routes/_authenticated/portal/account.tsx`** (light touch) — add a small "Account & Coaching" section header with rows linking to Coaching details, Billing/Purchases, Agreements, Notifications, Help. Only if the current account page lacks them; otherwise skip.

6. **New: `src/components/portal/bodyweight-summary-card.tsx`** — compact summary (latest, 7d avg, weekly change, goal, sparkline) + "Log Weight" button that opens a bottom-sheet (Sheet from shadcn) wrapping the existing log form logic. Reuses `progress_metrics` query and `useBodyweightGoal`. Empty state = single "Log first weight" button, no big chart.

7. **New: `src/components/portal/primary-action-card.tsx`** — derives today's #1 action from existing data (next workout via existing workout-today helpers, then overdue/due check-in, then unread coach message, then appointment today, else rest day). Large tappable card.

8. **New: `src/components/portal/quick-actions-grid.tsx`** — 2-col grid: Workouts, Message Coach, Submit Check-In, Log Bodyweight (opens sheet), Upload Lift Video, Nutrition. Tap targets ≥56px.

9. **New: `src/components/portal/action-centre.tsx`** — refactor of the existing `updates[]` array into a vertical list (no horizontal scroller). Rows with icon + title + due chip + chevron, sorted overdue→urgent→info. "All caught up" compact row when empty.

10. **New: `src/components/portal/training-block-card.tsx`** — compact version of the existing active-phase card (chip + week X of Y + % + days remaining + progress bar + "View Program" button). Full card tappable.

## New dashboard order (mobile)

```
[compact POV banner — admin impersonation only]
[Greeting row: avatar · "Good morning, {first}" + bell badge]
[Today's Primary Action card]
[Quick Actions 2x3 grid]
[Action Centre list — only if items, else compact "all caught up"]
[Training Block card — only if activePhase]
[Bodyweight Summary card]
[Upcoming Appointment compact row — only if appointment exists]
[Small secondary links: Purchases · Agreements · Account]
```

Bottom safe-area padding ≥ 96px so content never sits under the fixed bar.

## Data preservation

- All `useQuery` calls keep their existing keys, filters and shapes.
- No mutations changed. Bodyweight insert path reuses the same `progress_metrics` insert as today's `LogBodyweightCard`.
- Existing routes (`/portal/workouts`, `/portal/check-ins`, `/portal/messages`, etc.) untouched.
- "Your Coaching" + "Billing & Subscription" + full Bodyweight history are still reachable: bodyweight via "View History" (`/portal/progress-metrics`), coaching/billing via `/portal/account` and `/portal/purchases`.

## Out of scope (explicit)

- No schema migrations.
- No edits to lift-review, check-in submission, workout entry, or auth flows.
- Desktop layout: the new components are responsive (sm: grid spans, md: side-by-side for training+bodyweight); admin-only screens unchanged.
- The full feature parity of the old inline `LogBodyweightCard` (range tabs, large chart, goal editor) stays available on `/portal/progress-metrics`; the dashboard only shows summary + log sheet.

## Verification

- `bunx tsc --noEmit` clean.
- Manual smoke via Playwright at 375px width: greeting → primary action → quick actions visible without scroll; bottom sheet opens for Log Weight; POV banner ≤64px; no bottom-nav overlap.

## Risks / things to confirm

- The "primary action — workout today" derivation: I'll reuse `src/lib/workout-today.ts` if it exposes the next scheduled day; otherwise fall back to "View this week's program" from the active phase. No new queries against workout tables beyond what's already cached.
- Side drawer `clientNav` stays 18 items — only the **bottom** nav is reduced to 5. This satisfies "max 5 bottom items" without hiding any existing page.
