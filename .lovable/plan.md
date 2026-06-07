# Archive Manager, Deactivation, and Google Drive Media Archiving

This is a very large build. To ship it safely without breaking existing data, I'll split it into 3 phases and ask you to confirm the order. Each phase is independently testable.

## Phase 1 — Archive Manager + Bulk + Safety (admin core)

**New admin page:** `/admin/archives` ("Archive Manager") in the sidebar under Admin.

**Unified archive view** pulling `archived = true` (or status = 'Archived') rows from existing tables:
- clients, programs, program_templates, training_blocks, products/offers, agreements, forms, check_ins, lift_videos, media_items, exercises, documents

**Per-row data:** name/title, type, attached client, archived_at, archived_by, status, actions (View / Restore / Delete permanently).

**Filters:** type tabs (All / Clients / Programs / Templates / Products / Agreements / Forms / Check-ins / Lift Videos / Exercises / Documents), date archived, archived by, search.

**Bulk:** select one / select all visible / clear / Restore selected / Delete selected.

**Safety:**
- Single delete → confirm dialog.
- Bulk delete → must type `DELETE` to enable button; shows count.
- Restore returns row to its source list; show reason if blocked (e.g. linked client deleted).

**DB migration:** add `archived_at` + `archived_by` columns where missing; standardize on existing `archived` boolean / status field per table (no rename of existing columns).

**Server fns** (`src/lib/archives.functions.ts`, admin-only via `has_role('admin')`): `listArchived`, `restoreItems`, `permanentlyDeleteItems`.

**Permissions:** Only admins can permanent-delete. Coaches can archive/restore their assigned clients only.

## Phase 2 — Client Deactivation / Reactivation

**Status model (no duplicates):** `Active`, `Deactivated`, `Archived`. Keep the existing `clients.status` column; map old values during migration.

**Client profile additions:**
- "Deactivate Client" button → dialog with optional reason (preset list + internal note) + "Disable portal access?" toggle (default: disable).
- Deactivated banner on profile, with Reactivate / Archive / Delete Permanently buttons.
- All history (notes, agreements, purchases, programs, check-ins, lift videos, messages, docs) stays visible.

**Clients page additions:**
- Status filter: Active (default) / Deactivated / Archived / All.
- Bulk: Deactivate / Archive / Reactivate (when filtered) / Delete (typed `DELETE CLIENTS`).

**Dashboard:** Active count excludes Deactivated + Archived; optional Deactivated/Archived counts.

**DB migration:** add `deactivated_at`, `deactivated_by`, `deactivation_reason`, `deactivation_note`, `portal_access_disabled` to `clients`. Activity log entry on every state change.

**Reactivate flow:** confirmation → restore status to Active → ask "Restore portal access?" if previously disabled.

## Phase 3 — Google Drive Media Archiving

**Folder structure per client:** `Client Name / Chat Media / YYYY / MMMM`, plus `Lift Videos`, `Check-In Media`, `Progress Photos`, `Documents`, `Agreements`, `Other`. Folder IDs cached on the client row.

**Important caveat about the connector:** The current Google Drive connector authenticates **your** Google account (the workspace owner). All archived client media goes into folders inside your Drive — not into each client's personal Drive. Per the connector knowledge file, per-client Drive access would require per-user OAuth, which is a separate, larger build. Confirm this is what you want before Phase 3.

**New table `media_archives`:** media_id, message_id, client_id, sender_id, original_file_name, file_type, file_size, original_sent_at, archived_at, archive_status (`not_archived | queued | archiving | archived | failed | restore_requested | restored`), google_drive_file_id, google_drive_url, google_drive_folder_id, thumbnail_url, visibility, archived_by, archive_error.

**Settings page** (`/admin/settings/media-archive`): auto-archive on/off, window (30d/90d/6m/1y/never, default 6m), keep thumbnails (default yes), client visibility (follow original), include photos/videos/voice notes.

**Manual controls** in chat / media areas: Archive to Drive (single + bulk), Open in Drive, Retry, Restore preview.

**Chat rendering after archive:** message remains; media replaced by thumbnail + "Archived to Drive" badge + "Open in Drive" link + original metadata.

**Background job:** TanStack server route at `/api/public/hooks/media-archive` invoked by pg_cron daily. Scans `messages` / `media_items` / `lift_videos` older than the window, uploads via Google Drive connector gateway, writes `media_archives`, then deletes storage object only after Drive upload is confirmed.

**Media Archive Manager page**: queue, archived, failed; per-client filters; bulk archive / retry; Drive folder shortcuts.

**Client profile Drive section:** quick links to client's Drive folders + archived count + recent files.

**Safety order (never lose data):** upload → verify Drive file → write metadata row → mark `archived` → only then delete the heavy Storage object. Failed uploads keep originals.

---

## Questions before I start coding

1. **Order:** Ship Phase 1 first (Archive Manager + safety) and then Phase 2 (Deactivation), then Phase 3 (Drive)? Or a different order?
2. **Drive ownership:** OK that Phase 3 archives into **your** Google Drive (workspace-owned folders per client), not into each client's personal Drive? Per-user Drive would require a separate OAuth build.
3. **Coach permissions on archive/delete:** Coaches archive/restore assigned clients only, and **never** permanent-delete — confirm?

Once you confirm, I'll start with Phase 1 (migration → server fns → Archive Manager UI → bulk + safety), then move on.