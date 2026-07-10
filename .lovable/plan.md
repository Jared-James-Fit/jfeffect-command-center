# Client Profile Overlay Workspace

Open the existing admin client profile in a large overlay on top of whatever page the admin was on (Clients list, Payments, Check-Ins, etc.), while keeping the underlying route mounted with all filters, sort, pagination, tab, selection, and scroll intact. The standalone `/admin/clients/$id` URL keeps working for direct links / refresh / share.

## Architecture — route-driven overlay via a search param

TanStack Router doesn't have a first-class "background location" like React Router, but the same UX is achievable with a global search param on the `_authenticated` layout.

- Add `?clientId=<uuid>` (and optional `clientTab=summary|coaching|...`) to the `_authenticated` layout's `validateSearch`. When present, the layout renders `<ClientProfileOverlay clientId=... />` above `<Outlet />` without touching the underlying route.
- Opening a client sets the search param via `navigate({ search: prev => ({ ...prev, clientId, clientTab }) })` from the current `from`. The underlying route stays matched — its loader is not re-run, its component is not unmounted, so filters/scroll/selection are all preserved.
- Closing the overlay clears the param the same way. Browser Back naturally clears it (history entry pop) → overlay closes and admin lands on the exact scroll/state they had. Forward reopens it.
- Direct visits to `/admin/clients/$id` keep loading the full-page profile route as today — no deep links break.

Why this over a modal without URL state: it satisfies Back/Forward, shareable "focused" URLs (`?clientId=...` on any list), and lets `useBlocker` intercept unsaved-changes closes.

## Reuse strategy — no duplicate profile

Today `src/routes/_authenticated/admin/clients.$id.tsx` is a 2148-line route that owns the loader + UI. Extract the page body into a plain, route-free component so both the standalone route and the overlay render the same thing.

- New: `src/components/clients/profile/client-profile-workspace.tsx` — takes `{ clientId, mode: "page" | "overlay", initialTab? }`, contains everything currently rendered by `clients.$id.tsx` (summary, tabs, forms, POV actions, coaching setup, notes, etc.).
- `src/routes/_authenticated/admin/clients.$id.tsx` becomes a thin route wrapper: `<ClientProfileWorkspace clientId={id} mode="page" />`. All queries, mutations, permission checks, and POV impersonation flow stay in the same components — one source of truth.
- The overlay renders the same `<ClientProfileWorkspace clientId={clientId} mode="overlay" initialTab={clientTab} />` inside a dialog shell. `mode` only toggles chrome (hide the page's own PageHeader/back-link, show the overlay's fixed header with close button).

Data-loading: React Query cache keys stay identical, so opening the overlay right after visiting the standalone page (or vice versa) is instant. First-open shows the workspace's existing skeleton. Heavy tabs are already lazy inside the current profile; no change.

## Overlay shell

New: `src/components/clients/profile/client-profile-overlay.tsx`

- Desktop (`md+`): shadcn `Dialog` with custom `DialogContent` sized `w-[90vw] max-w-[1400px] h-[92vh]`, rounded top, dark backdrop, fixed header (photo, name, status, assigned coach, quick actions: Open POV / Message / More menu / Close), internal scroll body.
- Mobile/small tablet (`< md`): full-screen `Sheet` from bottom, `h-[100dvh]` with `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`, sticky header with back-arrow close, horizontally scrollable tab bar, body scroll only.
- `useBlocker({ shouldBlockFn: () => hasUnsavedProfileEdit, withResolver: true })` gates Escape / backdrop / close-button / route-change / browser-back. A shared "isDirty" signal is exposed by the workspace via a small context (`ClientProfileDirtyContext`) that existing edit forms already flip.
- Focus trap + restore: `Dialog`/`Sheet` handle it. We store the triggering element ref in the layout and refocus after close.
- Accessibility: `DialogTitle` = client name, `aria-describedby` = status line, close button `aria-label="Close client workspace"`, ESC closes, focus visible.

## Call-site changes — click-a-name opens overlay

New helper hook: `useOpenClientProfile()` in `src/lib/open-client-profile.ts` returns `(clientId, opts?: { tab?, event? }) => void`. It calls `navigate({ to: '.', search: prev => ({ ...prev, clientId, clientTab: opts?.tab }), replace: false })` from the current location and, when the caller passes a `MouseEvent`, honors modifier keys (⌘/Ctrl/middle-click) by falling through to a normal `<Link to="/admin/clients/$id">` for new-tab opens.

