/**
 * Cleo's conversations, from the app (Nov 24 2026): open the conversation for
 * where the coach is, page back through it, ask (a background answer), follow
 * the answers being written, stop, edit & resend, regenerate, and keep History
 * tidy (search, filters, pin, rename, archive, delete). Whoever has Cleo (the
 * admin; the finance login or a coach while switched on: assertCleo), each only
 * ever their own conversations (RLS).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCleo } from "@/lib/cleo-access.server";
import { AttachmentsInput } from "@/lib/cleo-attachments";
import { ARCHIVE_DAY_CHOICES, CLEO_CATEGORIES, CLEO_SECTIONS } from "@/lib/cleo-chats";

const Id = z.string().uuid();
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function bearer(): string | null {
  try {
    const h = getRequest()?.headers?.get("authorization") ?? "";
    return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
  } catch {
    return null;
  }
}

/** The conversation for where they are (a client's, else the general one), or one by id. */
export const openCleoConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ chatId: Id.nullish(), clientId: Id.nullish(), blockId: Id.nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { db } = await assertCleo(context as any);
    const own = (context as any).supabase;
    let clientId = data.clientId ?? null;
    // the block editor: the block's client, read with their own login (none when they can't see it)
    if (!clientId && data.blockId) {
      const { data: block } = await db.from("pl_blocks").select("client_id").eq("id", data.blockId).maybeSingle();
      clientId = (block?.client_id as string | null) ?? null;
    }
    if (clientId) {
      const { data: row } = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
      if (!row) clientId = null;
    }
    const { openChat } = await import("@/lib/cleo-chats.server");
    return openChat(own, userId, data.chatId ?? null, clientId);
  });

export const loadOlderCleoMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ chatId: Id, before: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { olderMessages } = await import("@/lib/cleo-chats.server");
    return olderMessages((context as any).supabase, userId, data.chatId, data.before);
  });

const Filters = z.object({
  q: z.string().max(120).nullish(),
  clientId: Id.nullish(),
  general: z.boolean().optional(),
  category: z.enum(CLEO_CATEGORIES).nullish(),
  from: Ymd.nullish(),
  to: Ymd.nullish(),
  archived: z.boolean().optional(),
  tz: z.string().max(64).optional(),
});

/** History or the archive, filtered; `q` searches titles and everything said. */
export const listCleoConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Filters.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { listChats } = await import("@/lib/cleo-chats.server");
    return listChats((context as any).supabase, userId, data);
  });

/** The clients someone has conversations about (History's filter). */
export const cleoConversationClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const { db } = await assertCleo(context as any);
    const { chatClients } = await import("@/lib/cleo-chats.server");
    const list = await chatClients((context as any).supabase, userId);
    // names read with what Cleo reads with (the finance login's admin view)
    if (list.some((c) => c.name === "A client")) {
      const { data: rows } = await db.from("clients").select("id, full_name").in("id", list.map((c) => c.id));
      const names = new Map(((rows ?? []) as Array<{ id: string; full_name: string | null }>).map((r) => [r.id, r.full_name ?? ""]));
      return list.map((c) => ({ ...c, name: names.get(c.id)?.trim() || c.name }));
    }
    return list;
  });

/** Pin or unpin, rename, archive or bring back. */
export const updateCleoConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ chatId: Id, pinned: z.boolean().optional(), archived: z.boolean().optional(), title: z.string().trim().min(1).max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { updateChat } = await import("@/lib/cleo-chats.server");
    return updateChat((context as any).supabase, userId, data.chatId, data);
  });

/** Delete one conversation for good (its messages and files go with it). */
export const deleteCleoConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ chatId: Id }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { deleteChats } = await import("@/lib/cleo-chats.server");
    await deleteChats((context as any).supabase, userId, data.chatId);
    return { ok: true };
  });

const StartInput = z
  .object({
    /** One per send, made by the app: the same send twice is one question. */
    key: z.string().min(8).max(64),
    message: z.string().trim().max(4000),
    chatId: Id.nullish(),
    attachments: AttachmentsInput.optional(),
    route: z.string().max(300).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    clientId: Id.nullish(),
    section: z.enum(CLEO_SECTIONS).nullish(),
    edit: Id.nullish(),
    regenerate: Id.nullish(),
  })
  .refine((d) => !!d.regenerate || d.message.length > 0 || (d.attachments?.length ?? 0) > 0, "Type a message or attach something.");

