
# Admin Home → Command Center Rebuild

Based on your answers:
- **New client** = created within last **30 days**
- **Payment Issues card** = **hidden when zero** issues
- **Bottom nav** = **Home / Clients / Messages / Reviews / More** (Tasks moves into More)
- **Personalization** = new **`admin_dashboard_prefs`** table (syncs per user)

---

## 1. Unified Attention Engine (single source of truth)

Create `src/lib/attention.functions.ts` with `getAttentionFeed` (server fn, `requireSupabaseAuth`, admin role check). It returns one ranked list pulled from:

- Pending check-in / nutrition / cardio reviews
- Expired or expiring-in-≤3-days programs / nutrition / cardio targets
- Overdue tasks & event deadlines assigned to admin
- Payment issues (failed charges, past-due invoices)
- Onboarding gaps (no program / nutrition / cardio assigned, missing intake)
- New clients (created ≤30 days, prioritized if onboarding incomplete)

Each item: `{ id, kind, severity (critical|warn|info), clientId?, title, subtitle, actionLabel, actionHref, createdAt }`. Sorted by severity → recency. Capped to top 50; top 5 shown on Home, rest paginated in `/admin/attention`.

This kills the contradictory status signals: every card on Home reads from the same feed, so "Needs Setup" vs "Active" never disagree.

## 2. New Dashboard Hierarchy (`src/routes/_authenticated/admin/index.tsx`)

```text
[Greeting + date + 1-line status summary]
[Priority Feed]            top 5 attention items, big tap targets (≥56px)
[Quick Actions grid]       2 cols × icon tiles, ≥72px tall
  - Add Client
  - Assign Program
  - Assign Nutrition
  - Assign Cardio
  - New Message
  - Schedule Event
[Metrics strip]            horizontal scroll: Active clients · New (30d) · Reviews pending · Revenue MTD
[Clients Needing Action]   swipe carousel of client cards w/ inline actions
[Today's Schedule]         collapsed by default if empty
[Payment Issues]           rendered ONLY when count > 0
[More →]                   integrations, full payments, Client POV, etc.
```

All buttons: `min-h-12 min-w-12`, full labels (no truncation), `text-base`. Skeleton loaders while feed loads.

## 3. Bottom Nav Restructure

Update `src/components/app-shell.tsx` floating bar:
- Tabs: **Home · Clients · Messages · Reviews · More**
- Tasks moves into `/admin/more` (alongside Integrations, Settings, Library, etc.)
- Fix safe-area: add `pb-[calc(env(safe-area-inset-bottom)+88px)]` to main scroll container so content never hides under the bar.

## 4. Personalization

New migration: `admin_dashboard_prefs` table
- `user_id` (PK, FK auth.users)
- `section_order` (jsonb array of section keys)
- `hidden_sections` (jsonb array)
- `created_at`, `updated_at`
- RLS: user can read/write own row; service_role full
- GRANTs to `authenticated` + `service_role`

Settings drawer on Home (gear icon) lets admin reorder/hide sections. Saved via `saveDashboardPrefs` server fn.

## 5. Logic Fixes

- **New-client classifier**: `created_at >= now() - interval '30 days'`. Today every client is "New" because the old check uses account age incorrectly — fixed in attention engine.
- **Needs-Setup classifier**: only flagged when *all three* (program, nutrition, cardio) are unassigned OR intake is incomplete. Today every client is flagged because the check returns true on any missing field.
- **Payment products**: filter ledger by `status in ('failed','past_due')` instead of any non-paid status.

## 6. Files to Add / Edit

- ADD `src/lib/attention.functions.ts` — `getAttentionFeed`, `saveDashboardPrefs`, `getDashboardPrefs`
- ADD `src/components/admin/command-center/priority-feed.tsx`
- ADD `src/components/admin/command-center/quick-actions-grid.tsx`
- ADD `src/components/admin/command-center/metrics-strip.tsx`
- ADD `src/components/admin/command-center/clients-needing-action.tsx`
- ADD `src/components/admin/command-center/section-settings-drawer.tsx`
- ADD `src/routes/_authenticated/admin/attention.tsx` (full paginated list)
- ADD `src/routes/_authenticated/admin/more.tsx` (Tasks, Integrations, etc.)
- ADD migration `admin_dashboard_prefs` table
- EDIT `src/routes/_authenticated/admin/index.tsx` — full rewrite to new hierarchy
- EDIT `src/components/app-shell.tsx` — new 5-tab bottom nav + safe-area padding
- EDIT `src/components/clients/clients-status.ts` — fix Needs-Setup + New-client logic (reuse in attention engine)

## 7. Verification Plan

After build, drive Playwright headless against `/admin` at 390×844 viewport:
- Screenshot Home top, mid, bottom — confirm no overlap with floating bar
- Tap each Quick Action tile — confirm navigation
- Confirm Payment Issues card hidden when count is 0
- Confirm at least one client shows correct mixed status (e.g. Program green, Nutrition red)

---

**Estimated diff**: 1 migration, ~12 files, ~1,200 lines net.

Reply **go** to start. I'll begin with the migration (requires your approval), then ship the server fn + UI in one pass.