Also new: `<ClientNameLink clientId name />` — renders an `<a>` that goes to `/admin/clients/$id` (so ⌘-click / right-click "Open in new tab" work) but intercepts plain left-clicks to open the overlay. Replaces raw `<Link to="/_authenticated/admin/clients/$id">` in every current call site:

- Clients list rows: `client-row.tsx`, `clients-mobile-card.tsx`, `clients/quick-actions.tsx` (Open Client button), `clients/compliance-dashboard.tsx`, `clients/add-client-dialog.tsx`
- Payments/Transactions: `payments/transaction-detail-drawer.tsx`, `admin/transactions.tsx`, `admin/payments.tsx`, `admin/purchases.$id.tsx`, `purchase-agreement-status.tsx`
- Check-Ins / Progress / Reviews: `progress/progress-summary-card.tsx`, `progress/progress-review-queue.tsx`, `admin/check-in-reviews.tsx`, `admin/check-ins.tsx`
- Scheduling / Calendar: `admin-calendar/upcoming-panel.tsx`, `admin-calendar/pt-calendar-panel.tsx`, `lib/calendar-sources.ts`, `admin/calendar.tsx`, `admin/appointments.tsx`
- Messages / Support: `admin/messages.tsx`, `admin/support-alerts.tsx`, `notification-bell.tsx`
- Forms / Agreements / Lift videos: `admin/fillout-submissions.tsx`, `admin/agreements.index.tsx`, `admin/agreements.signed.tsx`, `sent-agreements-manager.tsx`, `admin/lift-videos.tsx`
- Search / Dashboard widgets: `lib/global-search.functions.ts` result rendering, `upcoming-birthdays-widget.tsx`, `intel-actions.tsx`, dashboard cards on `admin/index.tsx`
- Deliberate full-page nav preserved: sub-routes `/admin/clients/$id/schedule`, `/admin/clients/$id/progress`, `/admin/client-programs/$clientId` — those keep normal `<Link>` navigation.

## Permission & security

- The overlay renders inside `_authenticated/route.tsx` (already gated by auth). Server-side authorization is unchanged: profile data is fetched by the same `getAdminClientProfileAndGoalsFn` server function, which enforces admin-or-assigned-coach on the server. Unauthorized clients show the same "Forbidden" empty state the standalone route already shows — no data leak while loading (query starts in `pending`, renders skeleton, then error).
- Client POV keeps using the existing impersonation flow from inside the workspace header.

## Mobile / tablet

- `< md` (< 768px): full-screen `Sheet`. Underlying page keeps mounted but visually hidden.
- `md`–`lg` (768–1024px): dialog at `w-[95vw] h-[95vh]`.
- `lg+`: dialog at `w-[90vw] max-w-[1400px] h-[92vh]`.

## Files

New:
- `src/components/clients/profile/client-profile-overlay.tsx` — dialog/sheet shell.
- `src/components/clients/profile/client-profile-workspace.tsx` — extracted body from `clients.$id.tsx`.
- `src/components/clients/client-name-link.tsx` — smart link component.
- `src/lib/open-client-profile.ts` — `useOpenClientProfile` hook + search param zod schema.

Edited:
- `src/routes/_authenticated/route.tsx` — add `validateSearch` for `clientId`/`clientTab`, mount `<ClientProfileOverlay />` after `<Outlet />`.
- `src/routes/_authenticated/admin/clients.$id.tsx` — thin wrapper over `<ClientProfileWorkspace mode="page" />`.
- ~30 call-site files listed above — swap raw `<Link>` for `<ClientNameLink>` / `useOpenClientProfile`.

Unchanged / preserved:
- `/admin/clients/$id`, `/admin/clients/$id/schedule`, `/admin/clients/$id/progress`, `/admin/client-programs/$clientId` routes and their deep links.
- All profile server functions, mutations, POV flow, permission checks, cache keys.

## Verification

- Typecheck (`tsgo`).
- Playwright smoke: open `/admin/clients`, click a client name → overlay appears, underlying list still visible; press Escape → back to list at same scroll; ⌘-click same name → new tab loads standalone profile; navigate to `/admin/payments`, click a client in a row → overlay opens without navigating away.
- Manual check on mobile viewport (Playwright 390×844) — sheet fills screen, safe-area padded.

## Out of scope for this pass

- No schema, RLS, or data changes.
- No new tabs — reuse existing sections.
- No changes to the standalone sub-routes (`schedule`, `progress`, `client-programs`).
- Cross-entity global search unchanged.
