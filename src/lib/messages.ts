import { supabase } from "@/integrations/supabase/client";

export type SenderRole = "admin" | "client";

export type MessageAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "file" | "link" | "drive" | "sheets" | "youtube";
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  duration?: number;
  storage_path?: string;
  peaks?: number[];
  kind?: "sound" | "gif";
  fallback_emoji?: string;
  category?: string;
};

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
};

export type ConversationState = {
  client_id: string;
  priority: string;
  status: "open" | "needs_response" | "resolved" | "archived";
  admin_last_read_at: string | null;
  client_last_read_at: string | null;
  last_message_at: string | null;
};

export const MESSAGE_TYPES = [
  "General", "Training", "Nutrition", "Cardio", "Check-In",
  "Payment", "Scheduling", "Technical Support", "Injury / Modification", "Custom",
];

export const PRIORITIES = ["Normal", "Important", "High Priority", "Needs Response", "Resolved"];

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

export async function listMessages(clientId: string, opts: { includeInternal?: boolean } = {}) {
  let q = db.from("messages").select("*").eq("client_id", clientId).order("created_at", { ascending: true });
  if (!opts.includeInternal) q = q.eq("is_internal_note", false);
  const { data, error } = await q;
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
}) {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    sender_id: input.senderId,
    sender_role: input.senderRole,
    body: input.body,
    attachments: input.attachments ?? [],
    message_type: input.messageType ?? "General",
    is_internal_note: input.isInternalNote ?? false,
  };
  if (input.senderRole === "admin" && input.priority !== undefined) row.priority = input.priority;
  if (input.senderRole === "admin") {
    row.read_by_admin_at = new Date().toISOString();
  } else {
    row.read_by_client_at = new Date().toISOString();
  }
  const { data, error } = await db.from("messages").insert(row).select().single();
  if (error) throw error;
  return data as Message;
}

export async function markRead(clientId: string, role: SenderRole) {
  const now = new Date().toISOString();
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
}

export async function listConversationStates() {
  const { data, error } = await db.from("conversation_state").select("*");
  if (error) throw error;
  return (data ?? []) as ConversationState[];
}

export async function setConversationStatus(clientId: string, status: ConversationState["status"]) {
  await db.from("conversation_state").upsert({ client_id: clientId, status }, { onConflict: "client_id" });
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