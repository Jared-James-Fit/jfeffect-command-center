# JF Effect as a coaching platform: architecture, permissions and plan

Written Nov 22 2026 from an audit of the production codebase (868 migrations,
~1,050 RLS policies on ~400 tables, every Stripe, Cleo, nutrition, importer
and legal path). This is the plan the platform expansion is built against.
It says what exists, what was fixed, what the target model is, and what has
to be true before each part ships.

## 1. Where the app stands

The app is one business. That's fine for JF Effect and it's the main thing
standing between today and independent coaches.

| Area | What exists | What it means for the expansion |
|---|---|---|
| Tenancy | None. No org, tenant or workspace column anywhere. `has_role(…,'admin')` means "sees everything" in ~447 policies on ~311 tables. | Every client-data policy needs an org boundary before a second business can exist. |
| Coach access | `coach` role + `coaches` row + `clients.assigned_coach_id`. Core client tables (clients, messages, programs, sessions, check-ins) are scoped to assigned clients. | 59 tables and 75 SQL functions check the `coach` role with no client scoping (tasks, events, booking setup, AI plans, reports, Crew moderation, staff group chats, settings, voice, templates). Giving an outside coach today's `coach` role would leak JF Effect's business. |
| Server functions | 192 files use the service role; ~20 pair an admin-or-coach role check with it. Money functions treat a permission as business-wide (built for the finance login). | Every service-role path needs an org check; money permissions can't be granted per coach until the functions are client-scoped. |
| Permissions | `role_permissions` (role → key), seeded only for `finance`. `has_permission` = owner for `finance.*`, admin for the rest. | Good shape to extend; needs per-org, per-person grants. |
| Stripe | One account. Hand-written `fetch` helper (`stripe.server.ts`), 7 files bypass it, no API version pinned, one webhook, no Connect anywhere. | Connect needs one account context threaded through ~20 modules, a separate webhook, per-account customers, and the books filtered to the owner's account. |
| Nutrition | Meals are free text in `nutrition_target_days.notes` in one paste format, read by parsers (`parseMealPlan`, `structureMealPlanDay`, `splitFoodLine`). No food database. Members have targets only (`member_nutrition_targets`); a meal plan is coach-written and read-only to the client. | A structured builder must keep writing the same records, or every reader (meal cards, food log, PDF, grocery list, roadmap) breaks. |
| Importer | Workout importer is complete (PDF/XLSX/CSV/DOCX/text/photos, rights tick, background AI on the OpenAI key, review in the builder, files deleted in 7 days). | Its extraction, queue, rights and credits are reusable for nutrition; the parse and review are workout-specific. |
| Cleo | Reads through the caller's own login (RLS). Access is `cleo_allowed()`. Every coach action card runs as the owner after the owner approves. Prompt names one business, time zone and owner. | Per-org Cleo needs org-scoped data, per-kind permissions that run as the coach, approval by that org's owner, per-org documents, voice and metering. |
| Legal | Versioned documents with drafts, publish confirmation, immutable published text, acceptance evidence stamped by the database. | Sign-up was passive (fixed, below). No data export or access request, no copyright process, `marketing_email` consent isn't read by senders, renewed-consent fields are stored but unused. |

## 2. Fixed now (Phase 1)

All tested; none changes what a client or member sees.

1. **Stripe webhook lost events on failure.** The event id was claimed before
   handling, so a handler that threw returned 500 and Stripe's retry was
   dropped as a duplicate. The claim is now released on failure
   (`stripe-webhook.ts`, test in `webhook-idempotency.test.ts`).
2. **Sign-up acceptance was passive.** `/activate` said "By joining you
   agree…" with no box and no record. It now has an unticked box, the server
   refuses without it, and the published Terms and Privacy Policy are recorded
   in `legal_acceptances` (context `signup`) (`legal-signup.ts`).
3. **Revoking a coach didn't revoke anything.** Suspending or archiving a
   coach changed the record but left the `coach` role, so every policy kept
   letting them in. Now the role follows the record in the database
   (`coaches_access_follows_status`), and coaches already suspended lost it.
4. **A revoked coach could reinstate themselves.** `acceptCoachInvite` trusted
   the `coach_id` left in the login's metadata and set the record back to
   Active. It now accepts only a pending invite sent to that login.
5. **Purchase dates.** `update_purchase_term_dates` let any coach change any
   client's purchase; `auto_calculate_purchase_term_dates` had no check at all
   (any account could date an undated purchase and read back the whole row).
   Both now allow only the admin, the client's own coach and the server.
6. **Cleo shared its table list across people.** The data catalog was cached
   module-wide, so after an admin's lookup a coach got the list too. It's now
   kept per login.
7. **Organizations foundation** (`20270506090000_organizations_foundation.sql`):
   `organizations` (JF Effect seeded), `organization_members` (kept in step
   with staff roles and the business owner by triggers, never typed twice),
   `organization_audit_log` (append-only, database-written: who joined, lost
   or regained access, every client assignment), helpers `jf_org_id()`,
   `my_org_ids()`, `my_admin_org_ids()`, `is_org_admin()`. Nothing here grants
   access. The coach page shows the record ("Access record").

