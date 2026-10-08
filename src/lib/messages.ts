import { supabase } from "@/integrations/supabase/client";
import { isViewingAsClient } from "@/lib/pov-guard";

export type SenderRole = "admin" | "client";

export type MessageAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "file" | "link" | "drive" | "sheets" | "youtube";
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  duration?: number;
  storage_path?: string;
  /** Videos: a small still frame uploaded next to the file, so bubbles don't have to load the video itself. */
  thumbnail_storage_path?: string;
  /** Videos: how the upload went on the sender's phone (compressed or not, why, timings). */
  transfer?: Record<string, string | number | null>;
  width?: number;
  height?: number;
  peaks?: number[];
  kind?: "sound" | "gif" | "payment_request" | "form_request" | "signature_request" | "recipe_share" | "checkin_request" | "checkin_submission" | "community_post";
  /** kind "community_post": the post it opens (e.g. a birthday post). */
  post_id?: string;
  fallback_emoji?: string;
  category?: string;
  purchase_id?: string;
  payment_url?: string;
  amount_cents?: number;
  currency?: string;
  title?: string;
  payment_structure?: string;
  status?: string;
  // chat request kinds:
  form_id?: string;
  template_id?: string;
  recipe_id?: string;
  agreement_ids?: string[];
  assignment_client_ids?: string[]; // clients the form was assigned to (group fan-out)
  agreement_client_map?: { client_id: string; agreement_id: string }[];
  request_title?: string;
  request_note?: string;
  checkin_submission_id?: string;
  checkin_occurrence_id?: string | null;
  checkin_task_type?: "weekly_checkin";
};

export type MessageReplyPreview = {
  sender_role: SenderRole;
  body: string;
  attachment_type?: MessageAttachment["type"] | null;
  attachment_name?: string | null;
  /** Storage path of the first photo/video (signed at render time), so replies can show a thumbnail. */
  attachment_path?: string | null;
  /** Public URL fallback for media with no storage path (e.g. GIFs). */
  attachment_url?: string | null;
  /** Video poster frame, so the quote doesn't have to load the video. */
  attachment_poster_path?: string | null;
  /**
   * Set when the reply is about ONE photo/video of a multi-media message:
   * its index in the original's `attachments`, and where it sits among the
   * photos/videos (1-based) out of how many, for "Video 2 of 4".
   */
  attachment_index?: number | null;
  attachment_position?: number | null;
  attachment_count?: number | null;
  is_internal_note?: boolean;
};

export type ReplyMedia = { type: "image" | "video"; path?: string; url?: string; posterPath?: string };

/** The photos and videos of a message, in order, with their index in `attachments`. */
export function mediaAttachments(
  message: Pick<Message, "attachments"> | null | undefined,
): Array<{ att: MessageAttachment; index: number }> {
  const out: Array<{ att: MessageAttachment; index: number }> = [];
  (message?.attachments ?? []).forEach((att, index) => {
    if (att && (att.type === "image" || att.type === "video") && (att.storage_path || att.url)) out.push({ att, index });
  });
  return out;
}

/**
 * Compact quote of `message` for a reply. With `attachmentIndex`, the reply
 * is about that one photo/video (a single clip out of several sent at once).
 */
export function makeReplyPreview(
  message: Pick<Message, "sender_role" | "body" | "attachments" | "is_internal_note">,
  attachmentIndex?: number | null,
): MessageReplyPreview {
  const media = mediaAttachments(message);
  // Only meaningful with 2+ photos/videos; with one, the message IS the clip.
  const pickedAt = attachmentIndex == null || media.length < 2 ? -1 : media.findIndex((x) => x.index === attachmentIndex);
  const picked = pickedAt >= 0 ? media[pickedAt].att : null;
  const first = picked ?? message.attachments?.[0];
  const isMedia = first?.type === "image" || first?.type === "video";
  return {
    sender_role: message.sender_role,
    body: (message.body || "").trim().slice(0, 260),
    attachment_type: first?.type ?? null,
    attachment_name: first?.name ?? null,
    // Lets the quote show a thumbnail without loading the original message.
    attachment_path: isMedia ? first?.storage_path ?? null : null,
    attachment_url: isMedia && !first?.storage_path ? first?.url || null : null,
    ...(isMedia && first?.thumbnail_storage_path ? { attachment_poster_path: first.thumbnail_storage_path } : {}),
    ...(picked
      ? { attachment_index: attachmentIndex, attachment_position: pickedAt + 1, attachment_count: media.length }
      : {}),
    is_internal_note: !!message.is_internal_note,
  };
}

