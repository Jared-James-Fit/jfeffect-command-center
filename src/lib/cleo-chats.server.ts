/**
 * Cleo's conversations on the server. Everything goes through the caller's own
 * client (RLS: each person only ever sees their own conversations; a client's
 * name only when their login can read that client).
 *
 * Nov 24 2026: a conversation is permanent until its owner deletes it. Opening
 * Cleo restores the most recent active conversation for where they are (that
 * client's, or the general one); archived ones stay searchable and resumable,
 * and a question sent in one brings it back (summer_chat_touch).
 */
import { chatTitle, guessCategory, type ChatFilters, type CleoCategory, type CleoChat, type CleoSection } from "@/lib/cleo-chats";
import { attachmentPaths, type CleoAttachment } from "@/lib/cleo-attachments";

type Db = any;

export const CHAT_COLS = "id, title, preview, created_at, last_message_at, client_id, category, pinned_at, archived_at, archived_by, title_source";
/** Before the Nov 24 2026 migration: the columns every database has. */
const OLD_CHAT_COLS = "id, title, preview, created_at, last_message_at";
export const MESSAGE_COLS = "id, role, content, created_at, choices, chat_id, attachments, status, progress, error, reply_to, updated_at";
const OLD_MESSAGE_COLS = "id, role, content, created_at, choices, chat_id, attachments";
/** Messages shown when a conversation opens; older ones load as they scroll up. */
export const PAGE_MESSAGES = 60;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  choices: string[] | null;
  chat_id: string | null;
  attachments?: CleoAttachment[] | null;
  status?: "pending" | "running" | "done" | "failed" | "stopped";
  progress?: string | null;
  error?: string | null;
  reply_to?: string | null;
  updated_at?: string | null;
};

/** A column the database doesn't have yet (the app shipped before its migration). */
export function missingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

async function clientNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < want.length; i += 150) {
    const { data } = await db.from("clients").select("id, full_name, preferred_name, first_name, last_name").in("id", want.slice(i, i + 150));
    for (const c of (data ?? []) as any[]) {
      const name = (c.full_name ?? "").trim() || `${c.preferred_name || c.first_name || ""} ${c.last_name ?? ""}`.trim();
      if (name) out.set(c.id, name);
    }
  }
  return out;
}

export async function clientName(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await clientNames(db, [id])).get(id) ?? null;
}

async function withNames(db: Db, chats: CleoChat[]): Promise<CleoChat[]> {
  const names = await clientNames(db, chats.map((c) => c.client_id ?? "").filter(Boolean));
  return chats.map((c) => ({ ...c, client_name: c.client_id ? names.get(c.client_id) ?? null : null }));
}

/** Answers still being written and cards still waiting, per conversation. */
async function pendingCounts(db: Db, userId: string, chatIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!chatIds.length) return out;
  try {
    const [turns, cards] = await Promise.all([
      db.from("summer_messages").select("chat_id").eq("user_id", userId).in("chat_id", chatIds.slice(0, 300)).in("status", ["pending", "running"]),
      db
        .from("cleo_actions")
        .select("message_id, status, created_at")
        .eq("requested_by", userId)
        .in("status", ["proposed", "awaiting_approval", "running"])
        .not("message_id", "is", null)
        .gte("created_at", new Date(Date.now() - 45 * 86_400_000).toISOString())
        .limit(300),
    ]);
    for (const t of (turns.data ?? []) as Array<{ chat_id: string }>) out.set(t.chat_id, (out.get(t.chat_id) ?? 0) + 1);
    const live = ((cards.data ?? []) as Array<{ message_id: string; status: string; created_at: string }>).filter(
      (a) => a.status !== "proposed" || Date.now() - Date.parse(a.created_at) < 86_400_000,
    );
    if (live.length) {
      const { data: msgs } = await db.from("summer_messages").select("id, chat_id").in("id", live.map((a) => a.message_id));
      for (const m of (msgs ?? []) as Array<{ id: string; chat_id: string | null }>) if (m.chat_id) out.set(m.chat_id, (out.get(m.chat_id) ?? 0) + 1);
    }
  } catch {
    // a badge, not the list
  }
  return out;
}

export async function getChat(db: Db, userId: string, id: string): Promise<CleoChat | null> {
  let { data, error } = await db.from("summer_chats").select(CHAT_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error && missingColumn(error)) ({ data, error } = await db.from("summer_chats").select(OLD_CHAT_COLS).eq("id", id).eq("user_id", userId).maybeSingle());
  if (error) throw new Error(error.message);
  return (data as CleoChat | null) ?? null;
}

/**
 * The conversation Cleo opens on for a place: the most recent active one about
 * this client (or, with no client, the most recent general one). Null: none yet.
 */
export async function currentChat(db: Db, userId: string, clientId: string | null = null): Promise<CleoChat | null> {
  let q = db.from("summer_chats").select(CHAT_COLS).eq("user_id", userId).is("archived_at", null);
  q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
  let { data, error } = await q.order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (error && missingColumn(error)) {
    if (clientId) return null;
    ({ data, error } = await db.from("summer_chats").select(OLD_CHAT_COLS).eq("user_id", userId).order("last_message_at", { ascending: false }).limit(1).maybeSingle());
  }
  if (error) throw new Error(error.message);
  return (data as CleoChat | null) ?? null;
}

