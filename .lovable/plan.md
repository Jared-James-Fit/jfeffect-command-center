## Membership Workout Library — Build Plan

A full publish → browse → import flow for admin workout templates, replacing the "Phase 2" stub in Share & Publish.

---

### 1. Database (single migration)

New tables (all with GRANTs + RLS):

- `membership_library_listings` — one row per published template.
  Fields: `template_id`, `published_version`, `status` (draft|published|unpublished), `title`, `description`, `cover_image_url`, `category_tags[]`, `difficulty`, `goal`, `days_per_week`, `duration_weeks`, `equipment[]`, `allow_full_program`, `allow_blocks`, `allow_weeks`, `allow_days`, `allow_pdf_download`, `audience_mode` (all_active | by_access_level | by_plan), `required_access_levels[]`, `eligible_plan_ids[]`, `published_at`, `published_by`, `unpublished_at`, `unpublished_by`.
- `membership_library_versions` — historical snapshot of (`listing_id`, `version`, `payload_snapshot_jsonb`, `published_at`, `published_by`, `change_notes`). Pins imports to a specific version.
- `membership_library_imports` — `listing_id`, `version`, `member_user_id`, `imported_program_id` (FK new copy in `pl_templates`), `import_mode` (full | partial), `selection_json`, `start_date`, `imported_at`.
- `membership_library_events` — analytics: `listing_id`, `member_user_id`, `event_type` (preview | import | pdf_download | unpublish | publish | update_publish), `metadata`, `created_at`.
- `membership_library_saved` — member "save for later" pins.

RLS:
- Admin: full manage. Coaches: read only (no manage).
- Members: SELECT on listings where `status='published'` AND member has active/trialing membership AND (audience_mode='all_active' OR access overlap via `member_access` OR `member_plan_enrollments.plan_id` overlap). Enforced via SECURITY DEFINER `can_member_access_listing(uuid, uuid)`.
- Members: full CRUD on their own `membership_library_imports` and `membership_library_saved` rows.
- Inserts to `membership_library_events` allowed for the acting member (preview/download/import) and admin (publish/unpublish).

Helper RPC `clone_template_for_member(listing_id, version, selection)` (SECURITY DEFINER) duplicates `pl_templates` + `pl_blocks/weeks/days/exercise_blocks/exercise_rows` rows into a new template owned by the member, tagged with `source_listing_id` + `source_version`. Add nullable columns `source_listing_id uuid`, `source_version int`, `owner_member_user_id uuid` to `pl_templates`.

### 2. Server functions (`src/lib/membership-library.functions.ts`)

Admin (requires `has_role(admin)`):
`upsertListing`, `publishListing` (snapshots current template payload into `membership_library_versions`), `unpublishListing`, `publishUpdate`, `listAdminListings`, `getListingAnalytics`, `duplicateListing`, `notifyEligibleMembers`.

Member (uses `requireSupabaseAuth`):
`listMemberLibrary` (filters via RPC), `getListingForMember` (preview payload, strips admin-only notes), `recordPreviewEvent`, `importListing` ({listingId, version, mode, selection, startDate, trainingDays, replaceActive}), `recordPdfDownload`, `saveListing`, `unsaveListing`, `listMyImports`, `checkForUpdates`.

PDF generator runs inside `downloadListingPdf` server fn (pdf-lib via `await import`), returns base64 → client downloads. Strips admin notes / IDs.

### 3. Share & Publish modal rewrite

Replace `MembershipLibrary` card in `src/components/programs/share-program-sheet.tsx`:
- Live status badge (Draft / Published / Unpublished / Update Available)
- "Manage Publication" → opens new `MembershipPublishDrawer` (right sheet) with: title, description, cover image upload (Supabase storage `library-covers`), category tags, difficulty, goal, days/week, duration, equipment, granular add-permissions toggles, PDF download toggle, audience selector (all active / access levels / specific plans), notify-on-publish toggle (email/in-app/SMS), version notes.
- Action buttons: Publish / Publish Update / Unpublish / Preview as Member (opens new tab to `/m/workout-library/$listingId?preview=admin`).
- Shows live `imports_count`, `previews_count`, `pdf_downloads_count`, published version, eligible audience summary.