/** "Video 2 of 4" when the reply is about one of several clips, else null. */
export function replyClipLabel(preview: MessageReplyPreview | null | undefined): string | null {
  if (preview?.attachment_index == null) return null;
  const kind = preview.attachment_type === "video" ? "Video" : preview.attachment_type === "image" ? "Photo" : null;
  if (!kind) return null;
  const pos = preview.attachment_position ?? 0;
  const count = preview.attachment_count ?? 0;
  return count > 1 && pos >= 1 ? `${kind} ${pos} of ${count}` : kind;
}

/** What the quote says: the clip ("Video 2 of 4"), else the text, else what was attached. */
export function replyPreviewText(preview?: MessageReplyPreview | null) {
  if (!preview) return "Original message";
  const clip = replyClipLabel(preview);
  if (clip) return clip;
  if (preview.body) return preview.body;
  // "IMG_5678.mov" means nothing in a quote; say what it is, like iMessage.
  if (preview.attachment_type === "video") return "Video";
  if (preview.attachment_type === "image") return "Photo";
  if (preview.attachment_name) return preview.attachment_name;
  if (preview.attachment_type) return `${preview.attachment_type.charAt(0).toUpperCase()}${preview.attachment_type.slice(1)} attachment`;
  return "Attachment";
}

// The fields that say which clip a reply is about. The database rebuilds
// reply_preview from the original's FIRST attachment on insert, so these are
// written back right after (see sendMessage).
const CLIP_KEYS = [
  "attachment_index", "attachment_position", "attachment_count", "attachment_type",
  "attachment_name", "attachment_path", "attachment_url", "attachment_poster_path",
] as const;

function clipFields(preview: MessageReplyPreview): Partial<MessageReplyPreview> {
  const out: Record<string, unknown> = {};
  for (const k of CLIP_KEYS) if (preview[k] !== undefined) out[k] = preview[k];
  return out as Partial<MessageReplyPreview>;
}

/**
 * A server row for a clip reply can arrive (realtime INSERT) before the clip
 * is written back. Keep the clip we already know locally so the quote
 * doesn't flip to the first video and back.
 */
export function keepReplyClip<T extends Pick<Message, "reply_to_message_id" | "reply_preview">>(
  server: T,
  local: Pick<Message, "reply_to_message_id" | "reply_preview"> | null | undefined,
): T {
  const lp = local?.reply_preview;
  if (!lp || lp.attachment_index == null || server.reply_preview?.attachment_index != null) return server;
  if (!server.reply_to_message_id || server.reply_to_message_id !== local?.reply_to_message_id) return server;
  return { ...server, reply_preview: { ...(server.reply_preview ?? lp), ...clipFields(lp) } };
}

/**
 * The photo/video to show as a reply thumbnail. Prefers the original message
 * when it's loaded (covers replies sent before previews carried a path), else
 * what the preview stored.
 */
export function replyMediaFor(
  preview: MessageReplyPreview | null | undefined,
  source?: Pick<Message, "attachments"> | null,
): ReplyMedia | null {
  // A reply about one clip shows that clip, not the first one.
  const idx = preview?.attachment_index;
  const first = source?.attachments?.[idx ?? 0];
  if (first && (first.type === "image" || first.type === "video") && (first.storage_path || first.url)) {
    return {
      type: first.type,
      path: first.storage_path || undefined,
      url: first.storage_path ? undefined : first.url,
      posterPath: first.type === "video" ? first.thumbnail_storage_path || undefined : undefined,
    };
  }
  if (preview && (preview.attachment_type === "image" || preview.attachment_type === "video")
    && (preview.attachment_path || preview.attachment_url)) {
    return {
      type: preview.attachment_type,
      path: preview.attachment_path || undefined,
      url: preview.attachment_url || undefined,
      posterPath: preview.attachment_type === "video" ? preview.attachment_poster_path || undefined : undefined,
    };
  }
  return null;
}

export type Message = {
  id: string;
  client_id: string;
  sender_id: string | null;
  sender_role: SenderRole;
  body: string;
  attachments: MessageAttachment[];
  message_type: string;
  priority: string | null;
  is_internal_note: boolean;
  read_by_admin_at: string | null;
  read_by_client_at: string | null;
  created_at: string;
  updated_at: string;
  transcript?: string | null;
  transcript_status?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_message_id?: string | null;
  reply_preview?: MessageReplyPreview | null;
  // Phase 4A delivery tracking (additive, optional for callers).
  delivery_status?: "pending" | "sending" | "sent" | "failed" | "scheduled" | "cancelled";
  delivery_error?: string | null;
  attempt_count?: number;
  last_attempt_at?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
  scheduled_by?: string | null;
  scheduled_tz?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
};

