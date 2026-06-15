# Admin Home → Command Center Redesign

A full redesign of the Admin Home dashboard. The current page mixes contradictory status signals ("Inbox zero" alongside overdue reviews), buries urgent work under integrations and sales lists, truncates button labels, and overflows under the bottom nav. This rebuilds it around one shared attention engine and a clear mobile hierarchy, while preserving every existing route, action, and permission.

## Goals

- Answer in one screen: *What needs me today? Which clients? What can I do fast? What's next?*
- One source of truth for "Needs Attention" — no contradictions.
- Mobile-first: 48×48 minimum touch targets, no truncated labels, safe-area aware.
- Progressive disclosure: previews on Home, full lists on dedicated pages.
- Preserve all existing functionality — relocate, never remove.

## Phase 1 — Shared Attention Engine

Create `src/lib/attention.functions.ts` with a single server fn `getAttentionFeed` that returns a typed, ranked list of actionable items + counts by category. Inputs: `coachId?`, `limit?`. Sources (all already in DB):

- Submission reviews awaiting review (`submission_reviews`, `manual_check_in_reviews`)
- Lift videos awaiting review (`lift_videos` status)
- Programs expired / ending within warning window (`pl_blocks` end_date + `client_compliance_settings`)
- Programming deadlines overdue (existing deadline calc)
- Payment overdue/failed (`payment_ledger`, `purchase_records` past_due)
- Onboarding incomplete (invite/agreement/training days)
- Nutrition update due (`nutrition_review_tasks`)
- Client action requests pending (`client_action_requests`)
- Agreement requiring action (`agreements` pending)
- Scheduling conflicts (existing conflict watcher)

Output shape:
```ts
type AttentionItem = {
  id: string; kind: AttentionKind; clientId?: string; clientName?: string;
  title: string; subtitle: string; urgency: 'overdue'|'due'|'soon';
  ageDays?: number; href: string; primaryAction: { label: string; href: string };
};
type AttentionFeed = { items: AttentionItem[]; counts: Record<AttentionKind, number>; total: number };
```

Replace independent counts in: Command Center, Needs Attention metric, Training Intelligence, Training Deadlines, Reviews, Tasks, header notification badge, and Clients directory status priority. Each consumer calls the same fn or reads from a shared `useQuery` cache key `['attention-feed', coachId]`.

## Phase 2 — New Dashboard Layout

Replace `src/routes/_authenticated/admin/index.tsx` (and split into small components under `src/components/admin/home/`).

Mobile order:

1. **Compact header** — Reuse `admin-top-bar` but slim: logo + "Admin", single search icon (opens global search), notification bell with `total` from attention feed, avatar. Remove the large "Workouts" search button.
2. **Mode switcher** — Existing `DashboardModeSwitcher` (Coaching/Membership/Media) as a compact segmented control. Admin↔Member POV moves to profile menu.
3. **Greeting** — "Good afternoon, {first name}" + secondary line + date.
4. **Today's Priorities** — Top 5 from attention feed. Each row: icon, client/task, reason, age/deadline chip (`overdue` red, `due` amber, `soon` muted), primary action button (≥52px, never truncated), chevron to detail. Empty: compact "You're caught up." line — no big card.
5. **Quick Actions** — 2-col grid, each tile ≥64px, large icon + short label (Add Client, Assign Program, Message, Check-Ins, Lift Reviews, Create Program, Add Payment, Calendar). Section header has small pencil icon → existing floating-bar customizer. Defaults stored per-admin in existing `floating-bar` prefs.
6. **Metrics strip** — Horizontal scroll of compact pills: Active Clients, Needs Attention, Reviews Waiting, Programs Ending, Payment Issues. Each links to filtered page. "New" metric uses 7-day window with subtitle "Last 7 days".
7. **Clients Needing Action** — Horizontal swipe carousel, up to 5, derived from attention feed grouped by client. Each card: avatar, name, reason, urgency, one action button + "View all" → `/admin/clients?status=needs_review` (or appropriate filter).
8. **Upcoming** — Single card with segmented tabs: Appointments | Deadlines | Birthdays. Max 3 items each. Default Appointments. Footer "View calendar".
9. **Recent Clients** — Compact 3-row preview using corrected new-client rule (account created ≤7d AND onboarding active). No "New Client" badge on established clients.
10. **More** drawer / link section — Integrations (Stripe, Drive, Sheets, Calendar, Fillout, SignNow), Client POV, Sales → Products & Payments, Broadcasts, Recipes.

