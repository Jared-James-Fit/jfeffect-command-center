/**
 * Cleo's answers, written in the background (Nov 24 2026).
 *
 *   start   the question and a 'pending' answer are saved at once (so nothing
 *           typed is ever lost), then the answer is handed to the worker through
 *           pg_net with the asker's own session token (cleo_turn_dispatch): the
 *           database, not the person's phone, holds the request open, so leaving
 *           the page, refreshing or closing the app never stops an answer.
 *   worker  the cleo-turn hook checks the token is the message's owner (and their
 *           two-step), claims the answer ('running'), reads with that login (RLS
 *           decides, exactly as in the app: assertCleo), writes a short progress
 *           line as it looks things up, and fills the answer ('done'), or says
 *           why it failed. Stop is honoured between steps and mid-call.
 *   poll    the app reads the answers it's waiting on; one that never reached the
 *           worker is handed over again with the person's fresh token, one cut
 *           off mid-answer is marked failed (Retry).
 *   after   the first answer names the conversation and its topic (one cheap
 *           call), and once enough has built up the older messages are folded
 *           into the conversation's summary (cleo-memory.ts).
 *
 * Every model call here is on the OpenAI key (never Lovable credits). Server only.
 */
import { createClient } from "@supabase/supabase-js";
import {
  cleanAiTitle,
  isCategory,
  type CleoSection,
} from "@/lib/cleo-chats";
import {
  cleanSummary,
  clipText,
  memoryText,
  PAST_MESSAGE_CHARS,
  parseTitleReply,
  planMemory,
  progressFor,
  summaryPrompt,
  SUMMARY_SYSTEM,
  titlePrompt,
  TITLE_SYSTEM,
  type MemoryMessage,
  type RelatedConversation,
  type WaitingCard,
} from "@/lib/cleo-memory";
import { chatFor, clientName, getChat, MESSAGE_COLS, type ChatMessage } from "@/lib/cleo-chats.server";
import type { CleoAttachment } from "@/lib/cleo-attachments";

type Db = any;

/** A turn nobody picked up after this long is handed over again (the poll does it). */
export const REDISPATCH_AFTER_MS = 25_000;
/** A running answer with no sign of life this long is treated as cut off. */
export const STALE_RUNNING_MS = 4 * 60_000;
/** A pending answer still not picked up after this long fails (Retry sends it again). */
export const GIVE_UP_PENDING_MS = 4 * 60_000;

export type TurnContext = { supabase: Db; userId: string; db: Db; coach: boolean; viewOnly: boolean };

export type StartInput = {
  key: string;
  message: string;
  chatId?: string | null;
  attachments?: CleoAttachment[];
  route?: string | null;
  year?: number | null;
  voice?: boolean;
  clientId?: string | null;
  section?: CleoSection | null;
  /** Edit & resend: the question being replaced (it and everything after are kept, out of view). */
  edit?: string | null;
  /** Regenerate: the answer being replaced. */
  regenerate?: string | null;
};

export type StartResult = { chatId: string; user: ChatMessage | null; assistant: ChatMessage; dispatched: boolean; duplicate?: boolean };

const TURN_COLS = `${MESSAGE_COLS}, turn, attempts, stop_requested_at, superseded_at, user_id`;

