## Goal

Replace the accordion-heavy admin sidebar with a compact, one-click launcher. Every top-level item opens its primary route in one click; secondary pages appear in a desktop hover flyout or a mobile submenu panel. No route deletions this pass — only nav restructuring plus redirects for a small set of confirmed duplicates. Membership sidebar keeps its route list but adopts the same visual/behavioural system.

## New admin sidebar structure

Source of truth: `src/lib/admin-nav.ts` (`adminNav` and `coachingAdminNav`). Each entry maps to an existing route; `children` populate the flyout.

**OVERVIEW**
- Dashboard → `/admin`
- Tasks → `/admin/tasks`
- Support Alerts → `/admin/support-alerts`

**MAIN MENU**
- Messages → `/admin/messages` — flyout: Inbox (`/admin/messages`), Broadcasts (`/admin/broadcasts`), Popups (`/admin/popups`), Call Access (`/admin/call-access`)
- Clients → `/admin/clients` — flyout: All Clients, Check-In Reviews, Lift Reviews, Media Review Inbox, Action Requests, Check-Ins & Forms, Agreements, Native Agreements
- Payments → `/admin/payments` — flyout: Transactions (`/admin/payments`), Products (`/admin/payment-links`), Promo Codes, Purchases, Billing Sources & Legacy, Legacy Migration Board
- Programs → `/admin/program-library` — flyout: Program Library, Exercise Library, Cardio Targets, Warm-Up Protocols, Recipe Library, Nutrition Dashboard, Resources, Member Programs (`/admin/member-plans`), Member Resources
- Scheduling → `/admin/calendar` — flyout: Calendar, Events, Appointments, PT Calendar (`/admin/pt-calendar`), Booking Links, Google Calendar
- Business → `/admin/crm` — flyout: CRM Dashboard, CRM Contacts, Coaching Applications, Coaching Sales Page, Membership Sales Page (admin only), Training Intelligence
- Team → `/admin/coaches` — flyout: Coaches, Staff & Media Managers, Approvals Queue, Program Submissions, Media Archives, Archive Manager

**OTHER**
- Add-ons → `/admin/apps` — flyout: Integrations, Operations, FAQ Manager, Fillout Submissions, Chat GIF Library, Chat Sound Library, Content Ideas, Testimonials, Feature Flags, SOPs, Training Phases, Legal, Onboarding, Coaching, Content, Communication, Programming, Native Forms, Automations, Discount Codes, Popups (dup), Client POV, Nutrition Targets, Offers, Products History
- Settings → `/admin/settings` — flyout: General (`/admin/settings`), SMS (`/admin/settings/sms`), Chat (`/admin/settings/chat`), Nutrition Automation, Coaching-Application Alerts, Floating Bar Customizer, Account
- App Members (admin only, when NOT in membership mode) → `/admin/members` — flyout: App Members, Membership Home (`/admin/membership`) — kept as a fast switch into the Membership shell

Coach role gets the same layout with Business/Team/Payments/Add-ons hidden.

## Desktop flyouts

Extend `AppShell` (`src/components/app-shell.tsx`) so any nav item with `children` renders:
- The primary label is a normal `<Link>` — clicking it navigates to `item.to` (no flyout-only parents).
- On hover/focus, a Radix `Popover` opens to the right of the sidebar with the child links.
- ~120ms open delay, ~200ms close delay to prevent flicker; pointer-into-flyout keeps it open (bridge via `onMouseEnter` on trigger + content).
- Chevron shown only when `children` exists.
- Escape / outside-click closes. Full keyboard support via Radix defaults.
- Active state on parent when any child route matches.

## Mobile / drawer

In the existing mobile sheet, tapping a parent navigates. A small chevron on the right opens a second panel that replaces the current list (with a back arrow), instead of the accordion expand. Reuse the existing sheet — add local `openGroup` state.

## Safe consolidation & redirects

Add `beforeLoad: () => redirect(...)` on these routes (all currently accessible URLs preserved, no data changes):
- `/admin/programming` → `/admin/program-library` (already a dispatcher-style page; low use)
- `/admin/programs` → `/admin/program-library`
- `/admin/coaching` → `/admin/clients`
- `/admin/communication` → `/admin/messages` (preserving `?tab=support-inbox`)
- `/admin/content` → `/admin/broadcasts`

Everything else stays reachable at its current URL. No table, function, or permission change.

## Membership sidebar

Keep `membershipNav` route list intact. Apply the same shell behaviours (flyouts, mobile panel, active state) since they're driven by `AppShell` + `children`. Add one Overview-group entry pointing back to `/admin` labelled "Exit to Coaching" so the switch is obvious. No route moves inside membership.

## Global search

Keep the existing `CommandPalette` (⌘K) and the sidebar's compact search input that opens it. No new backend. Nothing added if the palette weren't already wired — it is.

## Files changed

- `src/lib/admin-nav.ts` — rewrite `adminNav`, `coachingAdminNav`, `coachNav` with new groups + `children`.
- `src/lib/internal-nav.ts` — align group ordering / mode filtering.
- `src/components/app-shell.tsx` — add desktop hover-flyout Popover for items with `children`; add mobile submenu panel; keep pins, badges, palette, membership mode.
- `src/routes/_authenticated/admin/programming.tsx`, `programs.tsx`, `coaching.tsx`, `communication.tsx`, `content.tsx` — convert to `beforeLoad` redirect stubs (originals become pure redirects; underlying pages they proxy remain reachable via their canonical route).
- `src/lib/membership-nav.ts` — add "Exit to Coaching" entry.

## Not in scope

- Cross-entity search backend.
- Redesigning any destination page.
- Deleting routes or tables.
- Moving client/member sidebars.

## Risks & how they're mitigated

- **Accidental route hide**: everything not in the primary/flyout lists still resolves at its URL. Command palette still surfaces them.
- **Flyout flicker**: bridged hover with delays; Radix Popover handles focus.
- **Membership admins losing routes**: membership route list unchanged.
- **Bookmarks**: only 5 routes redirect, all to their obvious successor; original URLs still respond (via redirect).

## Final report will include

Previous vs new structure, per-flyout link list, redirects added, pages parked in Add-ons, files changed, and any route I found that appears broken or unused (documented, not deleted).