export type ConversationState = {
  client_id: string;
  priority: string;
  status: "open" | "needs_response" | "resolved" | "archived";
  admin_last_read_at: string | null;
  client_last_read_at: string | null;
  last_message_at: string | null;
  workflow_status?: "needs_response" | "waiting_on_client" | "done";
  workflow_reason?: string | null;
  last_inbound_at?: string | null;
};

export const MESSAGE_TYPES = [
  "General", "Training", "Nutrition", "Cardio", "Check-In",
  "Payment", "Scheduling", "Technical Support", "Injury / Modification", "Custom",
];

export const PRIORITIES = ["Normal", "Important", "High Priority"];

export const QUICK_REPLIES = [
  "I'll review this and get back to you.",
  "Upload a video when you can.",
  "I updated your program.",
  "Check your Nutrition Targets tab.",
  "Check your Cardio Targets section.",
  "Book a call if you need more help.",
  "I'll adjust this in your next update.",
];

export function detectAttachmentType(url: string): MessageAttachment["type"] {
  const u = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|svg)(\?|$)/.test(u)) return "image";
  if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(u)) return "video";
  if (/\.pdf(\?|$)/.test(u)) return "pdf";
  if (u.includes("drive.google.com")) return "drive";
  if (u.includes("docs.google.com/spreadsheets") || u.includes("sheets.google.com")) return "sheets";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  return "link";
}

const db = supabase as any;

/**
 * List delivered messages for a conversation.
 *
 * Bubble timeline only — excludes scheduled, failed, and cancelled rows so
 * they never appear in either the admin or client thread as normal bubbles.
 * Those are surfaced separately by listPendingMessages() in the admin strip.
 */
export async function listMessages(
  clientId: string,
  opts: { includeInternal?: boolean; limit?: number } = {},
) {
  const limit = opts.limit ?? 25;
  // Fetch the most recent N rows (desc + limit), then return in chronological
  // (ascending) order so the bubble timeline keeps its existing shape.
  let q = db
    .from("messages")
    .select("*")
    .eq("client_id", clientId)
    .in("delivery_status", ["sent", "sending"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!opts.includeInternal) q = q.eq("is_internal_note", false);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Message[]).slice().reverse();
}

/**
 * Load older delivered messages for a conversation, strictly before the given
 * ISO timestamp. Returns rows in chronological (ascending) order so callers
 * can prepend them directly to the existing thread.
 */
export async function listOlderMessages(
  clientId: string,
  beforeCreatedAt: string,
  limit: number = 50,
  opts: { includeInternal?: boolean } = {},
) {
  let q = db
    .from("messages")
    .select("*")
    .eq("client_id", clientId)
    .in("delivery_status", ["sent", "sending"])
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!opts.includeInternal) q = q.eq("is_internal_note", false);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Message[]).slice().reverse();
}

/**
 * Admin-only: scheduled / failed / cancelled rows for a conversation.
 * RLS already restricts non-delivered rows to admin, assigned coach, and the
 * original sender, so this is safe to call from the admin thread.
 */