function age(iso: string | null | undefined, now = Date.now()): number {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? now - t : Number.POSITIVE_INFINITY;
}

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** A client that reads and writes as the token's owner (RLS decides). */
export function clientForToken(token: string): Db {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase isn't configured.");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** Hand an answer to the worker. False when pg_net couldn't take it (the caller answers inline). */
export async function dispatchTurn(messageId: string, token: string): Promise<boolean> {
  try {
    const { data, error } = await (await admin()).rpc("cleo_turn_dispatch", { _message_id: messageId, _token: token });
    if (error) {
      console.warn("[cleo-turn] dispatch failed", error.message);
      return false;
    }
    return data !== false;
  } catch (e) {
    console.warn("[cleo-turn] dispatch failed", e);
    return false;
  }
}

async function openTurnIn(db: Db, chatId: string): Promise<ChatMessage & { updated_at?: string | null } | null> {
  const { data } = await db
    .from("summer_messages")
    .select("id, status, updated_at")
    .eq("chat_id", chatId)
    .in("status", ["pending", "running"])
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

/** Throws when an answer is still being written in this conversation (one at a time). */
async function assertNoOpenTurn(db: Db, chatId: string): Promise<void> {
  const open = await openTurnIn(db, chatId);
  if (!open) return;
  const limit = open.status === "running" ? STALE_RUNNING_MS : GIVE_UP_PENDING_MS;
  if (age(open.updated_at) > limit) {
    await db.from("summer_messages").update({ status: "failed", error: "Cleo was cut off before answering. Tap Retry.", progress: null }).eq("id", open.id).in("status", ["pending", "running"]);
    return;
  }
  throw new Error("Cleo is still answering in this conversation. Wait for it, or tap Stop first.");
}

/** Everything from `fromIso` on in this conversation is kept but out of view (edit & resend, regenerate). */
async function supersedeFrom(db: Db, chatId: string, fromIso: string): Promise<void> {
  const { error } = await db.from("summer_messages").update({ superseded_at: new Date().toISOString() }).eq("chat_id", chatId).gte("created_at", fromIso).is("superseded_at", null);
  if (error) throw new Error(error.message);
}

async function placeholder(db: Db, userId: string, chatId: string, replyTo: string, afterIso: string, turn: Record<string, unknown>): Promise<ChatMessage> {
  const at = new Date(Math.max(Date.now(), Date.parse(afterIso) + 1)).toISOString();
  const { data, error } = await db
    .from("summer_messages")
    .insert({ user_id: userId, chat_id: chatId, role: "assistant", content: "", status: "pending", reply_to: replyTo, turn, created_at: at })
    .select(MESSAGE_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as ChatMessage;
}

/**
 * Save the question and a pending answer, then hand it to the worker. Idempotent on `key`:
 * the same send twice (a double tap, a retry after a dropped connection) is one question.
 */
export async function startTurn(ctx: TurnContext, input: StartInput, token: string): Promise<StartResult> {
  const { supabase: own, userId } = ctx;
  const turnMeta = {
    key: input.key,
    route: input.route ?? null,
    year: input.year ?? null,
    voice: !!input.voice,
    section: input.section ?? null,
  };

  // the same send again: hand back what it made
  const earlier = async (): Promise<StartResult | null> => {
    const { data: dup } = await own
      .from("summer_messages")
      .select(MESSAGE_COLS)
      .eq("user_id", userId)
      .eq("role", "user")
      .filter("turn->>key", "eq", input.key)
      .limit(1)
      .maybeSingle();
    if (!dup) return null;
    const { data: answer } = await own.from("summer_messages").select(MESSAGE_COLS).eq("reply_to", dup.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return answer ? { chatId: dup.chat_id, user: dup as ChatMessage, assistant: answer as ChatMessage, dispatched: true, duplicate: true } : null;
  };
  if (!input.regenerate) {
    const again = await earlier();
    if (again) return again;
  }

  // Regenerate: the same question, a fresh answer
  if (input.regenerate) {
    const { data: old, error } = await own.from("summer_messages").select("id, chat_id, role, reply_to, created_at, status").eq("id", input.regenerate).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!old || old.role !== "assistant" || !old.chat_id) throw new Error("That answer is gone.");
    if (old.status === "pending" || old.status === "running") throw new Error("Cleo is still answering that.");
    let questionId: string | null = old.reply_to;
    if (!questionId) {
      const { data: q } = await own.from("summer_messages").select("id").eq("chat_id", old.chat_id).eq("role", "user").lt("created_at", old.created_at).is("superseded_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      questionId = q?.id ?? null;
    }
    if (!questionId) throw new Error("There's no question to answer again.");
    await assertNoOpenTurn(own, old.chat_id);
    await supersedeFrom(own, old.chat_id, old.created_at);
    const { data: q } = await own.from("summer_messages").select(MESSAGE_COLS).eq("id", questionId).maybeSingle();
    const assistant = await placeholder(own, userId, old.chat_id, questionId, q?.created_at ?? old.created_at, { ...turnMeta, regenerated: input.regenerate });
    const dispatched = await dispatchTurn(assistant.id, token);
    return { chatId: old.chat_id, user: null, assistant, dispatched };
  }

  const message = input.message.trim();
  const attachments = input.attachments ?? [];
  if (!message && !attachments.length) throw new Error("Type a message or attach something.");
  const files = await import("@/lib/cleo-attachments.server");
  files.assertOwnAttachments(userId, attachments);

  // Edit & resend: the question and everything after it step aside
  let chatId = input.chatId ?? null;
  if (input.edit) {
    const { data: old, error } = await own.from("summer_messages").select("id, chat_id, role, created_at").eq("id", input.edit).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!old || old.role !== "user" || !old.chat_id) throw new Error("That message is gone.");
    chatId = old.chat_id;
    await assertNoOpenTurn(own, old.chat_id);
    await supersedeFrom(own, old.chat_id, old.created_at);
  } else if (chatId) {
    const chat = await getChat(own, userId, chatId);
    if (!chat) chatId = null;
    else await assertNoOpenTurn(own, chatId);
  }

  // A new conversation about a client: only one this login can see.
  let clientId = input.clientId ?? null;
  if (!chatId && clientId) {
    const { data: row } = await ctx.db.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!row) clientId = null;
  }
  if (!chatId) chatId = await chatFor(own, userId, null, message || attachments[0]?.name || "", { clientId, section: input.section ?? null });

  const now = new Date().toISOString();
  const { data: user, error: userErr } = await own
    .from("summer_messages")
    .insert({ user_id: userId, chat_id: chatId, role: "user", content: message, status: "done", turn: { key: input.key }, attachments: attachments.length ? attachments : null, created_at: now })
    .select(MESSAGE_COLS)
    .single();
  if (userErr) {
    // the same key raced in from a second tap: hand back the first once its answer is saved
    if (/duplicate|unique/i.test(userErr.message)) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const again = await earlier();
        if (again) return again;
      }
      throw new Error("That message was already sent.");
    }
    throw new Error(userErr.message);
  }
  if (attachments.length) await files.linkAttachments(userId, user.id, attachments);
  const assistant = await placeholder(own, userId, chatId!, user.id, now, turnMeta);
  const dispatched = await dispatchTurn(assistant.id, token);
  const [shown] = attachments.length ? await files.withAttachmentUrls([user as ChatMessage]) : [user as ChatMessage];
  return { chatId: chatId!, user: shown, assistant, dispatched };
}

