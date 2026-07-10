
## Goal

Kill the accordion-everywhere sidebar. Ship three renderers over one nav source:

- **Desktop** (fine pointer, ≥1280px): flat sidebar, hover flyout for children — mostly what exists.
- **Tablet** (coarse pointer OR 768–1279px): flat permanent sidebar, primary label = one tap, chevron button = tap-triggered floating side panel with children.
- **Mobile** (<768px): full-screen drawer that shows real destinations immediately; tapping a category chevron **replaces** the drawer contents with that category's submenu (with `< Back` header). No "All sections" intermediate screen. No stacked accordions.

One `items: NavItem[]` config keeps driving all three (already grouped via `group`, children via `children`, badges via `useClientNavBadges` / `useMediaNavBadges`).

## What changes

### 1. Detection (`src/components/app-shell.tsx`)

Add `usePointerCapability()` returning `"fine" | "coarse"` via `matchMedia("(pointer: fine)")`. Combine with width:

```
device = width < 768                       → "mobile"
       | pointer==="coarse" || width<1280  → "tablet"
       | else                              → "desktop"
```

Replace current `useIsTablet` uses.

### 2. Desktop renderer — keep, trim

- Keep `SidebarFlyoutRow` hover popover for items with `children`.
- Remove accordion "collapse all / expand all" controls when device !== desktop (already partly done).
- Sidebar sections still collapsible on desktop only.

### 3. Tablet renderer — new

- Sidebar is always `expanded`, no group toggles, no density cycling, no pins reorder UI.
- **Flat list**: render every group's items back-to-back, section labels as tiny inert dividers only when a label exists — no chevron on group headers.
- Each row = `<Link>` (label) + optional chevron button (only when `item.children?.length`). Two separate tap targets, each ≥44px, with visible pressed state.
- Chevron opens a Radix `Popover` anchored to the row, `side="right"`, `sideOffset=8`, `collisionPadding=12`, `w-72`, closes on outside tap or child selection. Tap (not hover) triggers open.
- Reuse the child-rendering block from `SidebarFlyoutRow` (extract as `<FlyoutChildren item />`).

### 4. Mobile renderer — new full-screen drawer

Replace current Sheet at lines 899–1022:

- `Sheet side="left"` (or bottom, keep bottom for muscle memory), `h-[100dvh] w-full` (or `h-[92vh]`), safe-area padding.
- **Header**: title (`JF Effect Admin` or workspace title) + workspace chip + close button.
- **Search**: compact input; filtering identical to current `moreFiltered` — flat result list of `{item, group}` with icon + label + group.
- **Body — two states**:
  - **Root view**: iterates `grouped`. Renders section label as small uppercase inert row, then each item as a full-width row = Link (label + icon) + optional right-side chevron button when `children?.length`. No accordion, no nested indent.
  - **Submenu view** (when `openCategory !== null`): renders `< {parentLabel}` back button + section header for parent, then parent's `children` as flat list (respecting `child.section` dividers). Tapping any child navigates + closes drawer. Replaces root view, not stacked.
- State: `const [openCategory, setOpenCategory] = useState<NavItem | null>(null)`. Reset on drawer close.
- Chevron button uses `onClick={(e)=>{e.preventDefault(); e.stopPropagation(); setOpenCategory(item)}}`.
- No group collapsing.

### 5. Duplicate parent/child label cleanup

`internal-nav.ts` currently emits children like `Messages → Messages` and `Clients → Clients`. Rename first-child entries to match user's list:

- Messages: children = `Inbox` (was Messages), `Communication Hub`, `Broadcasts`, then Chat Assets section.
- Clients: children = `All Clients`, `Check-In Reviews`, `Lift Reviews`, `Action Requests`, `Progress Media`, `Forms`, `Agreements`.
- Payments: children = `Overview`, `Transactions`, `Products & Offers`, `Payment Links`, `Coupons`, `Failed Payments`.
- Programs, Scheduling: same rename pattern (first duplicate child → `Overview`, `Program Library`, `Calendar`, etc. per spec).

Only edit labels; routes, permissions, badges, workspace metadata stay untouched.

### 6. Preserve context

Nothing here re-mounts the underlying route — the drawer is a portal `Sheet`. Confirm: no `key` on `<Outlet />`, no navigation on drawer open/close. `openCategory` lives inside the shell so browser back can't restore stale submenu.

## Files touched

- `src/components/app-shell.tsx` — new `usePointerCapability`, `useDevice`, refactored tablet branch, replaced mobile Sheet body, extracted `FlyoutChildren`, `TabletFlyoutRow`, `MobileDrawerRoot`, `MobileDrawerSubmenu`. Remove `moreOpenGroup` state and `NEVER_COLLAPSE_SECTIONS` special-casing on non-desktop.
- `src/lib/internal-nav.ts` — rename duplicate child labels only.

Nothing else changes. Desktop sidebar, floating bar, command palette, POV bar all untouched.

## Out of scope

- No changes to `client-portal`, `member`, `media` shells beyond what the shared `AppShell` gives them.
- No route additions.
- No changes to `useClientNavBadges` / `useMediaNavBadges`.

## Verification

- `tsgo` (harness auto-runs).
- Manual: iPad viewport 1024×768 — sidebar flat, chevron opens right-side panel, tap outside closes.
- Manual: iPhone 393×852 — open drawer, tap Messages chevron → submenu replaces list, back button returns.
- Confirm route stays mounted (open client overlay, open drawer, close drawer — overlay still there).
