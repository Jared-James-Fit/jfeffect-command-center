# Bring Membership onto the Coaching workspace framework

The scope you described spans ~35 membership routes plus the member-facing `/m/*` app. Trying to redo everything in one pass will produce a giant, unreviewable change and almost certainly break something. I want to do it in **four staged phases** and get your sign-off (or reordering) before I start.

## Phase 1 — Extract shared "workspace" primitives from Coaching

The Coaching client overlay already contains the exact pattern you want (sticky identity header → action center → alerts → snapshot → section nav → content). Right now those pieces live only inside `src/routes/_authenticated/admin/clients.$id.tsx`. I will lift them into reusable components so both Coaching and Membership consume the same code:

- `src/components/workspace/WorkspaceShell.tsx` — sticky header + action center + alerts + snapshot slot + section nav + content slot
- `src/components/workspace/IdentityHeader.tsx`
- `src/components/workspace/ActionCenter.tsx` (accepts an actions array — Coaching passes coaching actions, Membership passes membership actions)
- `src/components/workspace/SectionNav.tsx` (already exists inline — extract + keep `compact` prop)
- `src/components/workspace/OverviewSnapshot.tsx` (slot-based so Membership can inject membership-specific tiles)

Coaching client overlay is refactored to consume these. No visual change on Coaching side — this is a pure extract.

## Phase 2 — Member profile overlay uses the same shell

- Create `src/components/members/member-profile-overlay.tsx` mirroring `client-profile-overlay.tsx`.
- Create `src/routes/_authenticated/admin/members.$memberId.tsx` workspace (or refactor the existing one) to render `WorkspaceShell` with:
  - Identity header: avatar, name, plan badge, status, joined date, last active, quick actions
  - Action Center: **Open Member POV, Message Member, Manage Membership, Change Plan, Grant Complimentary Access, View Purchases** (exactly your list — no coaching actions)
  - Alerts: failed payment, expired trial, setup incomplete, missing PFP/phone
  - Snapshot: subscription status, current plan, next billing, access state, recent purchases
  - Section nav → Profile / Membership Plan / Purchases / Progress / Messages / Notes
- Member row in members list opens the overlay (same pattern as client-row).

## Phase 3 — Membership dashboard reordered + responsive fixes

Rework `admin/membership.index.tsx` to the priority order you specified:

1. **Actions strip** (top): Manage Members, Payment Issues, Grant Access, Sales & Plans
2. **Alerts**: Failed payments, Expired trials, Setup problems (using the same alert card style as Coaching)
3. **Analytics** (bottom, collapsed by default on mobile): subscription counts, access counts, health metrics

All cards moved to the same `Card` + spacing tokens Coaching uses (`gap-4 md:gap-6`, `p-4 md:p-6`, consistent `min-h`, container `max-w-7xl mx-auto px-4 md:px-6`). Grids standardized to `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.

## Phase 4 — Responsive audit + `/m/*` member app polish

Sweep every membership route (list below) and align to Coaching's container/grid/spacing tokens. This is a mechanical pass, not a redesign.

Admin membership routes audited: `membership.index`, `members.index`, `members.$memberId`, `member-plans.*`, `member-resources.*`, `membership.billing`, `membership.billing-events`, `membership.action-needed`, `membership.launch-readiness`, `membership.signup-stats`, `membership.calendar`, `membership.challenges`, `membership.stripe-sync`, `sales.membership`.

Member-facing `/m/*` routes audited against `/portal/*` equivalents: `m/index`, `m/my-plans`, `m/plans`, `m/nutrition.*`, `m/progress`, `m/resources`, `m/support`, `m/announcements`, `m/billing`, `m/account`, `m/tools`, `m/upgrade`.

Only spacing / container / grid / card sizing changes — no logic edits.

## What I need from you

This is a lot. Before I start, please confirm:

1. **Order of phases** — do 1 → 2 → 3 → 4 as above, or would you rather I do Phase 3 (dashboard reordering) first because it's the most visible?
2. **Scope of Phase 4** — audit *all* the routes listed, or just the ones you screenshotted? (Screenshots weren't attached to this message — if you resend them I can prioritize those exact pages.)
3. **Member overlay behaviour** — should opening a member from the members list open the **same overlay component** as clients (i.e. share `ClientProfileOverlayMount` with a `mode: "member"` prop), or keep two overlay mounts that both wrap the same `WorkspaceShell`? I'd recommend the latter — cleaner separation, same UX.
4. **Coaching-only actions on members** — is it OK to fully remove Assign Program / Lift Review / Coaching Schedule from the member workspace even for members who *also* have a coaching add-on, or should those appear conditionally?

Reply with answers (or "go, do 1→4, keep them separate, remove coaching actions") and I'll start with Phase 1.
