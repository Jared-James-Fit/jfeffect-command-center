# Clients Section Redesign — Phase 1 + 2

Rebuild `/admin/clients` and ship a new `/admin/clients/$clientId` workspace shell with an Overview tab. Coach mirror at `/coach/clients/*` reuses the same components with the existing `is_assigned_coach` gate. Workspace tabs 2–8 link out to existing pages until rebuilt in later phases.

## Scope (this pass)

In:
- New directory page with summary cards, URL-driven search/filters/sort/page, paginated rows, status layer, next-best-action, three-dot menu.
- New workspace shell route `/admin/clients/$clientId` + `/coach/clients/$clientId` with sticky header and tab bar.
- New Overview tab built from modular cards.
- Old `/admin/client-programs/$clientId` route kept and redirected to the new workspace; deep links preserved.
- One Postgres RPC powering directory rows + summary counts.

Out (later phases): Training, Nutrition & Cardio, Check-Ins, Payments, Communication, Documents, Account tabs (links to existing routes for now), bulk actions, row checkboxes.

## Data layer

Single migration adds:

1. `public.admin_clients_directory(p_actor uuid, p_search text, p_status text, p_coaching_type text, p_coach_id uuid, p_program_status text, p_payment_status text, p_sort text, p_limit int, p_offset int)` — security-definer RPC returning:
   - `rows jsonb[]` — `{ id, name, email, avatar_url, coaching_type, coach_id, coach_name, current_block:{name,start,end,pct,days_left}, next_phase, status_flags:[…], next_best_action:{label,kind,href}, last_activity_at }`
   - `total_count int`, `summary_counts jsonb` with keys `all, needs_setup, needs_review, program_ending, payment_issues, new_clients`.
   - Scoping: if caller has `admin`, no filter; else filter by `is_assigned_coach(c.id)`. Granted to `authenticated`.
2. `public.admin_client_overview(p_client_id uuid)` — single fetch for Overview cards: attention list, current/next training, latest check-in, nutrition/cardio status, payment summary, upcoming sessions, recent messages, onboarding %.
3. Indexes (only if missing): `clients(active, full_name)`, `clients(updated_at desc)`, `pl_blocks(client_id, archived, end_date)`, partial `clients(coach_id) where archived=false`.

Status priority lives in the RPC (one source of truth):
`payment_blocking > onboarding_incomplete > overdue_review > program_ended > program_ending_soon > missing_program > missing_nutrition_or_cardio > active`.

## Files changed / created

Routes
- `src/routes/_authenticated/admin/clients.index.tsx` — rewrite as directory.
- `src/routes/_authenticated/admin/clients.$id.tsx` — rewrite as workspace shell (header + tab bar + Outlet).
- `src/routes/_authenticated/admin/clients.$id.index.tsx` — Overview tab (new).
- `src/routes/_authenticated/admin/client-programs.$clientId_.tsx` — keep as tombstone, redirect to new workspace `?tab=training`.
- `src/routes/_authenticated/coach/clients.index.tsx` — thin wrapper around the same directory component (scope handled in RPC).
- `src/routes/_authenticated/coach/clients.$id.tsx` + `clients.$id.index.tsx` — coach mirror.

Components (new)
- `src/components/clients/ClientsDirectory.tsx` — page body (header, summary cards, toolbar, list, pagination).
- `src/components/clients/SummaryCards.tsx`
- `src/components/clients/ClientToolbar.tsx` (search + filters, debounced, URL-synced)
- `src/components/clients/ClientRow.tsx` (desktop list-card hybrid) + `ClientRowMobile.tsx` (card layout)
- `src/components/clients/ClientRowSkeleton.tsx`
- `src/components/clients/NextBestActionButton.tsx`
- `src/components/clients/ClientRowMenu.tsx` (DropdownMenu wrapper, permission-gated)
- `src/components/clients/StatusBadges.tsx` (≤3 badges, color rules)
- `src/components/clients/Pager.tsx`
- `src/components/clients/workspace/WorkspaceHeader.tsx`
- `src/components/clients/workspace/WorkspaceTabs.tsx` (horizontal, mobile-scrollable)
- `src/components/clients/workspace/overview/*` — `AttentionCard`, `CurrentTrainingCard`, `NextPhaseCard`, `LatestCheckInCard`, `NutritionCard`, `CardioCard`, `PaymentCard`, `UpcomingSessionsCard`, `RecentMessagesCard`, `OnboardingCard`.

Server functions (new file: `src/lib/clients-directory.functions.ts`)
- `listClientsDirectoryFn` → wraps `admin_clients_directory` RPC, validates with Zod, returns DTO.
- `getClientOverviewFn` → wraps `admin_client_overview`.

Shared
- `src/lib/clients-status.ts` — TS mirror of status flags + color tokens + icon map (display only; logic stays in RPC).
- `src/lib/admin-nav.ts` — point Clients item to new workspace URL.

## URL contract

`/admin/clients?search=&status=&type=&coach=&program=&payment=&sort=&page=&size=`

Validated with `zodValidator` + `fallback()`. `loaderDeps` includes only these; loader calls `ensureQueryData(listClientsDirectoryFn(deps))`. Component uses `useSuspenseQuery`. Search input debounced 250 ms before pushing to URL. Scroll position restored by TanStack router (already enabled).

## Workspace shell

```
/admin/clients/$clientId            → Overview (index)
/admin/clients/$clientId?tab=training → redirects to existing /admin/client-programs/$clientId
…same for nutrition/cardio/checkins/payments/messages/documents/account
```

The shell always renders WorkspaceHeader + WorkspaceTabs; clicking a non-Overview tab navigates to the existing page (which keeps its current route, so nothing else breaks).

## Visual rules

- Red only for `payment_blocking` / `overdue_review` / destructive menu items.
- Amber for upcoming deadlines (`program_ending_soon`, `due_soon`).
- Green for active/completed, blue for informational, muted for inactive.
- One filled primary button per row (the next-best-action). Everything else lives in the kebab menu or the workspace.
- 44×44 tap targets on mobile; icons always paired with `aria-label`/visible text.

## Permissions

- RPC is `security definer` and reads `has_role` / `is_assigned_coach` against `auth.uid()`; coaches automatically get scoped rows + scoped summary counts.
- Workspace shell calls existing `getClientById` (already RLS-guarded). 403 → friendly empty state with "Back to Clients".

## Acceptance checks before sign-off

- Directory: no full-record fetch (only RPC); pagination/search/sort/filters work via URL; refresh preserves state; return-to-list keeps scroll.
- Coach login sees only assigned clients in rows AND in summary counts.
- Old `/admin/client-programs/$clientId` URLs redirect to new workspace.
- Mobile: no horizontal scroll on directory; cards stack.
- TS build + lint pass; vitest green.

## Out of scope / explicit deferrals

- Tabs 2–8 rebuild, bulk selection, exports, archive-from-list, account/settings tab — Phase 3+.
- No data migrations on `clients` itself; redesign is read-side only.

After approval I'll start with the migration (RPC + indexes), then the directory rewrite, then the workspace shell + Overview.