async function readMessages(db: Db, chatId: string, before: string | null, limit: number): Promise<{ rows: ChatMessage[]; more: boolean }> {
  const build = (cols: string, modern: boolean) => {
    let q = db.from("summer_messages").select(cols).eq("chat_id", chatId);
    if (modern) q = q.is("superseded_at", null);
    if (before) q = q.lt("created_at", before);
    return q.order("created_at", { ascending: false }).limit(limit + 1);
  };
  let { data, error } = await build(MESSAGE_COLS, true);
  if (error && missingColumn(error)) ({ data, error } = await build(OLD_MESSAGE_COLS, false));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ChatMessage[];
  return { rows: rows.slice(0, limit).reverse(), more: rows.length > limit };
}

/**
 * A conversation and its latest messages. `chatId`: that one (it must be theirs).
 * Else the current one for `clientId` (general when null); none yet is an empty conversation.
 */
export async function openChat(
  db: Db,
  userId: string,
  chatId?: string | null,
  clientId: string | null = null,
): Promise<{ chat: CleoChat | null; messages: ChatMessage[]; hasOlder: boolean; client: { id: string; name: string } | null }> {
  const chat = chatId ? await getChat(db, userId, chatId) : await currentChat(db, userId, clientId);
  if (chatId && !chat) throw new Error("That conversation is gone.");
  const forClient = chat?.client_id ?? (chatId ? null : clientId);
  const name = forClient ? await clientName(db, forClient) : null;
  const client = forClient ? { id: forClient, name: name ?? "This client" } : null;
  if (!chat) return { chat: null, messages: [], hasOlder: false, client };
  const { rows, more } = await readMessages(db, chat.id, null, PAGE_MESSAGES);
  const { withAttachmentUrls } = await import("@/lib/cleo-attachments.server");
  return { chat: { ...chat, client_name: name }, messages: await withAttachmentUrls(rows), hasOlder: more, client };
}

/** Older messages, as they scroll up. */
export async function olderMessages(db: Db, userId: string, chatId: string, before: string): Promise<{ messages: ChatMessage[]; hasOlder: boolean }> {
  const chat = await getChat(db, userId, chatId);
  if (!chat) throw new Error("That conversation is gone.");
  const { rows, more } = await readMessages(db, chatId, before, 40);
  const { withAttachmentUrls } = await import("@/lib/cleo-attachments.server");
  return { messages: await withAttachmentUrls(rows), hasOlder: more };
}