Database tests for 3, 5 and 7: `supabase/tests/organizations/` (45 checks on
real Postgres, including RLS as each kind of login).

## 3. Target model

### Principals

| Experience | Who | How they're identified | Data boundary |
|---|---|---|---|
| Member | Anyone free | `clients` row, `service_tier = 'self_serve'` | Their own records only. Shares with a coach only through an active coach relationship. |
| Client of a coach | A member a coach took on | Same `clients` row + a relationship to one organization | Their records; their coach's org sees what the relationship allows. |
| JF Effect coach | Invited by the owner | `organization_members` in JF Effect, role `coach` | Assigned clients + what their permissions allow. Never the books. |
| Independent coach | Signs up as a coach | `organization_members` in their own org, role `owner` | Their org only. Never JF Effect's clients, money, documents or settings. |
| Platform owner | Jared | Owner of JF Effect + platform admin | JF Effect fully. Other orgs only through an audited, time-limited support grant. |

A person can belong to several organizations. Every request resolves one
**active organization** (chosen in the app, verified on the server against
`my_org_ids()`, never trusted from the client).

### Client ownership

A client's training, nutrition and history belong to the client. An
organization holds a **relationship** (`organization_clients`: org, client,
assigned members, started, ended, who may export). Ending a relationship ends
the org's access; it never deletes the client's data and never transfers it
to another org. Moving a client between orgs is the client's choice (a new
relationship they accept), never an admin's.

### Isolation: how a second business becomes safe

Two layers, both required:

1. **A tenant fence on every client-keyed table** (one restrictive policy per
   table, ANDed with the existing permissive ones):
   `client_id IS NULL OR client_id NOT IN (SELECT tenant_hidden_client_ids())`,
   where the hidden set is the clients of organizations the caller isn't in
   (plus support grants). While there are no independent orgs the set is
   empty, so it changes nothing and costs one empty set per query. User-keyed
   tables get the same fence on `user_id`. This is what stops the platform
   admin's global `has_role(admin)` from reaching another business.
2. **Org-scoped staff access.** The 59 tables and 75 functions that trust the
   bare `coach` role move to `org_id IN (SELECT my_org_ids())` (tasks, events,
   booking setup, templates, forms, settings) or become JF Effect-only
   (Crew moderation, daily posts, staff chats). Independent coaches never
   receive the global `coach` role; their access is membership only.
3. **Service-role paths.** Every server function that acts as the service
   role after a role check gets an org check (`assertOrgAccess(ctx, org,
   permission, clientId?)`), starting with the ~20 that pair a coach check
   with the service role.

The fence is generated from live `pg_policies`, not from migration replay:
the audit replay misses policies built with dynamic SQL, and production
migrations are applied by hand.

### Permissions matrix

Per membership: a role sets the default, an owner can add or remove
individual keys. Keys are enforced in SQL (`has_org_permission(org, key)`)
and on the server; the UI only hides.

| Key | Owner | Admin | Coach (default) | Assistant | Notes |
|---|---|---|---|---|---|
| clients.view_assigned | ✓ | ✓ | ✓ | ✓ | Assigned clients only |
| clients.view_all | ✓ | ✓ | – | – | Whole org's roster |
| clients.manage | ✓ | ✓ | – | – | Add, archive, assign |
| programs.edit | ✓ | ✓ | ✓ | – | Assigned clients' programs |
| templates.shared | ✓ | ✓ | read | read | Org template library |
| nutrition.edit | ✓ | ✓ | ✓ | – | |
| messages.send | ✓ | ✓ | ✓ | ✓ | Assigned clients' chats |
| checkins.review | ✓ | ✓ | ✓ | ✓ | |
| tasks.use | ✓ | ✓ | shared only | shared only | Only tasks and projects shared with them |
| billing.view | ✓ | ✓ | – | – | Org's payments, assigned clients only for coaches if granted |
| billing.manage | ✓ | – | – | – | Packages, links, refunds |
| settings.manage | ✓ | ✓ | – | – | Branding, booking, forms |
| members.manage | ✓ | – | – | – | Invite, change, revoke |
| cleo.use | ✓ | ✓ | if on | – | Cleo with the member's own permissions |

Money keys become grantable to a coach only after the money functions take a
client and check it against the coach's assignments (today they act for any
client once the permission passes, because they were built for the finance
login).

### Invitations (three relationships, kept apart)

- **Join JF Effect as a coach**: today's coach invite (Team → Coaches), which
  now really revokes. Next: invite carries role, permissions and clients, and
  the accept step applies them.
- **Share a project or task group**: a `projects` table (name, members);
  tasks and team notes in a project are visible to its members only. Needs
  the tasks policies to stop trusting the bare `coach` role.
- **Operate independently**: a coach creates their own org (owner). Off until
  the release gate below.

### Support access

