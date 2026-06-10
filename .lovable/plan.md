## Goal

Ship two premium public sales pages — `/join` (JF Membership, upgrade existing) and `/coaching` (new Private Coaching) — both backed by an admin CMS so you can edit copy, swap images, manage testimonials, and configure the coaching CTA without touching code.

---

## Architecture

One small CMS, two pages. Both pages render from the same content store so the admin UX is consistent and we don't duplicate code.

### New DB: `sales_pages` (1 row per page key)

```text
sales_pages
├── page_key            text PK   -- 'join' | 'coaching'
├── published           bool
├── hero_headline       text
├── hero_subheadline    text
├── primary_cta_label   text
├── primary_cta_kind    text      -- 'checkout' | 'application' | 'booking' | 'external' | 'lead_form'
├── primary_cta_url     text      -- used when kind = external/booking
├── secondary_cta_label text
├── secondary_cta_href  text
├── sections            jsonb     -- ordered blocks (included, not-included, comparison, how-it-works, faq, options)
├── visuals             jsonb     -- ordered [{url, alt, slot, visible}] for hero + app previews + proof
├── testimonials        jsonb     -- [{name, quote, image_url, visible, order}]
├── updated_at, updated_by
```

Seeded with the exact copy from the spec for both `join` and `coaching`. RLS: public SELECT when `published = true`; admin all.

### New storage bucket: `sales-page-media` (public)

Used for hero images, app-preview screenshots, testimonial photos, transformation/proof cards. Admin uploads, the public page just reads the public URL.

### New DB: `coaching_applications` (lead capture)

```text
coaching_applications
├── id, created_at
├── full_name, email, phone
├── goals, training_history, schedule, budget_range, timeline
├── source         text      -- 'coaching_page'
├── status         text      -- 'New' | 'Contacted' | 'Approved' | 'Rejected'
├── notes_admin    text
```

RLS: anon INSERT only (the form); admin SELECT/UPDATE/DELETE.

---

## Routes

| Path             | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `/join`          | Existing JF Membership page — upgrade visuals + pull from CMS      |
| `/coaching`      | New Private Coaching sales page — pulls from CMS                   |
| `/apply`         | Redirect → `/coaching`                                             |
| `/membership`    | Redirect → `/join`                                                 |
| `/signup/jf`     | Already redirects → `/join` ✓                                      |
| `/coaching/apply`| Coaching lead form (used when CTA kind = `lead_form` / default)    |

All public routes work without login. Membership checkout still calls `createJfSignupCheckout` unchanged. Coaching CTA resolves at click time from `primary_cta_kind`:
- `application` / `lead_form` → navigate to `/coaching/apply`
- `booking` / `external` → open `primary_cta_url` in new tab
- `checkout` → start Stripe checkout via existing payment-links flow (only if admin pastes a price id)

---

## Page sections (built as small components, fed from `sections` jsonb)

Shared component library under `src/components/sales/`:
- `SalesHero` (headline, sub, dual CTA, hero image)
- `AppPreviewGrid` (mockup cards from `visuals` slot=`app_preview`)
- `FeatureGrid` (icon + title + body)
- `IncludedNotIncluded` (two columns ✓ / ✗)
- `ComparisonCard` (Membership vs Coaching)
- `OptionCard` (coaching plan tiles)
- `HowItWorks` (numbered steps)
- `ProofWall` (testimonials + transformation images)
- `FAQAccordion` (uses existing `Accordion` from shadcn)
- `FinalCta`
- `StickyMobileCta` (visible <md only, hides on scroll-up after CTA tap)
- `ShareToolbar` (copy / SMS / email / chat / IG-bio / promo message; uses `jfeffect.com` URLs only — never the preview origin)

### `/join` upgrade keeps existing checkout — adds: hero image slot, AppPreviewGrid, FeatureGrid, IncludedNotIncluded, ComparisonCard, ProofWall, sticky mobile CTA.

