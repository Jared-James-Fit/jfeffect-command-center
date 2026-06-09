# Recipe Library + Community Broadcasts

Two new systems. Both prioritize fast admin entry and clean client display. No bloated forms.

---

## PART 1 — Recipe Library

### Admin
New route: `/admin/recipes`
- List view: cards/table with title, category, status, access summary, updated date. Filters: status, category, access. Search by title/tags.
- "New Recipe" button → simple dialog/page with only:
  - Title
  - Category (Breakfast / Lunch / Dinner / Snack / Dessert / Meal Prep / Custom)
  - Access (see below)
  - Status (Draft / Published / Archived)
  - **Recipe Body** — single large textarea, monospace-friendly, accepts the paste format
  - Optional Video Demo Link (YouTube/Vimeo/external URL)
  - Optional Tags (comma chips)
- Save = autosave + explicit Publish button.

### Recipe Body parser
A pure client-side parser splits the pasted body into sections by these headers (case-insensitive, colon optional):
`Recipe Title`, `Category`, `Servings`, `Ingredients`, `Instructions`, `Macros Per Serving`, `Notes`, `Video Demo Link`.
- Ingredients/Instructions/Notes → bullet/numbered lists (lines or `-` / `1.` prefixed).
- Macros → key/value chips (Protein, Carbs, Fats, Calories).
- Unknown sections render as titled paragraphs.
- If parser finds `Video Demo Link:` and the field is empty, auto-fill it.
- If parser finds `Recipe Title:` / `Category:` / `Servings:` and admin left them blank, prefill once.

A shared `<RecipeBodyView body={...} />` component renders parsed output on both admin preview and client detail.

### Recipe Formatting Guide
Admin-only card on the Recipes index ("Formatting Guide" expandable panel):
- Editable textarea (stored in `app_settings` key `recipe_format_prompt`)
- Save + Copy buttons
- Seeded with the default prompt from the spec.

### Access model
Per-recipe `access_scope`: `everyone | coaching_clients | app_members | program_members | selected_clients | hidden`.
For `selected_clients`, a child table `recipe_client_access(recipe_id, client_id)` with a picker dialog (search, select-all-visible, clear-all, save).

### Notifications
On publish (or when newly granted access on a published recipe), insert into existing notification surface. Reuse `client_activity_log`-style + a lightweight `recipe_notifications(client_id, recipe_id, seen_at)` row so the client portal can show a "New" badge. No email by default.

### Client portal
New route: `/portal/recipes` + `/portal/recipes/$recipeId`
- Lists only recipes the client has access to (status=Published).
- Card: title, category badge, "New" badge if `recipe_notifications.seen_at IS NULL`, short body preview, Open button.
- Detail: clean `RecipeBodyView`, embedded video (YouTube/Vimeo iframe) or "Watch Demo" link button for other URLs.
- Opening detail marks the notification seen.

Add `Recipes` to `clientNav`.

---

## PART 2 — Community Broadcasts

### Admin
New route: `/admin/broadcasts`
- List with filters (status, type, audience). Tabs: Active / Scheduled / Draft / Archived.
- Two entry points: **New Broadcast** (full dialog) and **Quick Broadcast** (compact 1-screen sheet).
- Fields:
  - Title
  - Type: Message / Quote / Voice Message / Video / Reminder / Update / Link
  - Message Body (textarea)
  - Voice: record (MediaRecorder) or upload, preview, delete/re-record. Transcript field (manual). If `lovable AI` transcription helper is available we call it on upload; otherwise blank — never blocks publish.
  - Video: paste URL (YouTube/Vimeo/external) or upload to storage bucket.
  - Optional Link URL + label.
  - Audience: same enum as recipes.
  - Publish Now / Schedule At / Optional Expiry At.
  - Status auto-derived: Draft → Scheduled (future publish_at) → Active (publish_at ≤ now and not expired) → Archived (expired or manual).

### Pop-up on client
Mount `<BroadcastPopupGate />` inside `_authenticated/portal/route.tsx` (also `_authenticated/m/route.tsx` for members).
- Fetches active broadcasts where the current user is in the audience and the user has NO `broadcast_seen(user_id, broadcast_id)` row with `action='got_it'`.
- Shows them one at a time as a Dialog. Actions:
  - **Got it** → insert seen row with `got_it_at`, dismiss permanently.
  - **View Later** → sessionStorage dismiss only; reappears next session.
  - Watch Video / Play Voice / Open Link inline as type dictates.