`support_access_grants` (org, granted_to, reason, scope, expires_at ≤ 72 h,
approved_by the org's owner, revoked_at). The fence treats an active grant as
membership for its scope; every read under a grant is logged to the org's
access record, which the org's owner can read.

## 4. Phases and release gates

Each phase ships only when its gate passes. Anything legally unapproved stays
off behind an admin setting.

### Phase 1: audit and foundations (done, this branch)
Gate: tests pass, nothing user-visible changes except the sign-up box and the
coach page's access record. **Passed.**

### Phase 2: Nutrition Studio and nutrition import (members)
- Members own a plan in the same tables coaches use (`nutrition_targets` +
  days on their own `clients` row). RLS: a self-serve client writes plans
  where `assigned_coach_id IS NULL` and the plan is theirs; a coached client
  stays read-only; a coach's plan is never editable by the client.
- A structured editor (meals → foods with amounts) that serializes to the
  existing paste format, so every reader keeps working; per-food macros from
  a food table with its source on every row (USDA FoodData Central values for
  staples, already used in `food-values.ts` and the cookbook; a person's own
  foods labelled as theirs). An external food API needs an API key and its
  host allowed; none is configured.
- Nutrition import reuses `program-import`'s extraction, queue, rights tick
  and credits; the AI writes the paste format and `parseMealPlan` reads it;
  review in the same editor before anything saves.
- Duplicate day / week, apply to several days, undo / redo and autosave reuse
  the program workbench's editor patterns.
Gate: a member's plan renders on Nutrition, logs in one tap, prints and makes
a grocery list exactly like a coach's; a coached client still can't edit.

### Phase 3: coach workspaces and isolation
Order matters:
1. `organization_clients`, the fence generator, and the fence applied to every
   client-keyed table (generated from live `pg_policies`, one migration per
   table group, each with its rollback).
2. Org-scope the 59 tables / 75 functions; JF Effect-only for Crew staff work.
3. `assertOrgAccess` on every service-role path.
4. Isolation test suite: two orgs, every table, every server function, every
   storage bucket, direct URLs and Cleo questions, as each principal.
5. Per-person permissions, project sharing, support grants.
6. Coach workspace UI (Clients · Training · Nutrition · Business · Cleo) on the
   existing screens, scoped by active org.
Gate: the isolation suite passes with zero cross-org reads; legal documents
for independent coaches published after counsel review.

### Phase 4: Cleo per organization
Org-scoped prompt inputs (business name, time zone, owner, voice, documents,
links), `cleo_allowed()` per org, action kinds mapped to permission keys that
run with the requester's own login (no more running as the JF owner),
approval by that org's owner, a per-org log of tool calls, and metering per
org. Saved preferences and procedures per org; nothing learned from one org
is used for another.
Gate: Cleo isolation questions (asking for another org's client by name, id
or table) return nothing; every action is logged with its approver.

### Phase 5: Stripe Connect
- Standard connected accounts with Stripe-hosted onboarding; direct charges
  with the coach as merchant of record; no platform fee unless configured and
  disclosed. Requires Connect enabled on JF Effect's Stripe account and the
  platform profile approved by Stripe.
- One account context: `stripeFetch(..., { stripeAccount })` sends
  `Stripe-Account`; `stripeContextFor(row)` replaces `keyFor(mode)`; the 7
  files that bypass the shared helper move onto it first.
- `coach_stripe_accounts`, nullable `stripe_account_id` on purchases, ledger,
  products and auto-pay changes (null = the owner), customers per account.
- A separate Connect webhook with its own secret, routed by `event.account`,
  matching sales only within that account, Stripe-Version pinned.
- The owner's books read `stripe_account_id IS NULL` only.
- Each coach sets up Stripe Tax on their account before checkouts work there.
Gate: test-mode end to end (onboard, product, checkout, subscription, refund,
dispute, failed payment, webhook retry) with the owner's books unchanged.

### Phase 6: legal and privacy readiness
Drafts in `docs/legal/` (this branch) go to Canadian counsel. Then: publish,
data export (a person's records as JSON + their files), correction and
access requests, `marketing_email` honoured by senders, renewed consent read
from `requires_reacceptance`, a copyright complaint form and reason, upload
rights on every upload surface, privacy incident log.
Gate: counsel sign-off recorded on each version (`needs_legal_review` cleared
only by that).

### Phase 7: QA and release
Full matrix as member, client, JF coach, independent coach, finance, owner;
denied access, imports, exports, failed payments, client moves; production
migrations applied with their rollbacks ready.

## 5. Decisions only Jared can make

1. **Is there demand?** Independent coaches mean support, disputes, privacy
   obligations as a service provider, and Stripe Connect liability for a
   business with ~16 coaching clients today. Worth confirming coaches who'd
   pay before Phase 3, which is the largest and riskiest phase.
2. **Price for independent coaches** (subscription to JF Effect, a disclosed
   platform fee, or both).
3. **Charge model** for JF Effect team coaches: central (JF Effect collects)
   or their own connected account, per coach agreement.
4. **Do independent coaches' clients join Crew?** Crew is one community
   today; mixing businesses there is a product and moderation choice.
5. **Counsel.** The legal drafts need a Canadian lawyer before any of the
   coach features turn on.
