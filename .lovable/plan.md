## Two features for chat

### Feature 1 — Double-tap quick reaction + admin default

**Admin setting**
- New row in `app_settings`: `key = 'chat_default_reaction'`, `value_text` = emoji (default `✅`).
- New admin route `/admin/settings/chat` (under Communication) with a 7-emoji picker: ✅ 👍 🔥 💪 ❤️ 👀 😂. Saves to `app_settings`.
- Add nav entry under existing admin Settings/Communication area.

**Client behavior (`src/components/message-thread.tsx`)**
- Load setting once via React Query (`chatDefaultReactionQuery`), default `✅` if unset.
- Add `useDoubleTap(onDoubleTap)` hook attached to each non-deleted message bubble:
  - Mobile: track `touchend` timestamps, fire when 2 taps <300ms and movement <10px.
  - Desktop: `onDoubleClick` only when `window.getSelection().isCollapsed`.
  - Ignore taps where `e.target.closest('a, video, img, button, [data-no-doubletap]')`.
- On double-tap, call existing optimistic `onToggleReaction(message.id, defaultEmoji)` — already toggles add/remove.
- Add a tiny CSS pop animation (`@keyframes reaction-pop { 0%{scale:.6;opacity:0} 60%{scale:1.15} 100%{scale:1} }`, ~240ms) applied to the reaction chip when it first mounts.
- Verify reaction chip styling — remove any red ring/border, use subtle muted bubble; align left for incoming, right for outgoing.

### Feature 2 — GIF / Effects library

**DB (one migration)**
- `chat_gifs(id, title, category, tags text[], media_url, media_type, thumb_url, is_featured, active, archived, sort_order, created_at)`
- `chat_gif_favorites(user_id, gif_id, created_at, pk(user_id,gif_id))`
- `chat_gif_recent(user_id, gif_id, used_at, pk(user_id,gif_id))`
- Add app_settings keys: `gifs_clients_send`, `gifs_app_members_send`, `gifs_program_members_send` (bool).
- GRANTs + RLS: everyone authenticated reads active gifs; admin/coach manage; users manage own favorites/recent.
- Storage bucket `chat-gifs` (private, signed URLs); admin uploads.
- Seed ~30 starter rows pointing to curated public Giphy/Tenor URLs across categories (Hype/PR/Reviewed/Support/Funny/Humour/Gym Pain/Cardio/Excuses/Celebration).

**Sending (extends existing message system)**
- Reuse `messages` with `message_type = 'gif'`, store URL in existing media field. No schema change to messages if `media_url + media_type` already exist; otherwise add `media_kind` text.
- `MessageThread` renders gif messages as clean media card (img with object-contain, max-h 240, rounded, no border), respects `prefers-reduced-motion` (swap animated webp/gif for static thumb).

**Picker (`src/components/gif-picker.tsx`)**
- Trigger: small `✨ GIF` button in composer (`message-thread.tsx` composer).
- Popover/sheet with: search input, category chips, Recent + Favorites tabs, virtualized grid (lazy `<img loading="lazy">`), star-to-favorite.
- Selecting a gif → sends message via existing `sendMessage` with media url, increments `chat_gif_recent`.
- Gate visibility by user role + admin permission settings.

**Admin library (`/admin/chat-gifs`)**
- List/grid with category filter, add/edit dialog: title, category, tags, URL or upload, featured, active, archive.
- Permissions toggles for clients/app_members/program_members.

### Files

New:
- `supabase/migrations/<ts>_chat_gifs_and_defaults.sql`
- `src/lib/chat-settings.ts` (read/write app_settings keys)
- `src/lib/chat-gifs.ts`
- `src/hooks/use-double-tap.ts`
- `src/components/gif-picker.tsx`
- `src/routes/_authenticated/admin/settings.chat.tsx`
- `src/routes/_authenticated/admin/chat-gifs.tsx`

Edited:
- `src/components/message-thread.tsx` (double-tap, animation, gif button, gif rendering)
- `src/lib/messages.ts` (support gif message type if needed)
- `src/lib/admin-nav.ts` (Chat Settings + GIF Library entries)
- `src/integrations/supabase/types.ts`
- `src/styles.css` (reaction-pop keyframes)

### Testing
- Admin set default → verify `app_settings` row, refresh, default persists.
- Mobile double-tap bubble: reaction appears with pop, double-tap again removes.
- Tap link/image inside bubble still opens it.
- Long-press menu, swipe-to-time, scroll unaffected.
- Deleted messages: double-tap no-op.
- GIF picker: search, categories, favorites, recents, send, render, lazy-load.
- Permission toggles hide button for disallowed roles.
- Reduced-motion: static thumbs.

Scope note: GIF-as-reaction (vs standalone message) is deferred per your "prioritize standalone first" guidance.
