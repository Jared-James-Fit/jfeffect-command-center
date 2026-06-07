
# Native Form & Check-In System (Replaces Fillout)

A full-native form builder + submission + review system, modeled on the JF Check-In Fillout form but with no Fillout dependency.

---

## 1. Database (new tables)

- **forms** *(extend existing `forms` table or new `native_forms`)* — title, description, type (`weekly_check_in`, `intake`, `custom`, …), recurring frequency (`none|weekly|biweekly|monthly`), active, archived, created_by, version.
- **form_questions** — form_id, order_index, type (`short_text|long_text|number|single_choice|multi_choice|dropdown|rating|date|file|video`), label, help_text, required, options (jsonb), validation (jsonb min/max/regex), conditional_logic (jsonb: `{show_if:[{question_id, op, value}]}`).
- **form_assignments** — form_id, client_id (nullable), client_group (nullable), recurrence, next_due_at.
- **form_submissions** — form_id, client_id, status (`not_started|in_progress|submitted|pending_review|reviewed`), started_at, submitted_at, reviewed_at, reviewed_by, week_index (for recurring).
- **form_answers** — submission_id, question_id, value_text, value_number, value_json, file_url.
- **form_submission_files** — submission_id, question_id, storage_path, mime, size, original_name.
- **form_reviews** — submission_id, coach_id, reply_text, sent_to_messenger_at, message_id.

All with RLS:
- Client: read/write own submissions; read forms assigned to them.
- Coach: read submissions of assigned clients; write reviews.
- Admin: full access.

Storage: new private bucket `form-uploads` for files/videos (linked to submission). Videos uploaded via signed URL flow — never stored in DB.

---

## 2. Coach/Admin — Form Builder

Route: `/admin/forms` (extend existing) + `/admin/forms/$id/edit`

- List of forms with green "Active & Assigned" indicator (active + ≥1 assignment + ≥1 question).
- Builder UI:
  - Add/edit/delete/reorder questions (drag handle).
  - Field types: short text, long text, number, single choice, multi choice, dropdown, rating (1–5/10), date, file, video.
  - Required toggle, help text, options editor.
  - Conditional logic editor: "Show this question if [Question X] [equals/not equals/contains/>/<] [value]".
  - Duplicate form button.
  - Assign to clients (multi-select) or "all active clients".
  - Recurring schedule (weekly / biweekly / monthly / one-time) with day-of-week.

---

## 3. Coach/Admin — Review Inbox

Route: `/admin/check-in-submissions`

- Inbox grouped by status: Pending Review → Reviewed.
- Filter by client, form, date.
- Detail view shows every question + answer, file/video previews.
- "Quick Reply" composer at top → on send:
  1. Creates `form_reviews` row.
  2. Marks submission `reviewed`.
  3. **Posts the reply as a coach message into the client's messenger thread** with a header line like *"Re: Weekly Check-In — Nov 12"* and a deep link back to the submission.
  4. Client can continue the conversation in messenger normally.

---

## 4. Client Experience

Route: `/portal/check-ins` (replaces existing Fillout link page)

- List of assigned forms with status badge (Not Started / In Progress / Submitted / Pending Review / Reviewed).
- For recurring forms, shows current period's instance + history of past weeks.
- Form renderer:
  - One question at a time on mobile, or scrollable list on desktop.
  - Honors required + conditional logic.
  - **Auto-saves on every change** → `form_submissions.status = in_progress`.
  - Resume from last unsaved spot.
  - File/video upload via signed URL to `form-uploads` bucket.
  - Final "Submit" → status `pending_review`.
- "Form History" tab showing all past submissions.

---

## 5. Pre-Seed: JF Check-In

Seed a `Weekly Check-In` form with the 23 questions from your Zapier payload (name, training week, phase, life updates, digestion, wins/PRs/injuries, workout feel, nutrition adherence, water, hunger, starvation, fasted bodyweight, sleep, stress, stress cause, cardio, cardio shortfall, etc.) as Short/Long/Number/Choice types — recurring weekly.

---

## 6. Permissions

- RLS on every table.
- `requireSupabaseAuth` server functions for builder mutations + submission reads.
- File uploads via signed URLs, validated server-side.

---

## 7. Mobile

- Form renderer uses existing mobile-tuned UI primitives (one-question-at-a-time mode under `md:`).
- Large tap targets, safe-area padding, iOS keyboard handling already in app shell.

---

## 8. Cleanup

- Remove Fillout link/button from `/portal/check-in` (replace with native renderer).
- Remove Zapier-webhook plan from prior message (no longer needed).
- Keep existing `check_in_links` table for backwards compat but hide UI behind a "Legacy" toggle.

---

## Scope of this build

This is a large, multi-day feature (~15+ files, ~6 new tables, builder + renderer + inbox + messenger integration). I'll build it in this order so each step is independently usable:

1. Schema + RLS + seed JF Check-In form.
2. Client form renderer with auto-save + status.
3. Coach review inbox + quick-reply → messenger.
4. Form builder (CRUD questions, conditional logic, assignments).
5. Recurring schedule + history.
6. Polish: green active indicator, mobile pass, remove Fillout references.

Confirm and I'll start at step 1 with the migration.
