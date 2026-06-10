## Goal

Make admin/coach lift video review feel like the messenger: thumbnails everywhere, instant open, prominent Reviewed action, and a composer with the same GIF, attachment, and voice tools that 1:1 messaging has.

## 1. Thumbnails everywhere

`lift_videos.thumbnail_url` already exists. Today the client uploader generates a thumbnail but the inbox row renders a generic Play icon and the detail panel waits on a signed URL before showing anything.

- **Inbox `ThumbBlock`** (`src/routes/_authenticated/admin/lift-videos.tsx`): render `<img src={latest.thumbnail_url}>` when present, falling back to the existing Play placeholder. Bigger thumb on desktop (96×72), show urgent ring + clip count badge as today.
- **Detail panel video** (`src/components/admin-lift-review-thread.tsx`): pass `thumbnail_url` as `poster` to `LiftVideoPlayer` (already supports `thumbnailUrl`) and render the poster immediately while the signed URL resolves, so the panel never shows a black box.
- **Backfill missing thumbnails**: when a video is opened in review and has no `thumbnail_url`, generate one from the signed URL in the browser (canvas grab, same approach as `client-lift-video-uploader.tsx`) and persist via an `updateLiftVideo({ thumbnail_url })` call. One-shot, non-blocking.

## 2. Faster, smoother detail open

- **Pre-warm signed URL**: kick off `getSignedVideoUrl` for the row the user hovers (desktop) and on row mount for the first 6 visible rows so opens feel instant.
- **Optimistic mount**: render the detail card immediately with the thumbnail poster + meta strip; swap to the `<video>` element only once the signed URL arrives. Avoid the current "Preview unavailable" flash by showing a subtle skeleton over the poster.
- **Transition**: add a small fade/slide-in on the mobile detail view (`transition-opacity`, `data-state` pattern) so the pop-up feels smooth instead of snapping.
- **React Query**: bump `staleTime` for `lift-videos-admin` to 30s and `placeholderData: keepPreviousData` so the inbox doesn't flash empty on refetches.

## 3. Prominent Reviewed button

In the quick-actions strip (`admin-lift-review-thread.tsx`):

- Pull "Reviewed" out of the small pill row into a dedicated large button: full-width on mobile, `h-11`, primary variant, check icon, label flips to "✓ Reviewed" (success styling) when `reviewed_at` is set. Re-tap unmarks.
- Keep the other quick actions (Watched, Like, Follow-up, Archive) in the compact pill row underneath.

## 4. Composer parity with messenger

The 1:1 messenger composer (`src/components/message-thread.tsx`) has GIFs, attachments, and voice memos. Extract those affordances into a small reusable surface and reuse it in the lift review thread for both coach replies and (downstream) client replies.

- **Extract** `src/components/composer-tools.tsx` exporting:
  - `<AttachmentButton onPicked={(files)=>...}>` — wraps the existing file input + `uploadAttachment` flow.
  - `<GifButton onPick={(gif)=>...}>` — wraps `GifPicker`.
  - `<VoiceMemoButton onRecorded={(blob, peaks, duration)=>...}>` — wraps `useVoiceRecorder` UI.
  Each renders the same icon button + popover used in messenger.
- **`admin-lift-review-thread.tsx`**: replace the textarea-only composer with the same shell — left side: attachment + gif + voice buttons; right side: send. Keep the Internal note switch.
- **Storage**: lift video comments need to carry attachments. Extend `lift_video_comments` with a nullable `jsonb` `attachments` column (array of `SharedAttachment`) via migration; render attachments inside the bubble via the existing `SharedAttachment` renderer used by chat.
- **Client side**: update `src/components/client-lift-video-uploader.tsx` reply textarea (or wherever clients reply to a review) to use the same `composer-tools` surface so the experience is symmetric. (Confirm exact client reply entry point during implementation; if clients reply through a different component, swap it there.)

## 5. Realtime + notifications

No new wiring needed — the existing `lift_video_comments` channel already invalidates the inbox query. Attachments ride the same row.

## Technical notes

- New migration: `alter table public.lift_video_comments add column attachments jsonb`. RLS unchanged; existing policies already cover the row. No new grants needed.
- No edge functions; everything stays in TanStack client + existing storage bucket `message-attachments` (reused for parity, or a new `lift-review-attachments` bucket if you prefer separation — say which).
- No design system token additions required; reuse existing button/primary tones.

## Files touched

- `src/routes/_authenticated/admin/lift-videos.tsx` — thumbnail row, prewarm.
- `src/components/admin-lift-review-thread.tsx` — poster, big Reviewed, new composer.
- `src/components/lift-video-player.tsx` — accept poster fallback.
- `src/components/composer-tools.tsx` *(new)* — shared GIF/attach/voice buttons.
- `src/components/message-thread.tsx` — swap in extracted buttons (no behavior change).
- `src/lib/lift-videos.ts` — `attachments` on comment type; `updateThumbnail` helper.
- `src/components/client-lift-video-uploader.tsx` (or client reply entry) — use shared composer.
- New SQL migration for `lift_video_comments.attachments`.

## Open questions

1. **Attachment bucket**: reuse `message-attachments` or create a separate `lift-review-attachments` bucket? Reuse is simpler; separate is cleaner for retention/archival.
2. **Client reply UI**: confirm clients reply to a review from the same lift video card on the portal (so I extend that file), or is there a separate thread component to update?