/** Stop an answer: it's marked stopped at once; the worker drops whatever it was writing. */
export async function stopTurn(own: Db, userId: string, messageId: string): Promise<ChatMessage | null> {
  const { data, error } = await own
    .from("summer_messages")
    .update({ status: "stopped", stop_requested_at: new Date().toISOString(), progress: null })
    .eq("id", messageId)
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .select(MESSAGE_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ChatMessage | null) ?? null;
}

/**
 * The answers the app is waiting on. One the worker never picked up is handed over again
 * (with this request's token); one cut off mid-answer is marked failed.
 */
export async function pollTurns(own: Db, userId: string, ids: string[], token: string | null): Promise<ChatMessage[]> {
  if (!ids.length) return [];
  const { data, error } = await own.from("summer_messages").select(`${MESSAGE_COLS}, attempts, created_at`).eq("user_id", userId).in("id", ids.slice(0, 20));
  if (error) throw new Error(error.message);
  const out: ChatMessage[] = [];
  for (const row of (data ?? []) as Array<ChatMessage & { attempts?: number }>) {
    let r: ChatMessage = row;
    if (row.status === "pending" && age(row.updated_at) > REDISPATCH_AFTER_MS) {
      if (age(row.created_at) > GIVE_UP_PENDING_MS || (row.attempts ?? 0) >= 3 || !token) {
        const { data: failed } = await own.from("summer_messages").update({ status: "failed", error: "Cleo couldn't start on that. Tap Retry.", progress: null }).eq("id", row.id).eq("status", "pending").select(MESSAGE_COLS).maybeSingle();
        if (failed) r = failed as ChatMessage;
      } else {
        // touch it first so another poll doesn't hand it over twice
        const { data: touched } = await own.from("summer_messages").update({ progress: "Starting…" }).eq("id", row.id).eq("status", "pending").lt("updated_at", new Date(Date.now() - REDISPATCH_AFTER_MS).toISOString()).select("id").maybeSingle();
        if (touched) await dispatchTurn(row.id, token);
      }
    } else if (row.status === "running" && age(row.updated_at) > STALE_RUNNING_MS) {
      const { data: failed } = await own.from("summer_messages").update({ status: "failed", error: "Cleo was cut off before finishing. Tap Retry.", progress: null }).eq("id", row.id).eq("status", "running").select(MESSAGE_COLS).maybeSingle();
      if (failed) r = failed as ChatMessage;
    }
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The worker.

const briefCache = new Map<string, { at: number; text: string }>();
const BRIEF_TTL_MS = 10 * 60_000;

/** The shared client intelligence for a client's conversation (cached a few minutes per server instance). */
async function clientBrief(own: Db, userId: string, clientId: string, section: CleoSection | null): Promise<string | null> {
  const focus = section === "nutrition" ? "nutrition" : section === "cardio" ? "cardio" : "training";
  const key = `${userId}:${clientId}:${focus}`;
  const hit = briefCache.get(key);
  if (hit && Date.now() - hit.at < BRIEF_TTL_MS) return hit.text;
  const { staffCanReachClient } = await import("@/lib/staff-client-access.server");
  if (!(await staffCanReachClient(own, userId, clientId))) return null;
  const sb = await admin();
  const work = (async () => {
    const [{ loadWeightManagement }, { clientIntelText }] = await Promise.all([import("@/lib/weight-management/load.server"), import("@/lib/client-intel/brief.server")]);
    const loaded = await loadWeightManagement(sb, clientId);
    // the coach's own conversation (Cleo drafts in his voice here): the relationship as tone-only context
    return clientIntelText(sb, { clientId, loaded, relationship: true }, focus);
  })();
  const text = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 8_000))]).catch(() => null);
  if (text) {
    briefCache.set(key, { at: Date.now(), text });
    if (briefCache.size > 200) briefCache.delete(briefCache.keys().next().value as string);
  }
  return text;
}

