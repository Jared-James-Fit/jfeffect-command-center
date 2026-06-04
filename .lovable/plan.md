## Google Drive media + coaching review system

Files stored in Coach Jared's Google Drive (via the connected Drive account). The app stores only metadata, comments, status, and notifications.

### How uploads work (Workers-safe pattern)

Worker runtime can't proxy large videos. Instead:

```text
Browser file -> serverFn initUpload() -> Drive resumable session URI
Browser PUTs file bytes directly to Drive session URI
Browser -> serverFn finalizeUpload(driveFileId) -> save row in DB
```

The server only touches small JSON (metadata, session creation, finalize). Drive accepts CORS for resumable upload sessions.

### Drive folder layout

```text
[Root: configurable in Admin Settings]
  /Clients
    /{Client Full Name} ({clientId-short})
      /Lift Videos
      /Check-In Videos
      /Progress Photos
      /Training Videos
      /Documents
      /Other
```

Per-client folder + subfolders are auto-provisioned on first upload (or via "Create folder" button in client profile).

### Database

New tables (migration):

- `media_drive_settings` (singleton) — root_folder_id, root_folder_url, status
- `client_drive_folders` — client_id, root_folder_id, subfolder_ids jsonb (one entry per media type), folder_url, status, created_at
- `media_submissions` — parent batch (client_id, submission_type, batch_note, urgent_flag, status, clip_count)
- `media_items` — child files (submission_id, client_id, media_type, drive_file_id, drive_url, drive_embed_url, file_name, mime_type, size_bytes, duration_seconds, thumbnail_url, clip_note, clip_order, status, urgent_flag, pain_note)
- `media_comments` — timestamped feedback (media_item_id, author_id, author_role, body, video_timestamp_seconds, comment_type, is_internal_note)
- `media_view_state` — admin_last_viewed_at, client_last_viewed_at per media_item

Statuses: `Pending Review | In Review | Reviewed | Needs Follow-Up | Archived`.

RLS: admin full access; coach access via `is_assigned_coach`; client read own non-internal; client insert own submissions/items.

### Server functions (createServerFn)

`src/lib/drive.functions.ts`:

- `getDriveSettings()` / `updateDriveSettings(rootFolderUrl)` — admin only
- `provisionClientFolder(clientId)` — creates client + subfolders in Drive, stores IDs
- `initMediaUpload({ clientId, mediaType, fileName, mimeType, sizeBytes })` — creates Drive resumable session, returns `{ uploadUrl, driveFolderId }`
- `finalizeMediaUpload({ submissionId, driveFileId, mediaType, clipNote, clipOrder, fileName, mimeType, sizeBytes })` — fetches Drive metadata, inserts `media_items` row
- `createSubmission({ clientId, submissionType, batchNote, urgent, painNote, clipCount })` — returns submissionId
- `setMediaStatus(itemId, status)` — coach only
- `addMediaComment({ itemId, body, timestampSeconds, commentType, isInternal })`

All Drive HTTP calls go through `https://connector-gateway.lovable.dev/google_drive/...` with `Authorization: Bearer $LOVABLE_API_KEY` and `X-Connection-Api-Key: $GOOGLE_DRIVE_API_KEY`.

### Frontend

Shared:
- `src/components/media-upload-dialog.tsx` — unified upload UI (multi-file, batch note vs per-clip notes, pain/urgent toggle). Drives the init→PUT→finalize flow with progress.
- `src/components/media-item-card.tsx` — embedded Drive preview iframe (`https://drive.google.com/file/d/{id}/preview`), comments list, timestamped comment composer, status controls.
- `src/components/media-inbox-list.tsx` — filterable list reused on admin route and dashboard widget.

Admin:
- `src/routes/_authenticated/admin/media-review.tsx` — "Media Review Inbox" route with filters (client, type, status, urgent, date).
- Add "Media" tab to `clients.$id.tsx` (sub-tabs by type) + "Drive folder" panel with Create/Open buttons.
- Add "Media Needing Review" widget to `admin/index.tsx`.
- Add Drive integration card to `admin/settings.tsx` (root folder URL + test).
- Add "Media Review" to `adminNav`.

Client:
- `src/routes/_authenticated/portal/media.tsx` — main client Media tab with sub-tabs (Lift Videos / Check-Ins / Progress Photos / Other).
- Reused upload dialog from each sub-tab.
- Add "Media" to `clientNav`; widget shortcut on `portal/index.tsx`.

### Out of scope (kept as TODO comments where touched)

- Migrating existing Supabase-stored lift videos — new uploads only.
- Per-coach Drive accounts; only the single connected coach account is used.
- Push notifications outside the existing in-app bell.

### Risk notes

- Drive `uploadType=resumable` returns the session URI in the `Location` header. The connector gateway forwards it. If CORS on `googleapis.com/upload/...` blocks the browser PUT we'll fall back to a server-streamed multipart upload limited to ~80 MB, with a clear UI message for larger files.
- Drive embed (`/preview`) requires the file to be shared (or the viewer signed into the Drive account). For client-facing embeds we set each uploaded file to `anyoneWithLink: reader` after finalize (toggleable from Settings).
