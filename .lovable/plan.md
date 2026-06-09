This is a large 3-part redesign. Here's what I'll build, scoped to keep it reliable.

## Part 1 — Admin/Coach Dashboard Command Center

Rewrite `src/routes/_authenticated/admin/index.tsx` into a new structure:

1. **Header** — compact: JF Effect logo, name, search icon, notification bell, settings/profile icon. Stacks tight on mobile.
2. **Today's Command Center** — top card showing today's counts (unread messages, check-ins, lift videos, action requests, payment issues, missing setup, birthdays today). Each line is a button into the relevant page.
3. **Quick Stats** — 4 stat cards (Active Clients, New This Period, Needs Attention, Payment Overdue). 4-col desktop / 2-col tablet+mobile.
4. **Quick Actions** — chip grid: Add Client, Message Client, Review Check-Ins, Review Lift Videos, Create Program, Send Payment Link, New Broadcast, New Recipe.
5. **Needs Attention** — unified list (max 5) merging check-in pending, lift pending, unread, payment issue, setup incomplete, expiring program. Each row: client, reason, time, priority badge, action button.
6. **Reviews** — compact card: counts + buttons to Check-In Reviews / Lift Reviews.
7. **Training Deadlines** — max 5, sorted past-due → due-today → ending-soon.
8. **Upcoming Birthdays** — reuse existing widget, cap at 3, with "View all".
9. **Payments / Products** — compact "Clients without active product: N" + 3 previews + View All / Sell Product.
10. **Recent Clients** — 5 max.
11. **Quick Tools** — moved to bottom, compact icon row.

Desktop uses 2-column main grid (Needs Attention/Reviews/Deadlines on left, the rest on right). Mobile is single column in the listed order, with `pb-24` so bottom nav doesn't cover content.

Data: reuse the existing queries already in admin/index.tsx (clients, messages, check-ins, lift videos, action requests, payments, birthdays). Derive Needs Attention by merging those into one sorted list. No new server functions unless a data source is missing — I'll fall back to existing hooks/lib.

Skeleton loaders for each card section.

## Part 2 — Mobile nav label

In `src/routes/_authenticated/admin/route.tsx` bottomItems, override the Clients item label to "Clients" (desktop sidebar stays "Coaching Clients" via `adminNav`).

## Part 3 — Clients page mobile/tablet

Rewrite `src/routes/_authenticated/admin/clients.index.tsx`:

- Keep existing desktop table behavior intact (gated by `md:` / `useIsMobile`).
- **Mobile/tablet (< md):** render stacked client cards instead of the table:
  - Top: avatar, name, type, status badge
  - Email / last activity row
  - Status chips: Training, Nutrition, Cardio, Payment, Messages, Setup (color-coded)
  - Actions: View, Message, More (dropdown with Add Phase, Assign from Library, Add Nutrition, Add Cardio, Sell Product, Send Setup, Archive)
- **Filters on mobile:** Search input + Filter button that opens a Sheet drawer containing all filters.
- **Priority chips row** at top (horizontal scroll on mobile): All / Needs Setup / Needs Review / Program Ending / Payment Issues / New Clients — wired to existing filter state where data exists, otherwise client-side filter on the already-loaded list.
- `pb-24` bottom padding so bottom nav doesn't cover last card.
- Tablet uses 2-column card grid (`sm:grid-cols-2 lg:hidden`).

No horizontal scroll at < md.

## Files touched

- `src/routes/_authenticated/admin/index.tsx` — full rewrite
- `src/routes/_authenticated/admin/clients.index.tsx` — full rewrite (preserves all current routes/actions, only restructures presentation + adds mobile cards & priority chips)
- `src/routes/_authenticated/admin/route.tsx` — relabel Clients in bottomItems
- New small helper components as needed (e.g. `src/components/dashboard/command-center-card.tsx`, `clients-mobile-card.tsx`) to keep files manageable.

## What I will NOT do in this pass

- Won't build new backend functions; if a data point (e.g. "urgent client flag") doesn't exist today, I'll omit that line rather than guess.
- Won't change the Coach navigation set (coachNav already labels it "My Clients").
- Won't touch the existing portal / member dashboards.

Proceed?