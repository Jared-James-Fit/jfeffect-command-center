# Fix Form Due Status, Completion Sync & Actionable Notifications

## Current architecture (confirmed)

- `nf_forms` — form definition (`kind`: native vs fillout, `external_url`, `recurrence`)
- `nf_assignments` — recurring assignment (form_id + client_id + recurrence + next_due_at)
- `form_client_assignments` — one-off assignment (form_id + client_id)
- `nf_submissions` — native submission per period (status, period_start, started/submitted/reviewed_at) ← already the right shape
- `fillout_submissions` — Fillout payload, **not linked to any assignment, never writes to nf_submissions**

**Root causes**
1. Fillout submissions live in their own table → no status screen using `nf_submissions` ever sees them as "Submitted".
2. Webhook only matches `client_id`; no `assignment_id` / `form_id` / `period_start` correlation.
3. Each screen (Action Centre, Progress Hub, check-ins, bell) computes status independently.
4. Notifications don't carry `assignment_id`, so taps don't deep-link to the exact form.

## Plan

### 1. Shared status resolver (new, ~150 LOC, no schema change)

Create `src/lib/form-status.ts` with:
- `resolveAssignmentStatus({ assignment, submission, nowInClientTz })` → one of `upcoming | due | due_today | overdue | in_progress | submitted | reviewed | waived`.
- `getOutstandingFormActions(clientId)` server fn that joins `nf_assignments` + latest `nf_submissions` for the current period and returns one unified list. Used by Action Centre, bell, progress hub.
- Period key = ISO week start in client tz (existing `client_timezone` on `clients` table — fall back to business tz).

Status rules per spec: in_progress only when a saved draft row exists; submitted immediately on insert; reviewed when `reviewed_at` set; completed/reviewed/waived never appear in outstanding.

### 2. Fillout webhook → nf_submissions (smallest repair)

Migration:
- Add `assignment_id uuid`, `period_start date`, `fillout_submission_id text unique` to `nf_submissions`.
- Add partial unique index on `(assignment_id, period_start)` where status in ('submitted','reviewed') to prevent dupes.

Rewrite `src/routes/api/public/hooks/fillout.ts`:
- Read `assignment_id`, `client_id`, `form_id`, `period_start` from urlParameters/hiddenFields.
- Idempotent upsert into `nf_submissions` keyed by `fillout_submission_id`.
- Still write the raw payload row to `fillout_submissions` for archive/admin debugging (unchanged).
- Mark related due notifications resolved.

### 3. Fillout URL builder

Update `src/lib/fillout.ts` / `form-links.ts` to always append:
`?assignment_id=…&client_id=…&form_id=…&period_start=YYYY-MM-DD`
when constructing the Fillout open URL from an assignment context.

### 4. Native form completion (repair existing flow)

In `src/lib/native-forms.functions.ts` submit handler:
- Ensure `assignment_id` + `period_start` are written.
- Return updated status so client can optimistically refresh (`router.invalidate()` + `queryClient.invalidateQueries(['form-status'])`).
- Guard against duplicate submits with `ON CONFLICT (assignment_id, period_start) DO NOTHING` when status='submitted'.

### 5. Notifications — make taps actionable

- Add `assignment_id` to notification metadata when a form notification is created.
- Update the bell click handler (`src/components/...notification list`) to route to `/client/forms/:assignmentId` (existing route) when present.
- Dedupe: one notification per (assignment_id, kind) per period.

### 6. Action Centre

Replace its current independent status calc with `getOutstandingFormActions(clientId)`. Sort: overdue → due_today → due → in_progress. Hide submitted/reviewed/waived.

### 7. Return-from-Fillout confirmation page

Add `/client/forms/$assignmentId/complete` route that:
- Re-queries assignment status with a 10s retry-on-Due fallback (poll every 1.5s) to absorb webhook latency.
- Shows "Syncing…" then "Submitted" or a manual "Confirm Submission" fallback (records `client_confirmed=true`).

### 8. Coach/admin view

Extend existing assignment row in `admin/clients.$id.tsx` and `admin/forms.tsx` to surface: form type, assigned/due/submitted dates, status, fillout_submission_id, verification source (webhook vs client_confirmed).

## Out of scope (will not touch)

- Workout / nutrition systems
- Form builder UI, question editor
- Replacing Fillout
- Historical responses
- Recurrence schedule definitions

## Verification

Manual test path on `exercisetutorials@gmail.com`:
1. Native weekly check-in → submit → confirm disappears from Action Centre, bell shows resolved, response viewable.
2. Fillout nutrition update → open from bell → submit in Fillout → return URL shows "Syncing" → flips to "Submitted" once webhook lands → Action Centre clears.
3. New week rolls over → previous submission stays, new assignment shows "Due".

## Files touched (estimate)

- New: `src/lib/form-status.ts`, `src/routes/_authenticated/m/forms.$assignmentId.complete.tsx`
- Migration: 1 (nf_submissions columns + indexes)
- Edited: `fillout.ts` webhook, `fillout.ts` URL builder, `native-forms.functions.ts`, Action Centre component, notification bell component, `form-links.ts`, admin client/forms views
- Estimated ~10 files, ~600 LOC net change

## Questions before I start

1. **Fillout webhook secret** — is `FILLOUT_WEBHOOK_SECRET` already set in Lovable Cloud secrets, and is the webhook configured in Fillout's dashboard pointing at `/api/public/hooks/fillout`? If not I'll need you to (a) confirm the secret exists and (b) reconfigure each Fillout form's webhook headers — I can't do that from code.
2. **Client timezone** — should I use `clients.timezone` if present and fall back to a single business tz (which one?), or always use one business tz?
3. **Confirmation page redirect** — Fillout supports a per-form "redirect URL after submit". You'll need to set that to `https://jfeffect.com/m/forms/{assignment_id}/complete` on each form. OK to proceed assuming you'll set this, or should I skip the return page and rely purely on webhook + Action Centre refresh?
