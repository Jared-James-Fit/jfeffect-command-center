# SignNow Integration — Replace Internal Signing System

## Goal
Rip out the internal PDF signing system (builder, tap-to-sign, generated PDFs, signer assignment) and replace it with a SignNow-backed agreement tracking system. The app becomes the command center: organize, label, verify, connect to clients/purchases, store signed copies. SignNow handles actual signing.

## Scope: What gets deleted
- `src/components/agreement-pdf-builder.tsx`
- `src/components/agreement-signer.tsx`
- `src/lib/pdf-render.ts`
- Internal signing routes: `src/routes/_authenticated/admin/agreements.$id.tsx` (PDF builder), `src/routes/_authenticated/admin/agreements.instance.$id.tsx`, `src/routes/_authenticated/portal/agreements.$id.tsx`
- DB tables (dropped via migration): `agreement_template_fields`, `agreement_field_values`
- `agreements` table internal columns: `fields_snapshot`, `template_pdf_path`, `signing_token`, `signed_pdf_path`, `signed_pdf_sha256`, `client_signed_at`, `coach_signed_at`, `payor_required`, `minor_required`, `requires_coach_signature`
- `agreement_templates` columns: `pdf_storage_path`, `page_count`, `requires_coach_signature`, `supports_payor`, `supports_minor`
- `agreements` storage bucket usage for internal PDFs (bucket kept for manual uploads of signed copies)
- Field-builder helpers in `src/lib/agreements.ts` (FIELD_TYPES, SIGNER_ROLES, FieldSnapshot)

## What gets built

### 1. Database migration
- ALTER `agreement_templates`: add `signnow_template_id text`, `agreement_type text`, `description text`, `version text`, `notes text`, `is_active boolean default true`; drop internal-signing columns above.
- ALTER `agreements`: add SignNow + verification columns:
  - `signnow_template_id text`, `signnow_document_id text`, `signnow_signing_link text`, `signnow_completed_link text`
  - `signed_copy_url text`, `signed_copy_storage_path text`, `drive_file_id text`, `drive_file_url text`
  - `agreement_type text`, `offer_name text`, `signer_name_in_signnow text`, `correct_client_name text`
  - `signer_mismatch boolean default false`
  - `verification_status text default 'Not Verified'` (Not Verified / Auto-Matched / Manually Verified / Signer Name Mismatch / Needs Review)
  - `verified_by uuid`, `verified_at timestamptz`, `verification_note text`
  - `signed_at timestamptz` (replaces client_signed_at/coach_signed_at)
  - `client_full_name`, `client_email`, `client_phone`, `client_address`, `client_dob date` snapshot at send time
  - widen `status` allowed values to new list (Not Sent, Sent, Opened, Waiting on Client, Signed, Completed, Declined, Expired, Cancelled, Needs Resend, Needs Manual Verification, Verified, Error)
  - drop internal-signing columns above
- CREATE `signnow_settings` (singleton): `status`, `account_email`, `default_template_id`, `auto_reminders_enabled`, `last_test_at`, `last_test_result`, `notes`. Admin-only RLS.
- Drop tables: `agreement_template_fields`, `agreement_field_values`.
- Keep `agreement_audit_log` (still useful) — events become `sent`, `opened`, `signed`, `verified`, `mismatch_flagged`, `manual_upload`, `reminder_sent`.

### 2. SignNow Integration settings
New card in `src/routes/_authenticated/admin/settings.tsx`:
- Status badge (Not Connected / Connected / Needs Setup / Error / Manual Mode)
- Account email, default template selector
- "Save settings" / "Test connection" buttons
- Note: API uses SignNow OAuth token (secret `SIGNNOW_API_TOKEN`). If absent → Manual Mode automatically. The user already has SignNow templates — first release runs in Manual Mode (paste links/upload PDFs); API mode wires in later when token is added.

### 3. Agreement Templates admin
Rewrite `src/routes/_authenticated/admin/agreements.index.tsx`:
- List of templates with: name, SignNow template ID, agreement type, active, notes
- Add/edit dialog (no PDF upload, no field builder) — just metadata + SignNow template ID + agreement type dropdown
- Delete old `agreements.$id.tsx` PDF builder route entirely