Desktop (≥lg): two columns. Left: Today's Priorities, Clients Needing Action, Upcoming. Right: Quick Actions, Metrics, Payment Issues, Recent Activity.

## Phase 3 — Fixes & Relocations

- **Payments**: remove product-sales list from Home. Move to existing `/admin/payments` (or create section under Sales). Home shows only `Payment Issues` count + list when issues exist.
- **Integrations grid**: move from Home to `/admin/integrations` (or More menu entries). Optional pin into Quick Actions.
- **Enter Client POV**: remove from primary area; add to profile dropdown + client workspace header. Keep route intact.
- **Bottom nav**: add `pb-[calc(env(safe-area-inset-bottom)+5rem)]` to `AppShell` main scroll container; verify modal sheets render above nav.
- **Buttons**: audit Home — all primary actions get `h-12` (48px) min, full label, no `truncate` on action text. Replace tiny text links with `Button variant="ghost"` rows.
- **New-client rule**: shared util `isGenuinelyNew(client)` reused across Recent Clients, directory "New" filter, metrics.

## Phase 4 — Personalization & Performance

- `admin_dashboard_prefs` (per-user JSON in existing `profiles` or new lightweight table): section order, hidden optional sections, pinned quick actions (max 8), metric selection. "Reset to default" button. Required sections (Today's Priorities, Payment Issues, Nav) cannot be hidden.
- Loaders: above-the-fold (header, attention feed top 5, metrics) loads first via `ensureQueryData`; lower sections (`Upcoming`, `Recent`, `Payment Issues`) use independent `useQuery` so one failure doesn't block the page. Each card has skeleton + retry.
- Add DB indexes (migration) where attention queries need them: `submission_reviews(status, created_at)`, `lift_videos(status, created_at)`, `pl_blocks(client_id, end_date)`, `payment_ledger(status, due_at)`.

## Phase 5 — Acceptance & QA

Run through the 26-point acceptance list. Mobile QA via Playwright at 390×844 + 1280×1800. Verify contradictions resolved by seeding/checking known cases (Nicolas Galli review surfaces in count and list).

## Technical Notes

- New files: `src/lib/attention.functions.ts`, `src/components/admin/home/*` (header, priorities, quick-actions, metrics-strip, clients-needing-action, upcoming, recent-clients), `src/lib/dashboard-prefs.ts`.
- Edits: `src/routes/_authenticated/admin/index.tsx` (full rewrite), `src/components/admin-top-bar.tsx` (slim), `src/components/app-shell.tsx` (safe-area bottom padding), `src/lib/clients-directory.functions.ts` (use shared attention priority), `src/lib/floating-bar.ts` (reuse for pinned quick actions).
- Migration: indexes + optional `admin_dashboard_prefs` table with RLS (user reads/writes own row, service_role all).
- Preserved: every route + action listed in section 20. None deleted, only relocated.

## Out of Scope

- Coach/Media/Client dashboards (Coaching admin only).
- Backend business-logic changes beyond aggregation (existing review/deadline/payment rules unchanged).
- Visual rebrand — keeps existing dark JF theme + red primary.

## Open Questions

Before I start I want to confirm a couple of choices so I don't ship the wrong default. Answer in the next message and I'll implement straight through.

1. **"New client" window** — go with **7 days + onboarding active**, or do you want 14 days?
2. **Payment Issues on Home** — show only when count > 0 (hide the card entirely when clean), or always show a 0-state pill?
3. **Bottom nav tabs** — keep current 5, or switch to **Home / Clients / Messages / Reviews / More** as the spec suggests (moves Tasks into More)?
4. **Personalization storage** — OK to add a small `admin_dashboard_prefs` table, or store prefs in `localStorage` only for v1?