type ChatRow = {
  id: string;
  title: string;
  client_id: string | null;
  category: string | null;
  summary: string | null;
  summary_through: string | null;
  summary_count: number | null;
  title_source: string | null;
};

async function loadMemory(own: Db, db: Db, userId: string, chat: ChatRow, question: ChatMessage, section: CleoSection | null, staff: boolean) {
  let q = own
    .from("summer_messages")
    .select("id, role, content, created_at, status, superseded_at, attachments")
    .eq("chat_id", chat.id)
    .lt("created_at", question.created_at)
    .is("superseded_at", null);
  if (chat.summary_through) q = q.gt("created_at", chat.summary_through);
  const { data: rows } = await q.order("created_at", { ascending: false }).limit(60);
  const since = ((rows ?? []) as Array<MemoryMessage & { attachments?: CleoAttachment[] | null }>).reverse();
  const { recent, fold } = planMemory(since);

  const name = chat.client_id ? await clientName(db, chat.client_id) : null;
  const client = chat.client_id ? { id: chat.client_id, name: name ?? "this client" } : null;

  const [related, waiting, brief] = await Promise.all([
    (async (): Promise<RelatedConversation[]> => {
      if (!chat.client_id) return [];
      const { data } = await own
        .from("summer_chats")
        .select("title, last_message_at, summary, preview")
        .eq("user_id", userId)
        .eq("client_id", chat.client_id)
        .neq("id", chat.id)
        .order("last_message_at", { ascending: false })
        .limit(3);
      return (data ?? []) as RelatedConversation[];
    })().catch(() => []),
    (async (): Promise<WaitingCard[]> => {
      const { data: answers } = await own.from("summer_messages").select("id").eq("chat_id", chat.id).eq("role", "assistant").order("created_at", { ascending: false }).limit(200);
      const ids = ((answers ?? []) as Array<{ id: string }>).map((a) => a.id);
      if (!ids.length) return [];
      const { data } = await own.from("cleo_actions").select("summary, status, created_at").eq("requested_by", userId).in("message_id", ids).in("status", ["proposed", "awaiting_approval", "running"]);
      return ((data ?? []) as Array<WaitingCard & { created_at: string }>).filter((a) => a.status !== "proposed" || age(a.created_at) < 86_400_000);
    })().catch(() => []),
    chat.client_id && staff ? clientBrief(own, userId, chat.client_id, section).catch(() => null) : Promise.resolve(null),
  ]);

  const memory = memoryText({
    client,
    category: isCategory(chat.category) ? chat.category : null,
    section,
    summary: chat.summary,
    related,
    waiting,
    clientBrief: brief,
  });
  const history = recent.map((m) => ({ role: m.role, content: clipText(m.content, PAST_MESSAGE_CHARS), attachments: (m as any).attachments ?? null }));
  return { memory, history, fold, client };
}

