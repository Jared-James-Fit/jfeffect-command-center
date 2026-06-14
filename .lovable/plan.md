
# Native Agreements & Consent System — Build Plan

This is a multi-week build. I will execute it in **5 sequential phases**, exactly as the spec requires ("complete and verify each phase before building the next"). Each phase ends with a verification checkpoint before I move on. I will not ship polished UI on top of an incomplete backend.

Before I touch any code, I need to confirm scope, because what you've described is a 6–10 hour autonomous build minimum, and a few decisions will materially change the data model. I'd rather get them right once.

---

## Phase 0 — Audit (no code changes)

I'll inspect and document, in writing, what already exists for:

- `agreements`, `agreement_templates`, `agreement_audit_log`, `signnow_settings` (legacy)
- `legal_documents`, `legal_document_versions`, `legal_document_placements`, `legal_acceptances`, `legal_acceptance_requirements`, `legal_consent_preferences`, `legal_enforcement_audit`
- `clients` (DOB, guardians, emergency contacts, residence/jurisdiction fields)
- `coaches`, `coach_invites`, coach↔client assignment surface
- `offers`, `purchase_records`, `payment_ledger`, `payment_allocations`, `pt_sessions`, `coaching_products`
- `app_members`, `jf_billing_events`, `jf_membership_settings` (left untouched)
- `client_drive_folders`, existing Drive integration, private storage buckets, PDF generator (if any)
- `user_roles`, `has_role`, existing RLS patterns
- Notification surfaces: `appointment_reminders`, `email_send_log`, `sms_log`, dry-run/allowlist controls

Deliverable: an `AUDIT.md` listing what is reused as-is, what is extended, and what is new. Nothing in this phase is destructive.

---

## Phase 1 — Foundation (DB + state machine + audit + legacy preservation)

Schema (all new tables, no edits to existing legal/membership tables):

- `jurisdiction_profiles` (+ Manitoba seed, status = `legal_review_required`)
- `legal_modules`, `legal_module_versions` (status: draft / legal_review_required / approved / published / retired; `content_hash`; structured `blocks` jsonb; `variables`; `conditions`; `required_acknowledgements`; `required_signers`)
- `agreement_templates`, `agreement_template_versions` (a template = an ordered set of module refs + package rules)
- `agreement_packages` (the per-client instance), `agreement_package_modules` (resolved module versions at send time)
- `agreement_snapshots` (immutable; hashed; the exact rendered content the signer saw)
- `agreement_signers` (role: client / guardian / minor_assent / payor / coach_countersigner; per-signer status; per-signer audit)
- `agreement_acknowledgements` (per ack, exact wording + version, bound to signer + snapshot)
- `agreement_signatures` (typed/drawn; bound to snapshot hash, signer, server ts, ip, ua, auth session; never image-only)
- `agreement_events` (append-only; insert-only RLS; delete trigger blocks all deletes; full event taxonomy from spec §14)
- `agreement_documents` (final PDF + audit PDF + optional health PDF; hash, renderer version, storage path, drive sync state)
- `agreement_reminders`
- `health_screenings`, `health_screening_answers`, `medical_clearance_documents` (separate restricted RLS)
- `media_consents` (granular: testimonial / before-after / video / name / first-name / anonymous / social / website / paid-ads; prospective withdrawal preserves prior consent record)
- `proposal_records` (sales proposal object; accepting creates draft Service Order)
- `legacy_agreement_records` (SignNow + old-format archive; read-only, kept accessible)

Critical immutability:

- Trigger on `agreement_snapshots`: no UPDATE/DELETE once `status='sealed'`
- Trigger on `agreement_signatures`, `agreement_acknowledgements`: no UPDATE/DELETE
- Trigger on `agreement_events`: no UPDATE/DELETE, ever (admin included)
- Trigger on `agreement_documents`: no overwrite of `final_pdf_hash`; repairs create new row + event