Remove all "Phase 2" wording.

### 4. Admin page `/admin/membership-library`

Tabs: Published · Drafts · Unpublished · Categories · Member Access · Analytics.
Toolbar: search, filters (category, goal, level, duration, equipment, plan).
Row actions: Publish / Unpublish / Edit listing / Change access / Preview as member / Duplicate / Open source in builder / View imports list.
Primary CTA "Publish Workout Program" → modal listing existing `pl_templates` to wrap as listings.

Add nav entry in `src/lib/admin-nav.ts`.

### 5. Member library `/m/workout-library`

Listing grid (paginated 12/page): cover, title, short desc, difficulty, goal, days/week, length, equipment, "Included With Your Membership" badge, Preview + Add buttons. Locked cards show lock icon + required tier.
Filters: search, goal, difficulty, days/week, duration, equipment, training location, quick-tag chips (Powerlifting, Bodybuilding, General strength, Fat loss, At-home).

### 6. Preview page `/m/workout-library/$listingId`

Server-fn-fetched preview payload (no admin-only fields). Sections: overview, who-for, block/week/day outline, exercise preview, coach notes (public only), what's included. Actions: Add Full Program · Choose Specific Content · Download PDF (if enabled) · Save for Later.

### 7. Add-to-account flow

Drawer: Start date · preferred training days · add to calendar toggle · destination (Save to My Programs [default] / Replace active program [confirmation required]).
Calls `importListing` → returns new `imported_program_id` → routes to `/m/my-plans/$enrollmentId` (or My Programs landing).

Advanced selection: tree of blocks → weeks → days with Select All / partial checkboxes, summary of what will be added, destination picker (My Programs / existing personal program / future calendar date). Blocks injection into coach-managed programs gated by `pl_templates.member_editable=true`.

### 8. PDF download

`downloadListingPdf` builds branded PDF, records `pdf_download` event, returns blob. Disabled when `allow_pdf_download=false` — server fn rejects + button hidden.

### 9. Nav additions

- Member sidebar: "Workout Library" between Plans and Tools.
- Admin sidebar: "Membership Library" under Programming.

### 10. Notifications (admin-confirmed)

`notifyEligibleMembers(listingId, channels[])` — uses existing broadcast / SMS / email infra. Only sent when admin clicks "Notify eligible members" in publish drawer.

### 11. Update flow

`checkForUpdates` compares import's `source_version` vs current `published_version`. Shows "Update Available" on member's My Programs row → Preview Changes (diff summary) / Import Updated Copy (creates new clone, preserves old + completed logs) / Keep Current.

### 12. Unpublish

Confirmation modal explains: card hidden from new browsing, imports blocked, existing copies + logs preserved, audit recorded. Records `unpublished_by`/`unpublished_at` + event row.

---

### Technical details

- New files:
  `supabase/migrations/<ts>_membership_library.sql`
  `src/lib/membership-library.functions.ts`
  `src/lib/membership-library-pdf.server.ts`
  `src/components/programs/membership-publish-drawer.tsx`
  `src/routes/_authenticated/admin/membership-library.tsx`
  `src/routes/_authenticated/admin/membership-library.$listingId.tsx`
  `src/routes/_authenticated/m/workout-library.tsx`
  `src/routes/_authenticated/m/workout-library.$listingId.tsx`
- Edited:
  `src/components/programs/share-program-sheet.tsx` (replace Membership Library card)
  `src/lib/admin-nav.ts`, member nav component
  `src/components/app-shell` (route registration if needed)
  `pl_templates` — add `source_listing_id`, `source_version`, `owner_member_user_id`, `member_editable` columns
- RLS verified per-table; no existing Team Library / Coach Sharing policies modified.
- All server fns enforce role + access checks; URL/API tampering blocked by RLS.
- Acceptance tests (1–20) manually verified with one admin, one eligible member, one ineligible member after build.

This is ~3–4 hours of build work and will land as one cohesive change. Approve to proceed.