/** Look back through earlier conversations (this client's only, in a client's conversation). */
function pastConversationsTool(own: Db, userId: string, chat: ChatRow, tool: any, z: any) {
  return tool({
    description:
      "Search this person's earlier conversations with you (titles, summaries and what was said) when something from before matters: a decision, a number, what was agreed. In a client's conversation it only searches that client's conversations. Returns a few conversations with their summary and the lines that matched.",
    inputSchema: z.object({ query: z.string().trim().min(2).max(80).describe("A few words to look for (a lift, a number, a topic).") }),
    execute: async ({ query }: { query: string }) => {
      try {
        const term = query.replace(/[%_\\]/g, " ").trim();
        let chats = own.from("summer_chats").select("id, title, last_message_at, summary").eq("user_id", userId).neq("id", chat.id);
        if (chat.client_id) chats = chats.eq("client_id", chat.client_id);
        const [{ data: byTitle }, { data: lines }] = await Promise.all([
          chats.or(`title.ilike.%${term}%,summary.ilike.%${term}%`).order("last_message_at", { ascending: false }).limit(5),
          own.from("summer_messages").select("chat_id, role, content, created_at").eq("user_id", userId).neq("chat_id", chat.id).is("superseded_at", null).ilike("content", `%${term}%`).order("created_at", { ascending: false }).limit(30),
        ]);
        let hits = (lines ?? []) as Array<{ chat_id: string; role: string; content: string; created_at: string }>;
        let allowed: Set<string> | null = null;
        if (chat.client_id) {
          const ids = [...new Set(hits.map((h) => h.chat_id))];
          if (ids.length) {
            const { data: own2 } = await own.from("summer_chats").select("id").eq("client_id", chat.client_id).in("id", ids);
            allowed = new Set(((own2 ?? []) as Array<{ id: string }>).map((c) => c.id));
            hits = hits.filter((h) => allowed!.has(h.chat_id));
          }
        }
        const byChat = new Map<string, string[]>();
        for (const h of hits) {
          const i = h.content.toLowerCase().indexOf(term.toLowerCase());
          const snippet = h.content.slice(Math.max(0, i - 160), i + 240).replace(/\s+/g, " ");
          const list = byChat.get(h.chat_id) ?? [];
          if (list.length < 3) list.push(`${h.role === "user" ? "Coach" : "Cleo"} (${h.created_at.slice(0, 10)}): …${snippet}…`);
          byChat.set(h.chat_id, list);
        }
        const titles = new Map(((byTitle ?? []) as Array<{ id: string; title: string; last_message_at: string; summary: string | null }>).map((c) => [c.id, c]));
        const missing = [...byChat.keys()].filter((id) => !titles.has(id)).slice(0, 5);
        if (missing.length) {
          const { data } = await own.from("summer_chats").select("id, title, last_message_at, summary").in("id", missing);
          for (const c of (data ?? []) as any[]) titles.set(c.id, c);
        }
        const out = [...titles.values()].slice(0, 5).map((c) =>
          [`"${c.title}" (last active ${c.last_message_at.slice(0, 10)})`, c.summary ? `Summary: ${clipText(c.summary, 900)}` : "", ...(byChat.get(c.id) ?? [])].filter(Boolean).join("\n"),
        );
        return out.length ? out.join("\n\n") : `Nothing in earlier conversations matches "${query}".`;
      } catch (e: any) {
        return `Couldn't search earlier conversations (${String(e?.message ?? e).slice(0, 120)}).`;
      }
    },
  });
}

/** Name the conversation and say what it's about, once, after its first answer. Best effort. */
async function nameConversation(own: Db, db: Db, chat: ChatRow, question: string, answer: string, clientLabel: string | null) {
  if (chat.title_source && chat.title_source !== "question") return;
  try {
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const reply = await askRoute("coach_write", { system: TITLE_SYSTEM, prompt: titlePrompt(question, answer, clientLabel), timeoutMs: 20_000, tag: "cleo_title" }, { sb: db, openaiOnly: true });
    const { title, category } = parseTitleReply(reply.text);
    const patch: Record<string, unknown> = {};
    const clean = cleanAiTitle(title);
    if (clean) {
      patch.title = clean;
      patch.title_source = "auto";
    }
    if (isCategory(category)) patch.category = category;
    if (Object.keys(patch).length) await own.from("summer_chats").update(patch).eq("id", chat.id).eq("title_source", "question");
  } catch (e) {
    console.warn("[cleo-turn] naming failed", e);
  }
}

