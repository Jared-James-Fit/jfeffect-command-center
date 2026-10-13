/**
 * Cleo's chats on the server. Everything goes through the caller's own
 * client (RLS: each person only ever sees their own chats).
 */
import { chatTitle, isCurrentChat, type CleoChat } from "@/lib/cleo-chats";

type Db = any;

const CHAT_COLS = "id, title, preview, created_at, last_message_at";
export const MESSAGE_COLS = "id, role, content, created_at, choices, chat_id";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string; choices: string[] | null; chat_id: string | null };

async function getChat(db: Db, userId: string, id: string): Promise<CleoChat | null> {
  const { data, error } = await db.from("summer_chats").select(CHAT_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CleoChat | null) ?? null;
}

/** The chat to show when Cleo opens: the latest one if it's still going (6-hour rule), else none (a fresh chat). */
export async function currentChat(db: Db, userId: string): Promise<CleoChat | null> {
  const { data, error } = await db.from("summer_chats").select(CHAT_COLS).eq("user_id", userId).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data && isCurrentChat(data.last_message_at) ? (data as CleoChat) : null;
}

/** A chat and its messages (the newest 200). `chatId` omitted: the current chat. */
export async function openChat(db: Db, userId: string, chatId?: string | null): Promise<{ chat: CleoChat | null; messages: ChatMessage[] }> {
  const chat = chatId ? await getChat(db, userId, chatId) : await currentChat(db, userId);
  if (chatId && !chat) throw new Error("That chat is gone.");
  if (!chat) return { chat: null, messages: [] };
  const { data, error } = await db.from("summer_messages").select(MESSAGE_COLS).eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return { chat, messages: ((data ?? []) as ChatMessage[]).reverse() };
}

/** The chat a new message goes into: the one asked for (if it's theirs), else a new one named after the message. */
export async function chatFor(db: Db, userId: string, chatId: string | null | undefined, firstMessage: string): Promise<string> {
  if (chatId) {
    const chat = await getChat(db, userId, chatId);
    if (chat) return chat.id;
  }
  const { data, error } = await db.from("summer_chats").insert({ user_id: userId, title: chatTitle(firstMessage) }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** History, newest first. `q` searches titles and everything said in them. */
export async function listChats(db: Db, userId: string, q?: string | null): Promise<CleoChat[]> {
  const term = (q ?? "").trim().replace(/[%_\\]/g, " ").slice(0, 80);
  if (!term) {
    const { data, error } = await db.from("summer_chats").select(CHAT_COLS).eq("user_id", userId).order("last_message_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as CleoChat[];
  }
  const [byTitle, byText] = await Promise.all([
    db.from("summer_chats").select(CHAT_COLS).eq("user_id", userId).ilike("title", `%${term}%`).limit(100),
    db.from("summer_messages").select("chat_id").eq("user_id", userId).not("chat_id", "is", null).ilike("content", `%${term}%`).limit(400),
  ]);
  if (byTitle.error) throw new Error(byTitle.error.message);
  if (byText.error) throw new Error(byText.error.message);
  const found = new Map<string, CleoChat>(((byTitle.data ?? []) as CleoChat[]).map((c) => [c.id, c]));
  const more = [...new Set(((byText.data ?? []) as Array<{ chat_id: string }>).map((m) => m.chat_id))].filter((id) => !found.has(id)).slice(0, 100);
  if (more.length) {
    const { data, error } = await db.from("summer_chats").select(CHAT_COLS).eq("user_id", userId).in("id", more);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as CleoChat[]) found.set(c.id, c);
  }
  return [...found.values()].sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
}

/** Delete one chat (its messages go with it), or every chat when `chatId` is null. */
export async function deleteChats(db: Db, userId: string, chatId: string | null): Promise<void> {
  if (chatId) {
    const { error } = await db.from("summer_chats").delete().eq("id", chatId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  const [chats, loose] = await Promise.all([
    db.from("summer_chats").delete().eq("user_id", userId),
    db.from("summer_messages").delete().eq("user_id", userId),
  ]);
  if (chats.error) throw new Error(chats.error.message);
  if (loose.error) throw new Error(loose.error.message);
}
