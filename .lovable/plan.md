## Existing architecture (audited)

- **Single program table**: `public.pl_templates` (admin-managed today, no per-user ownership beyond `created_by`). Versioning already exists via `payload_revision` + `pl_template_operations` (append-only undo/redo log).
- **Membership distribution**: `public.member_plans` (denormalized `published_payload`, `status` Draft/Published/Archived, `featured`, `required_access_level`) + `member_plan_enrollments` + `featured_member_items`. Already wired into the member workout logger.
- **Coach/client programs**: `pl_preps` → `pl_blocks` → `pl_weeks` → `pl_days` → `pl_exercise_rows` → `pl_row_results`. Untouched — this is per-client assigned programming and stays as-is.
- **Routes**: `admin/program-library.tsx` (list), `admin/program-library_.$templateId.tsx` (editor), `admin/programs.tsx`, `admin/programming.tsx`. No coach or member library routes exist yet.
- **RLS today**: admin full; coach read-all (non-archived); members read published `member_plans` only. No coach ownership, no sharing, no submissions, no public exposure.

## Scope confirmation — this spec is 4 large phases

Per your stated "IMPLEMENTATION ORDER", I plan to ship **Phase 1 only** in this batch (ownership + sharing + submissions + status badges). Phases 2–4 (Membership publishing pipeline upgrades, Public pages, Distribution Status Center) are tracked but deferred to subsequent batches so each lands reviewable and the migration risk stays bounded.

If you want a single mega-batch instead, say so and I'll re-scope — but it will be a multi-thousand-line change touching ~30 files and 4 migrations, with much higher regression risk on the existing builder/logger.

## Phase 1 — ownership, sharing, submissions (this batch)

### Database (one migration)

1. **Extend `pl_templates`** (additive, backfill-safe):
   - `owner_user_id uuid` (nullable; backfill = `created_by`; admin-created = admin user)
   - `owner_role text` ('admin' | 'coach', backfill from `user_roles`)
   - `visibility text` default `'private'` ('private' | 'team')
   - `current_draft_revision bigint` mirrors `payload_revision` (already there — alias only)
2. **New `pl_template_shares`** — one row per (template, destination, target):
   - `template_id`, `destination` ('team' | 'coach' | 'membership_submission' | 'public_submission' | 'team_submission'), `target_coach_id` (nullable), `permission` ('read' | 'duplicate'), `status` ('shared' | 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'removed'), `shared_version`, `created_by`, `reviewed_by`, `reviewed_at`, `notes`, `idempotency_key`. Unique active (template, destination, target_coach_id).
3. **New `pl_template_distribution_events`** — append-only audit (template_id, destination, version, action, prev_status, new_status, actor, notes, created_at).
4. **RLS rewrite for `pl_templates`**:
   - admin: all
   - coach: read own (`owner_user_id = auth.uid()`) OR shared-to-me (via `pl_template_shares`) OR `visibility='team'` (active coaches only)
   - coach: insert/update/delete only when `owner_user_id = auth.uid()` AND not `team`-locked
5. **RLS for `pl_template_shares`**: admin all; coach read own submissions + shares targeting them; coach insert submissions for own templates only.
6. **Triggers**: distribution events on share/status change; prevent duplicate active submissions per (template, destination, version).

### Code

- `src/lib/programs/sharing.ts` — typed share/submit/approve/reject server functions (createServerFn + requireSupabaseAuth).
- `src/components/programs/program-card.tsx` — reusable card with destination + status badges (Private, Team Live, Shared with N Coaches, Pending Approval, Changes Requested, Rejected). Drop-in for existing list pages.
- `src/components/programs/share-program-sheet.tsx` — right-side sheet with destination rows (Team, Coaches w/ search + multiselect, Membership submission, Public submission). Each row: status badge, primary action, expandable settings.
- `src/components/programs/availability-distribution.tsx` — "Availability & Distribution" section embedded in the program editor.
- **Admin routes** (extend existing):
  - `admin/program-library.tsx` — add tabs: My Library / Team Library / Coach Submissions. Reuse current list as "Team Library".
  - `admin/program-submissions.tsx` (new) — submissions inbox with approve/reject/request-changes + notes.
- **Coach routes** (new tree under `_authenticated/coach/`):
  - `coach/programs.tsx` — tabs: My Library / Shared With Me / Team Library / My Submissions.
  - `coach/programs.$templateId.tsx` — editor (reuses existing builder, gated to owner).
  - "Duplicate to My Library" action (server fn deep-copies payload, new template owned by caller).

### Phase 1 explicitly does NOT include

- Membership publishing UI changes (current `member_plans` flow untouched)
- Public program pages / SEO / slugs
- Distribution Status Center (Phase 4)
- Live verification function (Phase 4)
- Version migration of active enrollments (Phase 2)
- Scheduled publication (Phase 2/3)

## Phase 2–4 — deferred (will plan separately when Phase 1 ships)

- **Phase 2**: Membership publishing wired to `pl_template_shares` (destination='membership'), version pinning on enrollments, "Update Available" detection, Preview as Member, active enrollment counts on cards.
- **Phase 3**: Public pages — new `pl_public_pages` table + `/p/$slug` route, access modes, anon-safe RLS, SEO metadata.
- **Phase 4**: `admin/distribution-status.tsx` with summary cards, live verification fn, publication history timeline component, Copy Link / View Live everywhere.

## Risk + safety

- All existing admin flows keep working: `pl_templates` columns are additive, existing policies preserved for admin, coach read-policy widened (still gated to active coaches).
- No changes to `pl_preps`, `pl_blocks`, `pl_row_results`, `member_plans`, `member_plan_enrollments`, exercise library, logger, or assignment RPCs.
- Migration backfills `owner_user_id = created_by` and `owner_role = 'admin'` so every existing template stays in admin's My Library by default.

## Confirm before I start

1. **Ship Phase 1 only now**, then iterate? (recommended) — or do you want one mega-batch?
2. **Coach route tree** — OK to introduce `src/routes/_authenticated/coach/*`? (No coach routes exist today; admins currently use admin routes.)
3. **Existing template ownership** — backfill all current `pl_templates` as **admin-owned, visibility='team'** (i.e. they show up in Team Library immediately, not Private)? That matches current behavior where all coaches already see them.