### `/coaching` brand new: full structure from spec, including "What coaching is not", coaching options, results wall, 5-step how-it-works, FAQ, final CTA.

---

## Admin

New "Sales Pages" group in Coaching Admin nav (Business section):

- `/admin/sales/membership` — edit `join` page
- `/admin/sales/coaching` — edit `coaching` page (incl. CTA destination)
- `/admin/sales/coaching-applications` — inbox for submitted lead forms

Existing `/admin/membership/sales-page` (Membership Admin Dashboard) gets pointed at the same editor so there's one source of truth.

Editor surface per page:
- Hero copy + image upload
- Primary/secondary CTA (label + destination type + URL)
- Section toggles + per-section content edit
- Visuals manager (upload / replace / remove / alt / visible / drag-reorder)
- Testimonials manager (CRUD)
- FAQ editor
- Buttons: **Preview Page**, **Copy Public Link** (copies `https://jfeffect.com/<slug>`), **Open Live Page**, **Save**, **Publish/Unpublish**

Editor is admin-only (server fn checks `has_role(admin)`). Public page only reads `sales_pages` row with `published=true` via a public server fn — no PII, no admin fields exposed.

---

## Share tools

`ShareToolbar` (admin-only, on both editor pages) emits:
- Copy link → `https://jfeffect.com/join` or `/coaching`
- SMS / Email / In-chat share with default promo message from spec
- "Copy IG-bio link" (same URL, toast confirms)
- "Copy promo message" (full body from spec)

---

## Server functions (`src/lib/sales-pages.functions.ts`)

- `getPublicSalesPage({ page_key })` — public, returns only `published` rows
- `getSalesPageAdmin({ page_key })` — admin-only
- `updateSalesPage({ page_key, patch })` — admin-only
- `uploadSalesMedia` — handled via direct supabase client upload to `sales-page-media`
- `submitCoachingApplication({ ... })` — public POST, rate-limit by inserting through anon RLS policy
- `listCoachingApplications` / `updateCoachingApplication` — admin-only

---

## File map (new + edited)

**New (~18 files):**
- `supabase/migrations/<ts>_sales_pages.sql` (table + RLS + grants + seed + storage bucket via tool)
- `src/lib/sales-pages.functions.ts`
- `src/lib/coaching-applications.functions.ts`
- `src/components/sales/*` (10 small components above)
- `src/routes/coaching.tsx`
- `src/routes/coaching.apply.tsx`
- `src/routes/membership.tsx` (redirect → /join)
- `src/routes/apply.tsx` (redirect → /coaching)
- `src/routes/_authenticated/admin/sales.membership.tsx`
- `src/routes/_authenticated/admin/sales.coaching.tsx`
- `src/routes/_authenticated/admin/sales.coaching-applications.tsx`

**Edited (~5):**
- `src/routes/join.tsx` — slot in new section components, pull CMS row, add sticky mobile CTA
- `src/lib/admin-nav.ts` — add Sales Pages entries under Business
- `src/routes/_authenticated/admin/membership.sales-page.tsx` — point at new editor (or render it inline)
- `src/components/admin/jf-membership-settings-card.tsx` — small copy tweak
- `.lovable/plan.md` — log

---

## Out of scope for this batch (will note in code as TODO if relevant)

- Native multi-step coaching application wizard with file uploads → MVP is single-page form; can grow later.
- Automated email reply to applicants → not in this pass; admins see inbox.
- A/B testing variants of the pages.
- Custom analytics/conversion tracking beyond what you already have.

---

## Verification

After build I'll exec:
1. View both public pages at desktop + mobile widths, confirm sections render.
2. Submit a fake coaching application, confirm row lands and admin inbox shows it.
3. Confirm `/membership`, `/apply`, `/signup/jf` all 302 → correct destination.
4. Confirm Copy Public Link writes `https://jfeffect.com/...` (never preview URL).
5. Confirm admin editor is gated; sign-out + reload `/coaching` still loads.

Ready to build on approval.