/** Fold the older messages into the conversation's summary. Best effort; the full messages are always kept. */
async function foldSummary(own: Db, db: Db, chat: ChatRow, fold: MemoryMessage[], clientLabel: string | null) {
  if (!fold.length) return;
  try {
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const reply = await askRoute("coach_write", { system: SUMMARY_SYSTEM, prompt: summaryPrompt(chat.summary, fold, clientLabel), timeoutMs: 45_000, tag: "cleo_memory" }, { sb: db, openaiOnly: true });
    const summary = cleanSummary(reply.text);
    if (!summary) return;
    let q = own.from("summer_chats").update({ summary, summary_through: fold[fold.length - 1].created_at, summary_count: (chat.summary_count ?? 0) + fold.length }).eq("id", chat.id);
    q = chat.summary_through ? q.eq("summary_through", chat.summary_through) : q.is("summary_through", null);
    await q;
  } catch (e) {
    console.warn("[cleo-turn] summary failed", e);
  }
}

function friendlyError(e: any): string {
  const m = String(e?.message ?? e ?? "").trim();
  if (!m) return "Cleo couldn't answer that. Tap Retry.";
  if (/out of credit|insufficient_quota/i.test(m)) return "The OpenAI account behind Cleo is out of credit. Add credit at platform.openai.com, then tap Retry.";
  return m.length > 300 ? `${m.slice(0, 297)}…` : m;
}

/**
 * Write one answer, as the token's owner. Returns what happened (for the hook's log).
 * Never throws for an answer that failed: the answer says so.
 */