- Voice player = `<audio>` with custom transport. Video = lite YouTube/Vimeo embed or `<video>` for uploads. No autoplay with sound.

### Announcement history
`/portal/announcements` (+ link in `clientNav`). Lists past broadcasts the user had access to, with new badge for unseen, date, and inline media. Same component for member portal at `/m/announcements`.

### Seen tracking (admin)
Broadcast detail page shows: total recipients, seen count, unseen count, list of seen clients with timestamps.

### Scheduling
Lightweight: client-side derives `status` from `publish_at` / `expires_at` / explicit `status` column. Optional `pg_cron` job to flip a "needs notification" flag — initial cut just relies on derived status (no cron needed; popup query already filters by time).

---

## PART 3 — Database (one migration)

Tables (all with standard id/created_at/updated_at, RLS + GRANTs):

- `recipes` — title, category, status, access_scope, body, video_url, tags text[], author_id, published_at.
- `recipe_client_access` — recipe_id, client_id (unique).
- `recipe_notifications` — recipe_id, client_id, seen_at, unique(recipe_id, client_id).
- `broadcasts` — title, type, body, voice_path, voice_url, transcript, video_url, video_path, link_url, link_label, audience_scope, publish_at, expires_at, status, author_id.
- `broadcast_recipients` — broadcast_id, client_id (for `selected_clients` scope).
- `broadcast_seen` — broadcast_id, user_id, got_it_at, unique(broadcast_id, user_id).
- `app_settings` row for `recipe_format_prompt` (table already exists per schema).

Storage buckets (private):
- `recipe-media` (optional future use; not strictly needed since videos are URLs).
- `broadcast-media` (voice + uploaded video).

RLS:
- Admins/coaches manage rows.
- Clients/members read recipes if status=Published and access matches them (helper SQL fn `public.user_can_see_recipe(_uid, _recipe_id)`).
- Same pattern for broadcasts via `public.user_can_see_broadcast`.
- Seen tables: user writes own rows; admins read all.

GRANTs included for every public table to `authenticated` + `service_role`.

---

## PART 4 — Files (new / edited)

New:
- `supabase/migrations/<ts>_recipes_and_broadcasts.sql`
- `src/lib/recipes.ts` (CRUD + access + parser)
- `src/lib/recipe-format.ts` (parser + types, pure)
- `src/lib/broadcasts.ts` (CRUD + seen + audience query)
- `src/components/recipe-body-view.tsx`
- `src/components/recipe-form.tsx`
- `src/components/recipe-access-picker.tsx`
- `src/components/recipe-formatting-guide.tsx`
- `src/components/broadcast-composer.tsx` (full + quick mode prop)
- `src/components/broadcast-popup-gate.tsx`
- `src/components/broadcast-media-player.tsx` (voice + video)
- `src/routes/_authenticated/admin/recipes.tsx`
- `src/routes/_authenticated/admin/recipes.$recipeId.tsx`
- `src/routes/_authenticated/admin/broadcasts.tsx`
- `src/routes/_authenticated/admin/broadcasts.$broadcastId.tsx`
- `src/routes/_authenticated/portal/recipes.tsx`
- `src/routes/_authenticated/portal/recipes.$recipeId.tsx`
- `src/routes/_authenticated/portal/announcements.tsx`
- `src/routes/_authenticated/m/announcements.tsx` (member view if app_members in audience)

Edited:
- `src/lib/admin-nav.ts` — add Recipes + Broadcasts to admin + coach nav; Recipes + Announcements to client + member nav.
- `src/routes/_authenticated/portal/route.tsx` — mount `<BroadcastPopupGate />`.
- `src/routes/_authenticated/m/route.tsx` — mount `<BroadcastPopupGate />`.
- `src/integrations/supabase/types.ts` regenerates after migration approval.

---

## Order of operations
1. Run migration (creates tables, RLS, storage buckets via storage tool).
2. Write libs + components + routes.
3. Wire nav + popup gate.
4. Smoke test: create recipe, paste body, publish to Everyone → confirm client sees it formatted + "New" badge. Create a Quick Broadcast quote → confirm popup on client portal load → "Got it" dismisses permanently.

The first action will be the migration tool call; once approved I'll implement the rest in one pass.