### 4. Client Agreements section
New `src/components/agreements-panel.tsx` rewrite on client profile:
- Send Agreement dialog: pick template, snapshot client info (name/email/phone/address), generate signing flow:
  - **API mode** (when token present): server function calls SignNow API to create document from template → returns signing link
  - **Manual mode**: opens SignNow URL in new tab; admin pastes back signing link or completed link later
- Agreement cards show: type, template, status badge, verification badge, signed date, signer-name mismatch warning, offer link, signed-copy actions
- Actions: Send / Resend / Copy Signing Link / Open in SignNow / View Signed Copy / Download / Upload Signed PDF Manually / Mark Manually Verified / Add Verification Note / Mark Signed / Mark Needs Resend

### 5. Manual upload + verification dialog
- Upload PDF to `agreements` storage bucket (manual signed copies allowed)
- Fields: client (locked), agreement type, signed date/time, offer (optional), SignNow doc link (optional), signer name in SignNow, verification note
- On save: compare `signer_name_in_signnow` vs client full name → if differs, set `signer_mismatch=true`, `verification_status='Signer Name Mismatch'`
- "Mark Manually Verified" sets verification_status, verified_by, verified_at, stores note like *"Signed in SignNow kiosk mode. SignNow displayed coach name, but agreement was completed for {client} and is attached to the correct client profile."*

### 6. Purchase ↔ Agreement connection
- `offers` table: add `agreement_required boolean`, `required_agreement_template_id uuid`, `agreement_before_service boolean` (migration)
- Purchase record panel shows agreement status; warns if required + unsigned, signed + unverified, or mismatch

### 7. Client portal
Rewrite `src/routes/_authenticated/portal/agreements.index.tsx`:
- "Agreements" list: needing signature (with "Review & Sign Agreement" → SignNow link), completed (with optional "View Signed Copy")
- Delete `portal/agreements.$id.tsx` (internal signer)

### 8. Admin dashboard widget
- "Agreements Needing Attention" widget on `admin/index.tsx`: missing/unsigned/expired/needs-resend/error/needs-manual-verification/signer-mismatch
- Quick actions + link to client profile

### 9. Notifications
- Hook into existing notification bell: emit on signed, expired, needs-resend, error, needs-manual-verification, mismatch, X-days-unsigned
- Client side: agreement sent / needs signature / completed / reminder

### 10. Reminders
- "Send Reminder" + "Resend" buttons in admin panel
- Auto-reminder toggle (24h/3d/7d) stored on `signnow_settings`; cron worker not built in this pass — manual + setting flag now, automation later

### 11. Coach permissions
- Already gated via `is_assigned_coach()` RLS — extend to new columns, no policy changes needed beyond verifying current ones still cover new schema

### 12. Code cleanup
- Strip `FIELD_TYPES`, `SIGNER_ROLES`, `FieldSnapshot`, builder types from `src/lib/agreements.ts`
- Strip pdf-related server functions in `src/lib/agreements.functions.ts`; add new ones: `sendAgreement`, `markSigned`, `recordSignedCopy`, `verifyAgreement`, `sendReminder`, `testSignNowConnection`
- Drop `pdf-lib`, `pdfjs-dist`, signature-pad deps if installed solely for old system (verify before removing)

## Technical notes
- SignNow API base: `https://api.signnow.com`. Token via `process.env.SIGNNOW_API_TOKEN` (added via `add_secret` only after user confirms API mode). Until then, **Manual Mode** is the default and the entire system works end-to-end without the secret.
- File labeling format: `{client_name} — {agreement_type} — {signed_date} — {signed_time}` (with offer variant when present). Used for storage upload filename + UI display.
- Google Drive saving: integrates with existing `drive.functions.ts` — if client has `client_drive_folders` row, server fn copies signed PDF into an "Agreements" subfolder and stores `drive_file_id`/`drive_file_url`. Falls back to Supabase storage link only.
- Mismatch detection: case-insensitive trim compare of `signer_name_in_signnow` vs `correct_client_name`; never deletes the agreement, only flags.
- All new tables/columns get explicit GRANTs to `authenticated` + `service_role`, RLS mirrors existing patterns (admin all, coach assigned, client read own).

## Out of scope (this build)
- Automated cron reminders (toggle stored, runner not built)
- SignNow webhook auto-status sync (manual + button-driven for now; webhook route can be added once API token is provided)
- Migrating existing internal-signed agreements — old rows kept readable but the builder UI is gone; admin can re-attach signed copies via manual upload