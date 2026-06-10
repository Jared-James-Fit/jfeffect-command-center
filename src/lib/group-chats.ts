import { supabase } from "@/integrations/supabase/client";

export type GroupPermissionMode = "everyone" | "admins_only" | "read_only";
export type GroupMemberRole = "admin" | "member";

export type ChatGroup = {
  id: string;
  name: string;
  description: string | null;
  permission_mode: GroupPermissionMode;
  created_by: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatGroupMember = {
  group_id: string;
  user_id: string;
  role: GroupMemberRole;
  last_read_at: string | null;
  added_at: string;
  added_by: string | null;
};

export type GroupAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "file" | "link" | "drive" | "sheets" | "youtube";
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  storage_path?: string;
  duration?: number;
  peaks?: number[];
  kind?: "sound" | "gif" | "payment_request" | "form_request" | "signature_request" | "recipe_share";
  fallback_emoji?: string;
  category?: string;
  purchase_id?: string;
  payment_url?: string;
  amount_cents?: number;
  currency?: string;
  title?: string;
  payment_structure?: string;
  status?: string;
  form_id?: string;
  template_id?: string;
  recipe_id?: string;
  agreement_ids?: string[];
  assignment_client_ids?: string[];
  agreement_client_map?: { client_id: string; agreement_id: string }[];
  request_title?: string;
  request_note?: string;
};

export type GroupMessage = {
  id: string;
  group_id: string;
  sender_id: string | null;
  sender_role: string;
  body: string;
  attachments: GroupAttachment[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type GroupReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

const db = supabase as any;

function normalizeAttachments(value: unknown): GroupAttachment[] {
  if (Array.isArray(value)) return value.filter(Boolean) as GroupAttachment[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) as GroupAttachment[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeGroupMessage(row: any): GroupMessage {
  return {
    ...row,
    body: typeof row?.body === "string" ? row.body : "",
    attachments: normalizeAttachments(row?.attachments),
  } as GroupMessage;
}

export async function listMyGroups(): Promise<ChatGroup[]> {
  const { data, error } = await db.from("chat_groups").select("*").eq("archived", false).order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllGroupsForAdmin(): Promise<ChatGroup[]> {
  const { data, error } = await db.from("chat_groups").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const { data, error } = await db.from("group_messages").select("*").eq("group_id", groupId).order("created_at", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data.map(normalizeGroupMessage) : [];
}

export async function listGroupMembers(groupId: string): Promise<ChatGroupMember[]> {
  const { data, error } = await db.from("chat_group_members").select("*").eq("group_id", groupId);
  if (error) throw error;
  return data ?? [];
}

export type GroupMemberProfile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
};

/** Display info (name + avatar) for everyone in a group the caller can see. */
export async function listGroupMemberProfiles(groupId: string): Promise<GroupMemberProfile[]> {
  const { data, error } = await (supabase as any).rpc("get_group_member_profiles", {
    _group_id: groupId,
  });
  if (error) throw error;
  return (data ?? []) as GroupMemberProfile[];
}

export async function listMyGroupMemberships(userId: string): Promise<ChatGroupMember[]> {
  const { data, error } = await db.from("chat_group_members").select("*").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function sendGroupMessage(input: {
  groupId: string;
  senderId: string;
  senderRole: string;
  body: string;
  attachments?: GroupAttachment[];
}) {
  const row = {
    group_id: input.groupId,
    sender_id: input.senderId,
    sender_role: input.senderRole,
    body: input.body,
    attachments: input.attachments ?? [],
  };
  const { data, error } = await db.from("group_messages").insert(row).select().single();
  if (error) throw error;
  // bump group updated_at for sort order
  await db.from("chat_groups").update({ updated_at: new Date().toISOString() }).eq("id", input.groupId);
  return data as GroupMessage;
}

export async function editGroupMessage(messageId: string, body: string) {
  const { error } = await db.from("group_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw error;
}

export async function deleteGroupMessageForEveryone(messageId: string) {
  const { error } = await db.from("group_messages")
    .update({ deleted_at: new Date().toISOString(), body: "", attachments: [] })
    .eq("id", messageId);
  if (error) throw error;
}

export async function markGroupRead(groupId: string, userId: string) {
  await db.from("chat_group_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", userId);
}

export async function listGroupReactions(groupId: string): Promise<GroupReaction[]> {
  const { data: msgs } = await db.from("group_messages").select("id").eq("group_id", groupId);
  const ids = (msgs ?? []).map((m: any) => m.id);
  if (ids.length === 0) return [];
  const { data, error } = await db.from("group_message_reactions").select("*").in("message_id", ids);
  if (error) throw error;
  return data ?? [];
}

export async function toggleGroupReaction(messageId: string, userId: string, emoji: string, mine: GroupReaction[]) {
  const mineOnMsg = mine.filter((r) => r.message_id === messageId);
  const same = mineOnMsg.find((r) => r.emoji === emoji);
  if (same) {
    await db.from("group_message_reactions").delete().eq("id", same.id);
    return;
  }
  for (const r of mineOnMsg) {
    await db.from("group_message_reactions").delete().eq("id", r.id);
  }
  await db.from("group_message_reactions").insert({ message_id: messageId, user_id: userId, emoji });
}

export const GROUP_REACTION_EMOJIS = ["👍", "🔥", "💪", "✅", "👀", "❤️", "😂"];

export async function uploadGroupAttachment(groupId: string, file: File): Promise<GroupAttachment> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const path = `group/${groupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? "." + ext : ""}`;
  const { error } = await supabase.storage.from("message-attachments").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || undefined,
  });
  if (error) throw error;
  const m = file.type.toLowerCase();
  const type: GroupAttachment["type"] =
    m.startsWith("image/") ? "image" :
    m.startsWith("video/") ? "video" :
    m.startsWith("audio/") ? "audio" :
    m === "application/pdf" ? "pdf" : "file";
  return { type, url: "", storage_path: path, name: file.name, size: file.size, mime: file.type };
}

export async function signedAttachmentUrl(path: string) {
  const { data, error } = await supabase.storage.from("message-attachments").createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}