RLS: admin / coach (only assigned clients) / client (own) / guardian (own minor's restricted view) / payor (financial-only view). Health tables use a stricter policy set than agreement tables. Service-role only for PDF gen, Drive sync, guest-token verification.

State machine: implemented as a Postgres function `agreement_transition(package_id, event)` that enforces legal transitions and writes the audit event atomically.

Legacy SignNow preserved as-is; `legacy_agreement_records` mirrors enough metadata to surface them under the new "Legacy" tab without touching `signnow_settings`/`agreements`.

**Verification checkpoint** before Phase 2: migrations run cleanly; RLS tests pass for the 5 roles; immutability triggers reject tampering; state machine transitions are exhaustive.

---

## Phase 2 — Creation workflow (admin)

- 7-step wizard (`/admin/clients/$id/agreements/new`): client+jurisdiction → service → financial → parties → modules → preview → send
- Auto-derives signer roles from DOB + jurisdiction + payor + service type
- Module auto-selection from approved templates; manual removal blocked when legally required
- Unsupported jurisdiction → forced `Draft` + `Unsupported Jurisdiction` banner; send button disabled
- Manitoba publication blockers enforced server-side (cannot send if business address, statutory disclosure, installment option flag, cancellation wording are missing)
- Mobile + PDF preview rendered from the same snapshot the signer will see
- Draft / Send now / Schedule / Copy secure link; respects existing dry-run + allowlist

**Verification checkpoint**: a Service Order for the Nicolas Galli adult PT test case can be created end-to-end into `sent` status without touching legal paragraphs.

---

## Phase 3 — Signing experience (client + guest)

- Mobile-first 4-screen flow at `/m/agreements/$packageId` (client) and `/sign/$token` (guest)
- Screen 1 = service/price summary (no legal reading required to see the commitment)
- Screen 2 = structured web render of the snapshot (no PDF viewer, no horizontal scroll, sticky progress, autosave, resume)
- Screen 3 = targeted acknowledgements only (no per-page initials); media consent separate and optional
- Screen 4 = typed signature (default), optional drawn; bound to snapshot hash + signer + intent wording + server ts + ip + ua + auth session
- Guest flow: high-entropy token, single-agreement+single-signer scope, expiration, revocation, rate limit, email OTP, no PII in URL
- Guardian/payor see only the content scoped to their signer role
- Countersignature configurable per template; default off for standard adult agreements
- Duplicate signing prevented at DB layer (unique on `(snapshot_id, signer_id)`)

**Verification checkpoint**: minor-with-payor and complimentary-session test cases sign end-to-end; guardian cannot see health detail; payor sees financial-only view.

---

## Phase 4 — Documents (PDF + Drive)

- Server-side PDF renderer (server function, **not** browser print). I'll use a Worker-compatible HTML→PDF path (likely a remote rendering call — Cloudflare workerd cannot run puppeteer/chromium; see the server-runtime constraints). If you want fully self-hosted PDF, that's a separate decision — flag in Q3 below.
- Final Agreement PDF + Audit Certificate PDF + (when applicable) separate confidential Health Screening PDF
- Stores: snapshot hash, final pdf hash, renderer version, storage path
- Private app storage (Supabase Storage, private bucket, signed URLs) = primary
- Google Drive = archival backup using the existing `client_drive_folders` integration: `JF Effect Clients / {Client} / Agreements / {Year} / {Name} - Signed - {Date}.pdf` (+ `- Audit -`)
- Idempotent upload, retry queue with exponential backoff, scheduled reconciliation, manual retry, admin notification on persistent failure
- Health PDFs go to a restricted `Health Screening` folder, never the general Agreements folder
- Drive failure never blocks completion

**Verification checkpoint**: PDF byte-matches snapshot; repair creates new version + event; Drive retry succeeds after induced failure.

---

## Phase 5 — Specialized flows

- Health screening flow (separate restricted form; PAR-Q+ integration gated behind admin-recorded permission; manual clearance review; no AI clearance)
- Granular media consent + prospective withdrawal
- Single-Session Participation Package (complimentary)
- Package Change Addendum (links original; computes sessions used / remaining / value credit; never rewrites original)
- Proposal → Service Order conversion
- Three full test cases from spec §23 executed end-to-end against non-production records

**Final report** per spec §25.

---

## Technical notes

- All money in integer minor units, matching the billing system already in place (Phase 1 of the billing build).
- All snapshot hashes are SHA-256 of canonicalized JSON of the resolved package (modules + variables + signer roles + jurisdiction profile version + statutory disclosures).
- Audit events are insert-only at the trigger level, not just RLS.
- Membership system (`app_members`, `jf_billing_events`, `legal_acceptances` for membership) is not touched.
- Legacy SignNow `agreements` table is not migrated into the new tables — surfaced read-only under "Legacy".
- Templates seeded as `legal_review_required`. Nothing auto-publishes.

---

## Questions before I start writing migrations

I need answers to these three to avoid expensive rework. After your answers I will start with the audit and then Phase 1 migrations in the same turn.

**Q1 — Legacy SignNow data:** Should I (a) leave the existing `agreements` + `signnow_settings` tables completely untouched and surface them via a read-only "Legacy" tab that queries them directly, or (b) also mirror their metadata into the new `legacy_agreement_records` table for unified search/filtering in the new dashboard? (a) is less work and less risk; (b) gives a cleaner UX.

**Q2 — Jurisdiction enforcement strictness:** When a client's residence is outside Manitoba (the only approved jurisdiction at launch), should the system (a) hard-block sending with "Unsupported Jurisdiction" and require an admin to explicitly tag a different approved profile, or (b) allow an admin override with a recorded justification + audit event? Spec §8 says "Do not let the admin bypass this with a normal send action" — I read that as (a), but want to confirm there is no break-glass.

**Q3 — PDF rendering:** The Cloudflare Worker runtime cannot run Chromium/puppeteer/sharp. Three viable options:
  - (a) **Browserless.io / PDFShift / similar HTTP PDF service** — needs an API key, ~$0.01/PDF, fastest to ship, production-grade.
  - (b) **`@react-pdf/renderer`** — pure JS, runs in the Worker, but I'd need to re-implement the structured-block renderer as React-PDF primitives (more code, less visual fidelity with the web view).
  - (c) **A small dedicated render service** you host yourself.
  
  Which do you want? I recommend (a) for speed-to-production and visual parity, with (b) as a fallback if you don't want a third-party PDF vendor.

Once you answer those three, I'll execute audit → Phase 1 migration in the next turn.