/** Ask: the question and a pending answer are saved at once; the answer is written in the background. */
export const startCleoTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const cleo = await assertCleo(context as any);
    const token = bearer();
    if (!token) throw new Error("Sign in again to keep talking to Cleo.");
    const { startTurn, runTurn } = await import("@/lib/cleo-turns.server");
    const res = await startTurn({ supabase: (context as any).supabase, userId, ...cleo }, data, token);
    if (!res.dispatched) {
      // the database couldn't take it: answer now, in this request (it holds while it's open)
      await runTurn(res.assistant.id, token);
      const { data: done } = await (context as any).supabase.from("summer_messages").select((await import("@/lib/cleo-chats.server")).MESSAGE_COLS).eq("id", res.assistant.id).maybeSingle();
      if (done) res.assistant = done;
    }
    return res;
  });

/** The answers being written: their status, progress line, and the answer once it's done. */
export const pollCleoTurns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(Id).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { pollTurns } = await import("@/lib/cleo-turns.server");
    return pollTurns((context as any).supabase, userId, data.ids, bearer());
  });

export const stopCleoTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: Id }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { stopTurn } = await import("@/lib/cleo-turns.server");
    return stopTurn((context as any).supabase, userId, data.id);
  });

export const getCleoArchiveSetting = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { archiveSetting } = await import("@/lib/cleo-chats.server");
    return { days: await archiveSetting((context as any).supabase, userId) };
  });

export const saveCleoArchiveSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().int().refine((n) => (ARCHIVE_DAY_CHOICES as readonly number[]).includes(n), "Pick one of the choices.") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    await assertCleo(context as any);
    const { saveArchiveSetting } = await import("@/lib/cleo-chats.server");
    await saveArchiveSetting((context as any).supabase, userId, data.days);
    return { days: data.days };
  });

const DICTATION_HINT =
  "A strength coach dictating to their assistant, Cleo: questions and instructions about clients, training programs, nutrition, cardio, check-ins, the calendar and the business. Terms: RPE, RIR, e1RM, 1RM, AMRAP, PR, deload, top set, back-off sets, RDL, SSB, kg, lb, macros, kcal, GST, HST, check-in, Stripe.";

async function dictationLimited(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  for (const [key, max, window] of [[`cleo_dictation:${userId}`, 40, "10 minutes"], [`cleo_dictation_day:${userId}`, 300, "1 day"]] as const) {
    const { data, error } = await db.rpc("_challenge_rate_ok", { p_key: key, p_max: max, p_window: window });
    if (error || data === false) return true;
  }
  return false;
}

/**
 * Dictation: what they said, as words to read and change before sending. OpenAI's transcriber
 * (then Whisper) on the OpenAI key, never Lovable credits; client names as spelling hints; the
 * audio is never stored.
 */
export const transcribeCleoDictation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ audio: z.string().min(16).max(9_000_000), mime: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
    const { userId } = context as any;
    const { db } = await assertCleo(context as any);
    if (await dictationLimited(userId)) return { ok: false, reason: "That's a lot of recordings in a few minutes. Type it for now, or try again shortly." };
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, reason: "Voice isn't set up. Type it instead." };
    const { data: people } = await db.from("clients").select("full_name").not("full_name", "is", null).eq("archived", false).limit(120);
    const names = ((people ?? []) as Array<{ full_name: string | null }>).map((c) => (c.full_name ?? "").trim()).filter(Boolean);
    const hint = names.length ? `${DICTATION_HINT} People they may name: ${names.join(", ")}.`.slice(0, 1500) : DICTATION_HINT;
    const started = Date.now();
    const { openAiTranscriber, transcribePainAudio } = await import("@/lib/pain/describe.server");
    const { recordAiCall } = await import("@/lib/ai/ai-health.server");
    try {
      const r = await transcribePainAudio(data.audio, data.mime, [openAiTranscriber(key, "gpt-4o-mini-transcribe", hint), openAiTranscriber(key, "whisper-1", hint)], 60_000);
      void recordAiCall({ model: r.via, task: "coach_voice", feature: "cleo_dictation", ok: true, ms: Date.now() - started });
      return { ok: true, text: r.text };
    } catch (e: any) {
      void recordAiCall({ model: "openai:gpt-4o-mini-transcribe", task: "coach_voice", feature: "cleo_dictation", ok: false, error: e, ms: Date.now() - started });
      return { ok: false, reason: e?.message ?? "Couldn't hear that." };
    }
  });
