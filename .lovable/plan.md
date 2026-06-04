## Client ↔ Admin Messaging System

A simple, coaching-focused messaging system. Clients can only message admin/coach. Admin sees a unified inbox plus per-client threads.

### Database (new migration)

**`messages`** table (one row per message; conversation = all messages for a `client_id`)
- `client_id` (FK clients.id) — defines the thread
- `sender_id` (auth user id), `sender_role` ('admin' | 'client')
- `body` (text), `attachments` (jsonb: `[{type, url, name}]`)
- `message_type` (General/Training/Nutrition/Cardio/Check-In/Payment/Scheduling/Tech/Injury/Custom)
- `priority` (Normal/Important/High/NeedsResponse/Resolved) — admin-set only
- `is_internal_note` (bool, admin-only, hidden from clients)
- `read_by_admin_at`, `read_by_client_at`
- `created_at`, `updated_at`

**`conversation_state`** table (per-client thread metadata)
- `client_id` PK, `priority`, `status` ('open'|'needs_response'|'resolved'|'archived')
- `admin_last_read_at`, `client_last_read_at`, `last_message_at`

**RLS**
- Admin: full access via `has_role(auth.uid(), 'admin')`
- Client SELECT/INSERT on `messages` where `client_id` belongs to them AND `is_internal_note = false`; client inserts force `sender_role='client'`, `is_internal_note=false`, `priority=null`
- Client SELECT/UPDATE own `conversation_state` (only `client_last_read_at`)

**Storage**: reuse messaging via link attachments first; optional `message-attachments` bucket later.

**Realtime**: add `messages` and `conversation_state` to `supabase_realtime` publication.

### Frontend

**Shared**
- `src/lib/messages.ts` — types, helpers (`sendMessage`, `markRead`, `setPriority`, etc. using `supabase` client; RLS enforces scope)
- `src/components/message-thread.tsx` — reusable thread view (list + composer + attachment links + quick replies for admin)
- `src/components/notification-bell.tsx` — bell in AppShell header showing unread counts; subscribes to realtime

**Admin**
- `src/routes/_authenticated/admin/messages.tsx` — Inbox: list of conversations (avatar, name, last msg preview, time, unread count, priority badge), search + filters (Unread/Read/Needs Response/High/Archived/client/date), split view with selected thread.
- Add **Messages** tab to `src/routes/_authenticated/admin/clients.$id.tsx` with same thread component + internal-note toggle + priority/status controls.
- Admin dashboard widget "Messages Needing Response" in `admin/index.tsx`.
- Clients table (`clients.index.tsx`): add Messages indicator column (unread count, last msg date, needs-response chip) linking to thread.
- Add "Messages" to `adminNav` in `src/lib/admin-nav.ts`.

**Client**
- `src/routes/_authenticated/portal/messages.tsx` — single thread with Coach (no internal notes, no priority controls).
- Add "Messages" to `clientNav`.
- Add "Message Coach Jared" shortcut card on `portal/index.tsx`.
- Bell notifications for new coach replies.

**Notifications**
- Bell component fetches unread counts via `conversation_state` + realtime subscription; shows toast on new message.

### Out of scope (v1)
- Push/email notifications (in-app bell only)
- File uploads to storage (links only in v1)
- Client-side priority controls
- Quick-reply customization UI (hardcoded list first; editable later)

### Tech details
- All queries through `@/integrations/supabase/client` (RLS-scoped); no server fns needed for v1
- Quick replies: hardcoded array in `message-thread.tsx`
- Attachment input: paste URL → auto-detect type (image/video/pdf/link)
- Use existing design tokens; no new colors