export async function listPendingMessages(clientId: string) {
  const { data, error } = await db
    .from("messages")
    .select("*")
    .eq("client_id", clientId)
    .in("delivery_status", ["scheduled", "failed", "cancelled", "pending"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function sendMessage(input: {
  clientId: string;
  senderId: string;
  senderRole: SenderRole;
  body: string;
  attachments?: MessageAttachment[];
  messageType?: string;
  isInternalNote?: boolean;
  priority?: string | null;
  replyToMessageId?: string | null;
  replyPreview?: MessageReplyPreview | null;
}) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    sender_id: input.senderId,
    sender_role: input.senderRole,
    body: input.body,
    attachments: input.attachments ?? [],
    message_type: input.messageType ?? "General",
    is_internal_note: input.isInternalNote ?? false,
    reply_to_message_id: input.replyToMessageId ?? null,
    reply_preview: input.replyPreview ?? null,
  };
  if (input.senderRole === "admin" && input.priority !== undefined) row.priority = input.priority;
  if (input.senderRole === "admin") {
    row.read_by_admin_at = new Date().toISOString();
  } else {
    row.read_by_client_at = new Date().toISOString();
  }
  const { data, error } = await db.from("messages").insert(row).select().single();
  if (error) throw error;
  let saved = data as Message;
  // If the admin replies, the conversation no longer "needs response".
  // Bookkeeping, not part of delivery: don't make the send wait on it.
  if (input.senderRole === "admin") {
    void db
      .from("conversation_state")
      .update({ status: "open" })
      .eq("client_id", input.clientId)
      .eq("status", "needs_response")
      .then(() => {}, () => {});
  }
  // Fire-and-forget push notification. Never block the send on push failures.
  if (data?.id) {
    void (async () => {
      try {
        const { notifyNewMessage } = await import("@/lib/push/events.functions");
        await notifyNewMessage({ data: { messageId: data.id } });
      } catch (e) {
        console.warn("[push] notifyNewMessage failed", e);
      }
    })();
  }
  // Reply to one clip of several: the insert trigger rebuilt the quote from
  // the first attachment, so write the chosen clip back. Updating only
  // reply_preview doesn't re-run that trigger. If this fails the reply still
  // went out; it just quotes the message as a whole.
  const clip = input.replyPreview;
  if (clip?.attachment_index != null && saved.reply_to_message_id && saved.reply_preview?.attachment_index == null) {
    try {
      const { data: patched, error: patchError } = await db
        .from("messages")
        .update({ reply_preview: { ...(saved.reply_preview ?? clip), ...clipFields(clip) } })
        .eq("id", saved.id)
        .select()
        .single();
      if (!patchError && patched) saved = patched as Message;
    } catch (e) {
      console.warn("[messages] reply clip not saved", e);
    }
  }
  return saved;
}

export async function markRead(clientId: string, role: SenderRole) {
  // A coach viewing as this client must not mark the client's messages as read.
  if (role === "client" && (await isViewingAsClient(clientId))) return;
  const now = new Date().toISOString();
  // Staff unread is per coach/admin: this only clears MY blue dot. It never
  // changes the conversation's workflow status (Needs Response stays).
  if (role === "admin") {
    try { await (db as any).rpc("staff_mark_conversation_read", { _client_id: clientId }); } catch {}
  }
  // Mark conversation state
  const patch =
    role === "admin"
      ? { client_id: clientId, admin_last_read_at: now }
      : { client_id: clientId, client_last_read_at: now };
  await db.from("conversation_state").upsert(patch, { onConflict: "client_id" });
  // Stamp messages from the opposite side
  const col = role === "admin" ? "read_by_admin_at" : "read_by_client_at";
  const oppRole = role === "admin" ? "client" : "admin";
  await db.from("messages").update({ [col]: now })
    .eq("client_id", clientId)
    .eq("sender_role", oppRole)
    .is(col, null);
  // Best-effort: dismiss OS-level notifications + PWA app badge for this thread
  // so the reminder disappears the moment the conversation is opened.
  try { await dismissMessageBadges(clientId); } catch {}
}

/**
 * Mark a conversation as UNREAD from the current side.
 * Sets the conversation's last-read timestamp to just before the most recent
 * incoming message so the unread count / badge reappears, and clears the
 * per-message read receipt on that latest incoming message.
 */
export async function markUnread(clientId: string, role: SenderRole) {
  if (role === "admin") {
    // Brings back MY blue dot only; workflow status is untouched.
    await (db as any).rpc("staff_mark_conversation_unread", { _client_id: clientId });
    return;
  }
  // Client side: rewind the client's own read position.
  const oppRole = "admin";
  const col = "read_by_client_at";
  const readCol = "client_last_read_at";

  // Find the most recent incoming message from the peer
  const { data: latest } = await (db.from("messages") as any)
    .select("id, created_at")
    .eq("client_id", clientId)
    .eq("sender_role", oppRole)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rewind = latest?.created_at
    ? new Date(new Date(latest.created_at).getTime() - 1).toISOString()
    : null;

  await db
    .from("conversation_state")
    .upsert({ client_id: clientId, [readCol]: rewind } as any, { onConflict: "client_id" });

  if (latest?.id) {
    await (db.from("messages") as any).update({ [col]: null }).eq("id", latest.id);
  }
}

/**
 * Close any queued OS notifications for a message thread and clear the PWA
 * app-icon badge. Safe to call from anywhere in the browser; no-ops on
 * unsupported platforms (iOS Safari without PWA install, etc.).
 */
export async function dismissMessageBadges(clientId: string) {
  if (typeof window === "undefined") return;
  try {
    const nav: any = window.navigator;
    if (nav && typeof nav.clearAppBadge === "function") {
      await nav.clearAppBadge();
    } else if (nav && typeof nav.setAppBadge === "function") {
      await nav.setAppBadge(0);
    }
  } catch {}
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const tag = `msg:${clientId}`;
        const list = await reg.getNotifications({ tag });
        list.forEach((n) => { try { n.close(); } catch {} });
      }
    }
  } catch {}
}

