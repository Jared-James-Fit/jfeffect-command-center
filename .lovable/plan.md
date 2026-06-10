
# Membership Admin Dashboard — Implementation Plan

This is a large change. I want to confirm scope before writing code, because much of what you listed (Members list, JF settings, billing, resources, etc.) already exists scattered across the coaching admin. The plan is to **reorganize and add a switcher**, not rebuild every tool from scratch.

## Approach in plain English

1. **Add a "Dashboard Mode" switcher** at the top of the admin shell with two options: **Coaching** and **Membership**. The choice is remembered per-admin in localStorage. Default = Coaching.
2. **Two admin nav configs** instead of one. The current `adminNav` becomes `coachingAdminNav` (membership-only entries stripped out, plus one shortcut row "JF Membership Dashboard" that flips the switcher). A new `membershipAdminNav` is grouped exactly as you described (Overview / Sales / Members / Billing / Setup Tools / Content / Community / Settings).
3. **New Membership Dashboard landing page** at `/admin/membership` with the stats grid (active / trialing / past due / cancelled / hold / paused / incomplete setup / missing pfp / missing phone / missing SMS consent / recent signups / upcoming trial endings) and an **Action Needed** panel.
4. **Reuse existing pages wherever possible.** The existing routes (`/admin/members`, `/admin/members/$memberId`, `/admin/member-plans`, `/admin/member-resources`, etc.) already implement most of what you listed — I just re-group them under the membership nav rather than duplicating them. New filtered views (Incomplete Setup, Missing Profile Picture, Missing Phone, SMS Consent Missing, Trials, Past Due, Hold Plan, Paused, Cancelled) are thin filter presets over the existing members list.
5. **New small pages** that don't exist yet: Signup Stats, Action Needed, Stripe Sync, Setup Links bulk page, SMS/Email Tools page, Access Checklist editor, Sales Page admin (wraps existing JF settings card + public link copy/preview), Welcome Messages.
6. **Member profile picture requirement** for JF members — surfaced as a flag on the dashboard + member profile banner. Not blocking sign-in; visible as "Setup incomplete — profile picture required."
7. **Admin account protection (Parts 12–14)** — server-side checks in member/role mutation server fns: refuse to delete/deactivate/demote when it would leave 0 active admins. Add a `is_primary_admin` flag (migration) and protect that account from normal-UI destructive actions.

## Out of scope for this pass (call out so we agree)

- **Challenges** (community sub-item) — no existing system; I'll add a placeholder route with "Coming soon" rather than build it.
- **Promo Tools** under Sales — same, placeholder.
- **Public "Forgot login → Send reset link"** on the sales/login page — small addition, included.
- **SMS-based password reset** — Supabase Auth doesn't support SMS recovery natively; I'll wire email reset everywhere and stub the SMS button as disabled with a tooltip.
- I will **not** rewrite already-working tools (member edit, resources CRUD, programs CRUD, group chats). They get re-linked under membership nav.

## Technical sketch

```
src/lib/admin-nav.ts          → split into coachingAdminNav + membershipAdminNav
src/lib/dashboard-mode.ts     → new: localStorage hook, "coaching" | "membership"
src/components/dashboard-mode-switcher.tsx → segmented toggle in admin header
src/components/app-shell.tsx  → read mode, swap nav items

src/routes/_authenticated/admin/membership/route.tsx      → layout guard
src/routes/_authenticated/admin/membership/index.tsx      → dashboard + stats
src/routes/_authenticated/admin/membership/action-needed.tsx
src/routes/_authenticated/admin/membership/signup-stats.tsx
src/routes/_authenticated/admin/membership/sales-page.tsx
src/routes/_authenticated/admin/membership/setup-links.tsx
src/routes/_authenticated/admin/membership/sms-email.tsx
src/routes/_authenticated/admin/membership/stripe-sync.tsx
src/routes/_authenticated/admin/membership/access-checklist.tsx
src/routes/_authenticated/admin/membership/members.tsx        (filter presets: ?filter=trial|past_due|hold|paused|cancelled|incomplete|no_pfp|no_phone|no_sms)

src/lib/membership-admin.functions.ts → getMembershipStats, getActionNeeded, bulkSendSetupLink, bulkStripeSync, requireProfilePicture flag
src/lib/admin-protection.functions.ts → assertNotLastAdmin, setPrimaryAdmin, protected delete/deactivate/role-change wrappers
```

### Migration
- `app_members.profile_picture_required boolean default true` (or read from settings)
- `user_roles` → add `is_primary boolean default false`; seed the first existing admin as primary
- Helper `public.count_active_admins()` SECURITY DEFINER
- Triggers on `user_roles` + `app_members` that refuse to drop the last active admin or demote/deactivate the primary

## What I need from you

Two quick decisions before I start:

1. **Build all 19 parts in this single batch?** It's a large change (~15–20 files, 1 migration). I can do it, but I want to confirm you're OK with one big push vs. shipping the switcher + dashboard + nav reorg first and then layering the rest.
2. **Profile picture requirement** — should it actually **block portal access** for JF members until uploaded, or just show a banner? Your spec says "mandatory" but also just shows a message. I'll default to **banner + dashboard flag, not a hard gate**, unless you say otherwise.
