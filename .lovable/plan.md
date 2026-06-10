# JF Membership Account Type

## Goal

Treat **JF Membership** as a non-coaching subscription that auto-receives a standard bundle of self-guided features (programs, tracking, recipes, resources, events, announcements, community) and is automatically excluded from 1:1 coaching surfaces. Admins get a one-click setup checklist and a clear access summary on the member profile.

## Strategy

The app already has the right primitives:

- `app_members.account_type` — but currently limited to `app_member | program_only`. We extend the CHECK and add `jf_member`.
- `access_levels` + `member_access` — already used to gate Plan Library, Resource Library, etc. We seed a default bundle on JF Membership creation/approval.
- `audience_scope` on broadcasts / `access_scope` on recipes / `audience_scope` on events — already includes `app_members`. JF members satisfy that scope.
- Subscription gating already flows through `member_access.active` + `expires_at`.

We do NOT introduce a parallel feature-flag system. We use what's there and add a default seed + admin UX + a small upgrade-prompt component for coaching-only surfaces.

## Plan

### 1. Database migration

- Extend `app_members.account_type` CHECK to include `jf_member`.
- Add two access-level rows so JF maps cleanly:
  - `jf_membership` (label "JF Membership") — superset key checked by JF-only content.
  - `community` (label "Community") — chats, announcements.
  - (Reuse existing `program_library`, `resource_library`, `app_membership`, `nutrition_tools` for the rest.)
- Add `member_access_defaults` table keyed by `account_type` listing which `access_level_key`s to auto-grant. Pre-seed JF Membership with the default bundle. Pre-seed `app_member` and `program_only` with their current de-facto defaults so we don't regress.
- Add a SECURITY DEFINER function `apply_default_member_access(_member_id uuid)` that inserts missing rows from the defaults table for that member's `account_type`. Idempotent.
- GRANTs + RLS as standard (admin manage, member read own).

### 2. Server: seed defaults on create / approve / type-change

In `src/lib/members.functions.ts`:

- Accept `jf_member` in the create/update Zod enums.
- After insert in `createAppMember`, call `apply_default_member_access(member_id)`.
- In the update path, when `account_type` changes, call the same function.
- New server fn `applyDefaultMemberAccess({ memberId })` for the "Apply defaults" button.

### 3. Membership defaults bundle

JF Membership grants (via `member_access` rows):

```text
jf_membership, app_membership, program_library, resource_library,
nutrition_tools, community
```

JF Membership explicitly does NOT grant:

```text
coaching_access, premium_member  (premium stays admin-grant only)
```

### 4. Audience scopes — JF satisfies "app_members"

Already true in code (JF rows live in `app_members`). The visibility helpers (`user_can_see_broadcast`, `user_can_see_recipe`, event filters) already gate on the `app_members` table, so any `app_members`-scoped broadcast/recipe/event/resource is automatically visible. No code changes needed for visibility; we only need to make sure JF members are never picked up by `coaching_clients` scope (they aren't — that scope checks `clients`).

For events specifically, `AUDIENCE_SCOPES` is `["selected_clients","all_coaching","app_members","program_only"]`. JF members are visible to `app_members`; verified.

### 5. Admin member-creation UX

`src/routes/_authenticated/admin/members.new.tsx`:

- Add `JF Membership` to the account-type segmented control.
- When `jf_member` selected, render the **Default Access Checklist** card:
  - Auto-checked items showing each access level that will be granted.
  - Auto-disabled (greyed) items: 1:1 coaching chat, custom workout, custom nutrition, lift review, coach review queue, coach notes.
  - "Override" toggle per row to uncheck (writes the per-row override before insert).
- Submit calls existing create flow → server seeds defaults from the table (minus overrides).

`src/routes/_authenticated/admin/members.$memberId.tsx`:

- Header chip shows account type with distinct color (Coaching client / JF Membership / App Member / Program-Only).
- **Access Summary** card listing each granted access level + subscription status (Active / Past Due / Cancelled / Expired) derived from `app_members.status`.
- "Apply default access" button → calls `applyDefaultMemberAccess`.
- "Manage access" → existing access editor (already exists for app_members).

### 6. Subscription-state gating

Already in place: `member_has_access` SQL function returns false when `active=false` or `expires_at` past. We add a small client helper `useMemberAccess()` that returns:

```ts
{ accountType, status, granted: Set<access_level_key>, hasAccess(key) }
```

When `status` is `Past Due | Cancelled | Expired | Deactivated`, `hasAccess` returns false and the portal renders a billing banner (component `<SubscriptionRestrictedBanner />`) on member-portal routes.

### 7. Coaching-only upgrade prompt

New component `src/components/upgrade-to-coaching-prompt.tsx`:

- Shows a friendly card: "This feature is available with coaching."
- Two buttons: "Upgrade to Coaching" (links to a configurable upgrade URL / falls back to `/portal/upgrade`) and "Message Support" (opens existing Support Chat).
- Wrap the JF-visible-but-coaching-only routes (coach chat, lift review submission, custom nutrition page) with a guard: if `accountType === 'jf_member'`, render the prompt instead of the page.

### 8. Chat labels

In the member portal sidebar / page header, if `accountType === 'jf_member'` and the only available conversation is the support thread, label it **Support Chat** (not Coach Chat). This is a single string change in the portal chat component.

### 9. Files added / edited

```text
supabase/migrations/<ts>_jf_membership.sql       NEW
src/lib/members.functions.ts                     EDIT (enum + seed call + applyDefaults fn)
src/lib/member-access.ts                         NEW (useMemberAccess hook)
src/components/upgrade-to-coaching-prompt.tsx    NEW
src/components/subscription-restricted-banner.tsx NEW
src/components/admin/jf-default-access-checklist.tsx NEW
src/components/admin/member-access-summary.tsx   NEW
src/routes/_authenticated/admin/members.new.tsx  EDIT
src/routes/_authenticated/admin/members.$memberId.tsx EDIT
src/routes/_authenticated/portal/ (coach chat / lift review / nutrition pages) EDIT (guard)
```

### 10. Out of scope (call out)

- **Habit tracking** and **challenges** are listed in the spec but don't exist in this codebase yet. I will wire access levels for them so they "just work" when those features ship, but I won't build the feature itself.
- **Stripe webhook → auto-set status** already exists; I will not refactor it.

## Acceptance check

- Create a JF Membership account → access summary shows Programs / Recipes / Resources / Events / Community enabled, Coaching disabled.
- Browse `/portal/plans` as a JF member → only `app_membership`-or-`jf_membership`-scoped plans appear.
- Visit `/portal/coach` as a JF member → upgrade prompt instead of coach chat.
- Set member status to `Past Due` → portal shows billing banner; protected content is hidden.
- Admin profile page shows account-type chip + Access Summary + "Apply defaults" button.

Approve to build?