export async function listConversationStates() {
  const { data, error } = await db.from("conversation_state").select("*");
  if (error) throw error;
  return (data ?? []) as ConversationState[];
}

export async function setConversationStatus(clientId: string, status: ConversationState["status"]) {
  await db.from("conversation_state").upsert({ client_id: clientId, status }, { onConflict: "client_id" });
}

export type WorkflowStatus = "needs_response" | "waiting_on_client" | "done";

/** Coach override: Needs Response / Waiting on Client / Done. Never touches unread. */
export async function setConversationWorkflow(clientId: string, status: WorkflowStatus) {
  const { error } = await (db as any).rpc("set_conversation_workflow", { _client_id: clientId, _status: status });
  if (error) throw error;
}

export async function setConversationPriority(clientId: string, priority: string) {
  await db.from("conversation_state").upsert({ client_id: clientId, priority }, { onConflict: "client_id" });
}

export async function editMessage(messageId: string, body: string) {
  const { data, error } = await db
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select()
    .single();
  if (error) throw error;
  return data as Message;
}

export async function deleteMessageForEveryone(messageId: string) {
  const { error } = await db
    .from("messages")
    .update({
      deleted_at: new Date().toISOString(),
      body: "",
      attachments: [],
    })
    .eq("id", messageId);
  if (error) throw error;
}

/**
 * Admin-only silent delete: removes the messages outright (no placeholder, no
 * timestamp for the client). A copy is kept in message_deletions, which only
 * admins and the client's coach can read.
 */
export async function adminDeleteMessages(ids: string[], chat: "dm" | "group" = "dm") {
  if (!ids.length) return 0;
  const fn = chat === "group" ? "admin_delete_group_messages" : "admin_delete_messages";
  const { data, error } = await (db as any).rpc(fn, { _ids: ids });
  if (error) throw error;
  return Number(data ?? 0);
}

export type MessageDeletion = {
  id: string;
  message_id: string;
  chat: "dm" | "group";
  client_id: string | null;
  group_id: string | null;
  sender_role: string | null;
  body: string | null;
  attachments: MessageAttachment[] | null;
  original_created_at: string | null;
  deleted_by: string | null;
  deleted_at: string;
};

/** Staff log of silently deleted messages for one 1:1 chat or group. */
export async function listMessageDeletions(scope: { clientId?: string; groupId?: string }) {
  let q = (db as any).from("message_deletions").select("*").order("deleted_at", { ascending: false }).limit(100);
  q = scope.groupId ? q.eq("group_id", scope.groupId) : q.eq("client_id", scope.clientId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MessageDeletion[];
}

/* ------------------------------- Reactions ------------------------------- */

export type MessageReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export const REACTION_EMOJIS = ["👍", "🔥", "💪", "✅", "👀", "❤️", "😂"];

export async function listReactions(clientId: string): Promise<MessageReaction[]> {
  // Pull all reactions for messages in this client's thread in one shot.
  const { data: msgs, error: mErr } = await db
    .from("messages").select("id").eq("client_id", clientId);
  if (mErr) throw mErr;
  const ids = (msgs ?? []).map((m: any) => m.id);
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("message_reactions").select("*").in("message_id", ids);
  if (error) throw error;
  return (data ?? []) as MessageReaction[];
}

export async function addReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await db
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji });
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

export async function removeReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await db
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);
  if (error) throw error;
}

export async function toggleReaction(
  messageId: string, userId: string, emoji: string, mine: MessageReaction[],
) {
  // One reaction per user per message:
  //  - tap same emoji again -> remove
  //  - tap a different emoji -> replace previous
  //  - no prior reaction -> add
  const mineOnMsg = mine.filter((r) => r.message_id === messageId);
  const samePicked = mineOnMsg.find((r) => r.emoji === emoji);
  if (samePicked) {
    await removeReaction(messageId, userId, emoji);
    return { removed: [emoji], added: null as string | null };
  }
  // Replace: clear all of this user's other emojis on this message first.
  const removed: string[] = [];
  for (const r of mineOnMsg) {
    await removeReaction(messageId, userId, r.emoji);
    removed.push(r.emoji);
  }
  await addReaction(messageId, userId, emoji);
  return { removed, added: emoji };
}

export function priorityTone(p?: string | null) {
  switch (p) {
    case "High Priority": return "border-destructive/40 bg-destructive/10 text-destructive";
    case "Important": return "border-warning/40 bg-warning/10 text-warning";
    case "Needs Response": return "border-primary/40 bg-primary/10 text-primary";
    case "Resolved": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
    default: return "border-border text-muted-foreground";
  }
}