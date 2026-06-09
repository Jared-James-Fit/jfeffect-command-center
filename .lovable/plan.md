## Sound Effects in Chat — Implementation Plan

Build on the existing GIF/effects system. Sounds reuse the same patterns: a library table, favorites/recent, an admin manager, a picker tab inside the existing GIF popover, and a clean in-chat audio card. No autoplay anywhere.

---

### 1. Database & Storage (one migration)

New tables (mirror `chat_gifs`):
- `chat_sounds` — `id, title, category, tags[], media_url, duration_ms, is_featured, active, archived, sort_order, created_text, created_at`
- `chat_sound_favorites` — `user_id, sound_id, created_at`
- `chat_sound_recent` — `user_id, sound_id, last_used_at, use_count`

`app_settings` keys (new rows, all default to sane values):
- `chat_sound_clients_send` → `true`
- `chat_sound_clients_play` → `true`
- `chat_sound_app_members_send` → `false`
- `chat_sound_program_members_send` → `false`

Storage: new private bucket `chat-sounds`. Signed URLs for playback.

RLS:
- `chat_sounds` — admin/coach full; authenticated select where `active = true AND archived = false`
- favorites/recent — owner-only
- Standard GRANTs included in the migration

Seed: 24 starter sounds across Hype / PR & Wins / Funny / Coach Reactions / Cardio / Gym Pain, sourced from royalty-free hosts (mixkit / pixabay) — short MP3 URLs (~1–3s, <60KB each).

### 2. Reuse `messages` table

New `message_type = 'sound'`. Existing `media_url` / `media_type = 'audio/mpeg'` carries the file. `body` carries the sound title for display + delete-for-everyone parity.

### 3. Lib

`src/lib/chat-sounds.ts`:
- `listSounds({ category?, search? })`, `listCategories()`
- `toggleFavorite(soundId)`, `bumpRecent(soundId)`
- `listFavorites()`, `listRecent(limit=12)`
- Admin CRUD: `createSound`, `updateSound`, `archiveSound`, `uploadSoundFile(file) → media_url`
- `sendSoundMessage({ conversationId, sound })` — wraps existing `sendMessage`

Extend `chat-settings.ts` with the four new toggles + helpers `canSendSound(role)`, `canPlaySound(role)`.

### 4. Audio playback singleton

`src/lib/sound-player.ts`:
- Single shared `HTMLAudioElement`; starting a new sound stops the previous one
- Lazy `new Audio(url)` only on first play per message
- LRU cache of last 8 decoded URLs
- Respects `prefers-reduced-motion` only for visual pulse, not muting
- Never autoplays — `playSound(url)` is always user-gesture-initiated

### 5. Picker UI

Extend the existing `gif-picker.tsx` (currently `✨ GIF`) into tabs: **GIFs | Sounds**.
- Sounds tab: search input, category chips, lists Featured / Recent / Favorites / All
- Each row: title, duration badge, ▶︎ preview (uses shared player, stops on next), ★ favorite, tap card → send
- Virtualized list, fetch-on-open only (no preloading on chat mount)

### 6. Chat message rendering

In `message-thread.tsx` branch on `message_type === 'sound'`:
- Clean card: speaker icon, "Sound Effect" label, bold title, big circular Play button, duration
- Tap play → shared player; button shows pause + progress while active
- Honors `canPlaySound(viewerRole)` — if disabled, shows the card but Play is disabled with a tooltip
- Inherits delete-for-everyone, read receipts, timestamps, retry, failed state from existing message pipeline
- Double-tap and existing reactions continue to work on the bubble

### 7. Admin manager

New route `/admin/chat-sounds`:
- Table with category filter, featured toggle, active/archived toggle
- Upload dialog: file input (mp3/m4a/ogg, max 200KB, <5s enforced client-side via `Audio.duration`), title, category, tags, featured
- Archive with confirm dialog
- Linked from `admin-nav.ts` next to "Chat GIF Library"

Extend `/admin/settings/chat` with a "Sound Effects" section exposing the four permission toggles.

### 8. Permissions enforcement

- Composer hides the Sounds tab when `canSendSound(role)` is false
- Server-side: extend the existing message insert guard to reject `message_type = 'sound'` when sender role lacks permission
- Play disabled for clients when `chat_sound_clients_play = false`

### 9. Scope deferral

- **Sound-as-reaction** is deferred per the user's own "prioritize standalone first" guidance. Will be follow-up once standalone is solid.
- **Autoplay setting** intentionally omitted — autoplay stays off, no toggle.

### 10. Files

**New:**
- `supabase/migrations/<ts>_chat_sounds.sql`
- `src/lib/chat-sounds.ts`, `src/lib/sound-player.ts`
- `src/components/sound-picker-panel.tsx`, `src/components/chat-sound-card.tsx`
- `src/routes/_authenticated/admin/chat-sounds.tsx`

**Edited:**
- `src/components/gif-picker.tsx` (add Sounds tab)
- `src/components/message-thread.tsx` (render sound message)
- `src/lib/chat-settings.ts`, `src/lib/messages.ts`, `src/lib/admin-nav.ts`
- `src/routes/_authenticated/admin/chat-settings.tsx` (or wherever the existing settings page lives)
- `src/integrations/supabase/types.ts`, `src/routeTree.gen.ts`

### Testing checklist mapping
All items from the user's checklist map to the above. Will verify by build + spot-check the picker, audio card render, permission gating, and admin upload flow.