/** The chat a new message goes into: the one asked for (if it's theirs), else a new one named after the message. */
export async function chatFor(
  db: Db,
  userId: string,
  chatId: string | null | undefined,
  firstMessage: string,
  meta: { clientId?: string | null; section?: CleoSection | null } = {},
): Promise<string> {
  if (chatId) {
    const chat = await getChat(db, userId, chatId);
    if (chat) return chat.id;
  }
  const category: CleoCategory = guessCategory(firstMessage, meta.section ?? null);
  const row: Record<string, unknown> = { user_id: userId, title: chatTitle(firstMessage), category, client_id: meta.clientId ?? null };
  let { data, error } = await db.from("summer_chats").insert(row).select("id").single();
  if (error && missingColumn(error)) ({ data, error } = await db.from("summer_chats").insert({ user_id: userId, title: chatTitle(firstMessage) }).select("id").single());
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** History (or the archive), most recently active first, filtered. `q` searches titles and everything said. */
export async function listChats(db: Db, userId: string, f: ChatFilters & { tz?: string } = {}): Promise<CleoChat[]> {
  const term = (f.q ?? "").trim().replace(/[%_\\]/g, " ").slice(0, 80);
  const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toISOString();
  const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString();
  // dates are the person's days: widened by a day each side on the server, then trimmed by their zone below
  const filter = (q: any) => {
    q = q.eq("user_id", userId);
    q = f.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    if (f.clientId) q = q.eq("client_id", f.clientId);
    else if (f.general) q = q.is("client_id", null);
    if (f.category) q = q.eq("category", f.category);
    if (f.from) q = q.gte("last_message_at", new Date(Date.parse(dayStart(f.from)) - 86_400_000).toISOString());
    if (f.to) q = q.lt("last_message_at", new Date(Date.parse(nextDay(f.to)) + 86_400_000).toISOString());
    return q;
  };
  let chats: CleoChat[];
  if (!term) {
    const { data, error } = await filter(db.from("summer_chats").select(CHAT_COLS)).order("last_message_at", { ascending: false }).limit(400);
    if (error && missingColumn(error)) return legacyList(db, userId, f);
    if (error) throw new Error(error.message);
    chats = (data ?? []) as CleoChat[];
  } else {
    const [byTitle, byText] = await Promise.all([
      filter(db.from("summer_chats").select(CHAT_COLS)).ilike("title", `%${term}%`).limit(150),
      db.from("summer_messages").select("chat_id").eq("user_id", userId).not("chat_id", "is", null).is("superseded_at", null).ilike("content", `%${term}%`).limit(500),
    ]);
    if (byTitle.error && missingColumn(byTitle.error)) return legacyList(db, userId, f);
    if (byTitle.error) throw new Error(byTitle.error.message);
    if (byText.error) throw new Error(byText.error.message);
    const found = new Map<string, CleoChat>(((byTitle.data ?? []) as CleoChat[]).map((c) => [c.id, c]));
    const more = [...new Set(((byText.data ?? []) as Array<{ chat_id: string }>).map((m) => m.chat_id))].filter((id) => !found.has(id)).slice(0, 150);
    if (more.length) {
      const { data, error } = await filter(db.from("summer_chats").select(CHAT_COLS)).in("id", more);
      if (error) throw new Error(error.message);
      for (const c of (data ?? []) as CleoChat[]) found.set(c.id, c);
    }
    chats = [...found.values()];
  }
  if (f.from || f.to) {
    const tz = f.tz || "America/Winnipeg";
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
    chats = chats.filter((c) => (!f.from || day(c.last_message_at) >= f.from) && (!f.to || day(c.last_message_at) <= f.to));
  }
  chats.sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
  const [named, pending] = await Promise.all([withNames(db, chats), pendingCounts(db, userId, chats.map((c) => c.id))]);
  return named.map((c) => ({ ...c, pending: pending.get(c.id) ?? 0 }));
}

async function legacyList(db: Db, userId: string, f: ChatFilters): Promise<CleoChat[]> {
  if (f.archived || f.clientId || f.category) return [];
  const { data, error } = await db.from("summer_chats").select(OLD_CHAT_COLS).eq("user_id", userId).order("last_message_at", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as CleoChat[];
}

/** The clients someone has conversations about (the History filter's list). */
export async function chatClients(db: Db, userId: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await db.from("summer_chats").select("client_id").eq("user_id", userId).not("client_id", "is", null).limit(1000);
  if (error) return [];
  const ids = [...new Set(((data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id))];
  const names = await clientNames(db, ids);
  return ids.map((id) => ({ id, name: names.get(id) ?? "A client" })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Pin, rename, archive or bring back one conversation. */
export async function updateChat(
  db: Db,
  userId: string,
  chatId: string,
  patch: { pinned?: boolean; archived?: boolean; title?: string },
): Promise<CleoChat> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.pinned !== undefined) row.pinned_at = patch.pinned ? new Date().toISOString() : null;
  if (patch.archived !== undefined) {
    row.archived_at = patch.archived ? new Date().toISOString() : null;
    row.archived_by = patch.archived ? "person" : null;
    // a pinned conversation that's archived isn't pinned any more
    if (patch.archived) row.pinned_at = null;
  }
  if (patch.title !== undefined) {
    const t = patch.title.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!t) throw new Error("Give it a name.");
    row.title = t;
    row.title_source = "person";
  }
  const { data, error } = await db.from("summer_chats").update(row).eq("id", chatId).eq("user_id", userId).select(CHAT_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That conversation is gone.");
  return data as CleoChat;
}

/** Delete one chat (its messages go with it), or every chat when `chatId` is null. */
export async function deleteChats(db: Db, userId: string, chatId: string | null): Promise<void> {
  // The chat's attached files go with it.
  let q = db.from("summer_messages").select("attachments").eq("user_id", userId).not("attachments", "is", null);
  if (chatId) q = q.eq("chat_id", chatId);
  const { data: withFiles } = await q.limit(2000);
  const paths = ((withFiles ?? []) as Array<{ attachments: CleoAttachment[] | null }>).flatMap((m) => (m.attachments ?? []).flatMap(attachmentPaths)).filter((p) => p.startsWith(`${userId}/`));
  await deleteChatRows(db, userId, chatId);
  // Only once the chat is gone (the daily sweep catches anything missed).
  if (paths.length) {
    const { removeAttachmentFiles } = await import("@/lib/cleo-attachments.server");
    await removeAttachmentFiles(paths).catch((e) => console.warn("[cleo] attachment cleanup failed", e));
  }
}

async function deleteChatRows(db: Db, userId: string, chatId: string | null): Promise<void> {
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

/** How long before a quiet conversation is archived (0 = never). */
export async function archiveSetting(db: Db, userId: string): Promise<number> {
  const { data, error } = await db.from("summer_profiles").select("archive_after_days").eq("user_id", userId).maybeSingle();
  if (error) return 30;
  return typeof data?.archive_after_days === "number" ? data.archive_after_days : 30;
}

export async function saveArchiveSetting(db: Db, userId: string, days: number): Promise<void> {
  const { data: existing } = await db.from("summer_profiles").select("user_id").eq("user_id", userId).maybeSingle();
  const { error } = existing
    ? await db.from("summer_profiles").update({ archive_after_days: days, updated_at: new Date().toISOString() }).eq("user_id", userId)
    : await db.from("summer_profiles").insert({ user_id: userId, archive_after_days: days });
  if (error) throw new Error(error.message);
}