export async function runTurn(messageId: string, token: string): Promise<{ ok: boolean; status: string; reason?: string }> {
  const own = clientForToken(token);
  const { data: claims, error: claimErr } = await own.auth.getClaims(token);
  const userId = claims?.claims?.sub as string | undefined;
  if (claimErr || !userId) return { ok: false, status: "refused", reason: "bad token" };
  try {
    const { checkStaffMfa } = await import("@/lib/mfa-guard.server");
    await checkStaffMfa(`Bearer ${token}`);
  } catch (e: any) {
    await own.from("summer_messages").update({ status: "failed", error: "Confirm your sign-in (two-step) and tap Retry.", progress: null }).eq("id", messageId).eq("user_id", userId).in("status", ["pending", "running"]);
    return { ok: false, status: "refused", reason: "two-step" };
  }

  const { data: row, error: rowErr } = await own.from("summer_messages").select(TURN_COLS).eq("id", messageId).maybeSingle();
  if (rowErr || !row || row.user_id !== userId || row.role !== "assistant") return { ok: false, status: "refused", reason: "not theirs" };
  if (row.status !== "pending") return { ok: true, status: row.status, reason: "already handled" };

  // claim it: one worker per answer
  const { data: claimed } = await own
    .from("summer_messages")
    .update({ status: "running", started_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, progress: "Thinking…", error: null })
    .eq("id", messageId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true, status: "taken" };

  const fail = async (msg: string) => {
    await own.from("summer_messages").update({ status: "failed", error: msg, progress: null }).eq("id", messageId).eq("status", "running");
  };

  let cleo: { db: Db; viewOnly: boolean; coach: boolean };
  try {
    const { assertCleo } = await import("@/lib/cleo-access.server");
    cleo = await assertCleo({ supabase: own, userId, claims: claims!.claims } as any);
  } catch (e: any) {
    await fail(friendlyError(e));
    return { ok: false, status: "failed", reason: "no Cleo" };
  }

  const turn = (row.turn ?? {}) as { route?: string | null; year?: number | null; voice?: boolean; section?: CleoSection | null };
  const { data: chat } = await own.from("summer_chats").select("id, title, client_id, category, summary, summary_through, summary_count, title_source").eq("id", row.chat_id).maybeSingle();
  if (!chat) {
    await fail("That conversation is gone.");
    return { ok: false, status: "failed", reason: "no chat" };
  }
  // A client's conversation sends their records to OpenAI: only with their permission (5.1.2(i),
  // src/lib/ai-consent). Refused, the answer says why and nothing reaches the model.
  if (chat.client_id) {
    const [{ clientAllowsAi }, { coachConsentMessage }] = await Promise.all([import("@/lib/ai-consent/consent.server"), import("@/lib/ai-consent/consent")]);
    const consent = await clientAllowsAi(chat.client_id);
    if (!consent.ok) {
      await fail(coachConsentMessage(consent.name));
      return { ok: false, status: "failed", reason: "no AI consent" };
    }
  }
  let questionRow: ChatMessage | null = null;
  if (row.reply_to) {
    const { data } = await own.from("summer_messages").select(`${MESSAGE_COLS}`).eq("id", row.reply_to).maybeSingle();
    questionRow = (data as ChatMessage) ?? null;
  }
  if (!questionRow) {
    await fail("The question for this answer is gone.");
    return { ok: false, status: "failed", reason: "no question" };
  }

  // Stop: the row says so (checked every couple of seconds), and it doubles as a heartbeat.
  const controller = new AbortController();
  let lastProgress = "Thinking…";
  let beat = Date.now();
  const watch = setInterval(async () => {
    try {
      const { data } = await own.from("summer_messages").select("status, stop_requested_at").eq("id", messageId).maybeSingle();
      if (!data || data.status !== "running" || data.stop_requested_at) controller.abort();
      else if (Date.now() - beat > 30_000) {
        beat = Date.now();
        await own.from("summer_messages").update({ progress: lastProgress }).eq("id", messageId).eq("status", "running");
      }
    } catch {
      // the next check
    }
  }, 2_000);

  const staff = !cleo.viewOnly;
  try {
    const mem = await loadMemory(own, cleo.db, userId, chat as ChatRow, questionRow, turn.section ?? null, staff);
    const [{ cleoAnswer }, { tool }, { z }] = await Promise.all([import("@/lib/summer.server"), import("ai"), import("zod")]);
    const tools = { past_conversations: pastConversationsTool(own, userId, chat as ChatRow, tool, z) };
    const res = await cleoAnswer(
      cleo.db,
      userId,
      {
        message: questionRow.content,
        year: turn.year ?? undefined,
        route: turn.route ?? undefined,
        voice: !!turn.voice,
        finance: cleo.viewOnly,
        coach: cleo.coach,
        own,
        chatId: chat.id,
        attachments: (questionRow.attachments ?? []) as CleoAttachment[],
      },
      {
        history: mem.history,
        memory: mem.memory,
        signal: controller.signal,
        scopeClient: mem.client,
        extraTools: tools,
        onStep: (names) => {
          const next = progressFor(names.filter(Boolean));
          if (next === lastProgress) return;
          lastProgress = next;
          beat = Date.now();
          void own.from("summer_messages").update({ progress: next }).eq("id", messageId).eq("status", "running");
        },
      },
    );
    clearInterval(watch);

    const { data: done } = await own
      .from("summer_messages")
      .update({ content: res.text, status: "done", choices: res.choices && !res.proposed.length ? res.choices : null, progress: null, error: null })
      .eq("id", messageId)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    const { attachToMessage, discardProposals } = await import("@/lib/cleo-actions.server");
    if (!done) {
      // stopped while it was being written: nothing it set up stays
      await discardProposals(userId, res.proposed);
      return { ok: true, status: "stopped" };
    }
    if (res.proposed.length) await attachToMessage(userId, res.proposed, messageId);
    if (res.read?.saved.length) {
      // what was read from the files stays on the question (follow-ups use it)
      await own.from("summer_messages").update({ attachments: res.read.saved }).eq("id", questionRow.id);
    }

    // after the answer is on screen: a name for a new conversation, and the summary when it's due
    const firstAnswer = !chat.summary_through && mem.history.length === 0;
    await Promise.all([
      firstAnswer ? nameConversation(own, cleo.db, chat as ChatRow, questionRow.content || "(attachments)", res.text, mem.client?.name ?? null) : Promise.resolve(),
      foldSummary(own, cleo.db, chat as ChatRow, mem.fold, mem.client?.name ?? null),
    ]);
    return { ok: true, status: "done" };
  } catch (e: any) {
    clearInterval(watch);
    if (e?.name === "CleoStopped" || controller.signal.aborted) {
      await own.from("summer_messages").update({ status: "stopped", progress: null }).eq("id", messageId).eq("status", "running");
      return { ok: true, status: "stopped" };
    }
    console.error("[cleo-turn] failed", e);
    await fail(friendlyError(e));
    return { ok: false, status: "failed", reason: String(e?.message ?? e).slice(0, 200) };
  }
}
