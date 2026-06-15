
## Goal

Rebuild `src/routes/_authenticated/admin/index.tsx` (800 lines today) into a compact command center. No new data sources, no duplicate dashboards — every section reuses an existing query / component / route. The page should reach its end within ~2–3 mobile screens.

## Audit (what's there today)

Existing sections rendered on admin home:
1. `PageHeader` + role/area switchers
2. "Today's Command Center" big card + separate "Needs Attention" card
3. 8-button Quick Actions grid (truncated labels: "Review Check-I…")
4. 4× `StatCard` (Active Clients, New Clients, Needs Attention, Reviews Waiting)
5. `TrainingIntelDashboardCard` (`getCoachIntel`)
6. Training Deadlines (overlaps with #5)
7. Reviews queues: check-ins, lift videos, nutrition
8. Payments: overdue + full list of "clients without active product"
9. `UpcomingAppointmentsCard`
10. `UpcomingBirthdaysWidget`
11. `UpcomingEventsPanel`
12. Recent Clients (5)
13. Quick Tools / External Links (Stripe, Drive, Sheets, Calendar, Fillout, SignNow)
14. "Customize Floating Bar" card
15. "Enter Client POV" big card

Data hooks already in place: `getCoachIntel`, `listLiftVideos`, supabase queries for clients/payments/appointments/messages. **All reused as-is.**

## New page structure (mobile-first)

```text
┌────────────────────────────────────────┐
│ Compact header                         │
│  JF · [Coaching · Admin ▼] 🔍 🔔  👤  │
├────────────────────────────────────────┤
│ Today  ─ 3 priority items max          │
│   • Nicole — program due in 4d [Update]│
│   • Liam   — check-in waiting [Review] │
│   • Maya   — payment overdue  [Send]   │
│   View all priorities (6)              │
├────────────────────────────────────────┤
│ Quick Actions (5 tiles)                │
│  [+Client] [Message] [Check-Ins]       │
│  [Program] [More…]                     │
├────────────────────────────────────────┤
│ Numbers (2×2 grid, each tappable)      │
│  Active 15 │ Needs Attn 4              │
│  Reviews 3 │ Overdue 2                 │
├────────────────────────────────────────┤
│ Work Queues  [Reviews|Training|Pay|Onb]│
│  3 items in active tab • View all      │
├────────────────────────────────────────┤
│ Upcoming  (next 3 appts)               │
├────────────────────────────────────────┤
│ More ▾  (collapsed by default)         │
│  Birthdays · Recent Clients · Events   │
│  Stripe · Drive · Sheets · Calendar    │
│  Fillout · SignNow · Customize Nav     │
│  View as Client                        │
└────────────────────────────────────────┘
```

## Implementation

### Files

- **Rewrite** `src/routes/_authenticated/admin/index.tsx` — composes the new sections; keeps the existing route ID and all current queries (moved into sub-components, not duplicated).
- **New** `src/components/admin-home/today-card.tsx` — merges the old "Today's Command Center" + "Needs Attention" + dedupes Training Intelligence flags. Pulls from existing `getCoachIntel`, check-in queue, lift-video queue, overdue payments. Max 3 items, then "View all priorities (N)".
- **New** `src/components/admin-home/quick-actions.tsx` — 5 primary tiles + "More Actions" bottom sheet (reuses Sheet primitive) containing the rest of the existing actions. Full short labels: "Check-Ins", "Lift Reviews", "Payment Link", "Broadcast", "Recipe".
- **New** `src/components/admin-home/numbers-grid.tsx` — 4 compact `StatCard`s, each wrapped in `<Link>` to filtered routes (active clients, priority queue, reviews, overdue payments).
- **New** `src/components/admin-home/work-queues.tsx` — Tabs: Reviews · Training · Payments · Onboarding. Each tab caps 3 rows + "View all". Payments tab shows "13 clients without active product" summary row, not the full list. Consolidates the previously separate Training Intelligence + Training Deadlines into one Training tab.
- **New** `src/components/admin-home/upcoming-strip.tsx` — wraps existing `UpcomingAppointmentsCard` with a compact 3-item shell and "View Calendar" link; one-line empty state.
- **New** `src/components/admin-home/more-drawer.tsx` — collapsible section containing existing `UpcomingBirthdaysWidget`, recent clients (max 3), `UpcomingEventsPanel`, external-tool rows, "Customize Navigation" link, "View as Client" button.
- **New** `src/components/admin-home/area-role-switcher.tsx` — single compact `[Coaching · Admin ▾]` selector opening a sheet with Business area + View as. Replaces the persistent row of large pills. Uses the existing role/area state and routing — no permission changes.

### Behaviour & rules

- Empty states collapse to one-line rows with a check icon (no large dashed boxes).
- Every section is wrapped in its own `<Suspense>` + lightweight `ErrorBoundary` so one failure doesn't blank the page.
- Section caps enforced in code: priorities 3, reviews 3, training 3, appointments 3, recent clients 3, birthdays 2, payment issues 3.
- Bottom padding: `pb-[max(env(safe-area-inset-bottom),5rem)]` so the bottom nav never overlaps the last card.
- Desktop (`md:`) uses a 2-column layout: priorities + work queues left, numbers + upcoming + more right.
- The "Customize Floating Bar" card moves into More → "Customize Navigation" (keeps the route).
- "Enter Client POV" becomes a compact button in More (label: "View as Client"); shortcut also stays in the header sheet.

### What is NOT changing

- No new database tables, RLS, or migrations.
- No new server functions or queries — every section reuses the hooks already in `admin/index.tsx`.
- All existing routes, permissions, role switching, business-area switching, notification counts, and bottom nav remain intact.
- The analytics e1RM work from the previous turn is untouched.

### Acceptance smoke tests

- Screenshot at 375 px wide: page ends within ~3 viewports.
- Each StatCard tap navigates to the filtered list.
- "More Actions" sheet exposes every action currently on the home grid.
- With zero priorities/reviews/appointments, page is still short (no giant empty cards).
- Bottom nav doesn't cover the last row.

