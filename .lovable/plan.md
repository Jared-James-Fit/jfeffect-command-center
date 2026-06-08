# Membership Platform — Phase 2: Resources, Access Mapping, Upgrade Flow

Wraps up the deferred items from Phase 1. All three ship together so the member experience and admin control surface are complete.

## 1. Resources & Tools Library

A single `member_resources` table powers both the **Resources** tab (guides, PDFs, videos, links) and the **Tools** tab (calculators, trackers, external tools). One model, filtered by `kind`.

### Schema
- `member_resources`: `title`, `slug`, `description`, `kind` ('resource' | 'tool'), `format` ('pdf' | 'video' | 'link' | 'article' | 'calculator' | 'embed'), `url` (external link or storage path), `thumbnail_url`, `body_md` (long-form), `required_access_level` (text, default `app_membership`), `status` ('Draft' | 'Published' | 'Archived'), `featured` (bool), `sort_order` (int), `created_by`.
- Storage bucket `member-resources` (private) for uploaded PDFs/files. Signed URLs only.
- RLS: published rows readable to authenticated; admin/coach full CRUD; member reads gated server-side by `member_has_access`.
- Reuse `featured_member_items` (already supports `item_type='resource'`) for the curated resources strip on the dashboard.

### Admin UI
- `/admin/resources-library` — list with tabs (All / Resources / Tools / Drafts), New button, inline status/featured toggles. (Repurpose the existing `/admin/resources.tsx` coaching page only if member-facing; otherwise new route `member-resources.index.tsx` + `.$id.tsx` + `.new.tsx` mirroring the member-plans pattern.)
- New/edit form: title, kind, format, URL or file upload, access level dropdown, description, body markdown, thumbnail, featured + sort_order.
- Add "Featured Resources" manager card on the same page (mirrors Featured Plans).

### Member UI
- Rewrite `/m/resources.tsx` and `/m/tools.tsx` to list real rows from `member_resources` filtered by `kind` and access. Locked items show a lock badge + "Upgrade" CTA.
- Add `/m/resources/$slug` detail page rendering body, embedded video, or signed-URL download.

## 2. Product → Access Mapping UI

Today `product_access_grants` is only editable via SQL. Add an admin UI so each Stripe product/offer can be wired to the access keys it grants.

### Where
- New section on existing `/admin/payment-links` and `/admin/offers` detail pages: **"Membership Access Granted"**.

### What it does
- Lists current `product_access_grants` rows for the offer/product.
- "Add grant" picker: choose `account_type_granted` (App Member / Program-Only / Coaching Client) and one or more `access_level_keys` (app_membership, premium_membership, program_only, custom).
- Optional: link a specific `member_plan_id` for program-only purchases (auto-enroll on purchase).
- Edit/remove existing grants.
- Server fns in `src/lib/product-access.functions.ts`: `listGrants`, `upsertGrant`, `deleteGrant` — admin-gated.

### Webhook compatibility
- No webhook changes — `stripe-webhook.ts` already reads `product_access_grants` and applies. UI just makes the table editable.

## 3. Upgrade / CTA Flow

Members hit locked content → clear path to purchase.

### Components
- `<UpgradeCTA />` shared component: title, subtitle, list of unlocked perks, primary "Upgrade" button → opens `/m/upgrade`.
- `/m/upgrade` route: lists all `offers` flagged `is_member_facing=true` (new boolean on `offers`), grouped by tier. Each card: name, price, features, "Get access" → Stripe Checkout via existing `createCheckoutSession` flow with `success_url=/m?upgrade=success`.
- Dashboard banner on `/m/index.tsx` for `account_type='program_only'` or no active access: "Unlock the full app — upgrade to App Member."
- Locked plan/resource cards swap the disabled state for an `<UpgradeCTA inline />`.
- Post-checkout: `/m?upgrade=success` shows a toast + refetches `m-me` so access updates as soon as the webhook lands.

### Schema
- Add `offers.is_member_facing boolean default false` and `offers.member_tier_label text` (e.g. "App Member", "Premium").
- Admin offers form gets two new fields.

## Technical Notes

- All new server fns under `src/lib/*.functions.ts` use `requireSupabaseAuth` + admin role check for writes; read fns for `/m/*` use `current_member_id()` and respect POV sandbox.
- Storage uploads via `supabase.storage.from('member-resources').upload(...)` from admin client, then store the path; serve to members via signed URLs created in a server fn.
- Migrations: one for `member_resources` + bucket policies, one for `offers.is_member_facing` + `offers.member_tier_label`.
- Routes added:
  - `/_authenticated/admin/member-resources.index.tsx`, `.new.tsx`, `.$resourceId.tsx`
  - `/_authenticated/m/resources.$slug.tsx`
  - `/_authenticated/m/upgrade.tsx`
- Routes edited: `/m/resources.tsx`, `/m/tools.tsx`, `/m/index.tsx`, `/admin/payment-links.tsx`, `/admin/offers.tsx`, member-plan & resource cards.

## Out of scope (defer)
- Email notifications on upgrade
- Coupon/promo codes
- Trial periods
- Per-resource analytics
