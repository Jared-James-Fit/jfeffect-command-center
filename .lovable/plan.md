
# Membership → Coaching UI Parity

Precision migration. No component duplication — reuse existing Coaching (`/portal/*`) building blocks inside the `/m/*` shell. No business logic changes; presentation and navigation only.

## 1. Bottom Navigation (`src/lib/admin-nav.ts`)

Replace `memberBottomNav`:
- Home → `/m`
- Workouts → `/m/workouts` (renamed from My Plans)
- Nutrition → `/m/nutrition`
- Support → `/m/support`
- More → `/m/more`

Trim `memberNav` (left rail): Home, Workouts, Nutrition, Support, More. Everything account-flavored lives under More.

## 2. Route renames / additions

- Rename `m/my-plans.tsx` → `m/workouts.index.tsx`; keep `m/my-plans.$enrollmentId.tsx` re-exporting the same view under a new `m/workouts.$enrollmentId.tsx` path (or add redirect).
- New `m/more.tsx` — a Manage Membership hub linking to Profile, Membership, Billing, Receipts, Notifications, Privacy, Support, Delete Account.
- Legacy `m/plans.tsx` (Program Library page) becomes internal component only, mounted inside a Sheet on the Workouts page — no more standalone tab.
- Keep `m/account.tsx`, `m/billing.tsx`, `m/announcements.tsx`, `m/tools.tsx`, `m/resources.tsx` reachable via More; drop from bottom nav.
- Add redirects: `/m/my-plans` → `/m/workouts`, `/m/plans` → `/m/workouts`.

## 3. Home page (`m/index.tsx`) reorder

Top-to-bottom, all reusing existing Coaching cards:
1. Bodyweight tracker — reuse the same card `/portal` home uses.
2. Water tracker — keep current.
3. Progress Snapshot — reuse Coaching's progress-hub entry card (Log Weight / Photos / Measurements / Videos / View Progress Hub).
4. Setup card — collapsed rows; only "Install JF Effect" + "Enable Notifications"; hide entirely once both done (persist in localStorage as today).
5. Manage Membership card → links to `/m/more`.

Remove: current access badges, permission chips, "Complete Profile / Pick First Program / Open First Workout" rows, debug info.

## 4. Workouts page (`m/workouts.index.tsx`)

Single page (no tabs):
- Current Active Program card: Program name, Week, Progress bar, Continue Workout button, Calendar button. Nothing else. No warning banners unless action required.
- "Add Workout Program" button opens a Sheet containing the existing Program Library UI (extracted from `m/plans.tsx` into a component `MemberProgramLibraryPanel`). Default filter "All Programs". Instant search + filters + preview + Add to Training preserved. On add: close sheet, invalidate active-program queries.
- Below: Workout Analytics — reuse the exact Coaching analytics dashboard component (`client-analytics-dashboard` or the portal wrapper) so Training Readiness, Recovery, Sleep, Load, Consistency, Performance, Pain, Recommendations, Insights all appear identically. Pass the member's userId.

## 5. Account → More

`m/more.tsx` = one page grouping links to existing routes (Profile section from `m/account`, Billing, Receipts (from billing), Notifications, Privacy, Support, Delete Account). Reuse Coaching settings list layout. No duplicated forms — link out to existing pages where they already exist.

## 6. Shared components — reuse, don't fork

- Bodyweight card, water card, progress hub entry, setup card rows, analytics dashboard, skeleton loaders, virtualization, image caching, animations: import from `@/components/portal/*` or shared `@/components/*` used by `/portal`. Where a member-specific data adapter is needed, pass a viewer/userId prop rather than cloning the component.

## Out of scope
- No changes to workout logging, nutrition detail, billing/Stripe logic, or DB schema.
- No visual redesign beyond adopting Coaching spacing/typography via reused components.

## Technical notes
- `AppShell` already accepts `bottomItems`; only nav arrays change.
- `m/route.tsx` unchanged except nav wiring.
- Program Library extraction: pull the list/search/filter body out of `m/plans.tsx` into `src/components/member/member-program-library-panel.tsx`, then render it both inside the new Workouts sheet and inside `/m/plans` (kept only as a soft redirect to `/m/workouts`).
- Analytics reuse: `/portal/workouts.analytics.tsx` renders `ClientAnalyticsDashboard` (or similar). Import the same component into the Workouts page, wired with `member.user_id`.
- Delete: none — legacy routes stay as redirects to avoid breaking bookmarks/deep links.
