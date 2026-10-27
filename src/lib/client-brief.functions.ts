// The coach inbox's Brief: a short AI read of what's going on with one client
// and what to do next. Staff only. Everything it reads goes through the
// coach's own access (RLS decides which clients and messages they can see),
// the model only ever sees this one client's coach chat, what's waiting and
// how training's going, and the answer is kept against a hash of exactly
// that, so opening the same Brief again costs no new AI call until something
// changes.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { messagePreviewText } from "@/lib/message-preview";

const Input = z.object({
  clientId: z.string().uuid(),
  /** What the inbox already reads as waiting on the coach, one short line each. */
  waiting: z.array(z.string().max(200)).max(20),
  /** Write a fresh one even if nothing changed. */
  refresh: z.boolean().optional(),
});

export type ClientBriefAi = {
  summary: string;
  next_step: string | null;
  generated_at: string;
  cached: boolean;
};

const MAX_MESSAGES = 30;
const BODY_CHARS = 280;

/** "Oct 21, 9:14 AM" in the coach's zone (Winnipeg): the model reads times the way he does. */
function stamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Winnipeg", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function briefTranscript(
  rows: { sender_role: string; body: string | null; attachments: unknown; created_at: string; is_internal_note: boolean | null; is_automated: boolean | null }[],
  firstName: string,
): string[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => {
      const who = m.is_internal_note
        ? "Coach (private note)"
        : m.sender_role === "client"
          ? firstName
          : m.is_automated ? "App (automatic)" : "Coach";
      const text = messagePreviewText(m.body, m.attachments).slice(0, BODY_CHARS) || "(message)";
      return `[${stamp(m.created_at)}] ${who}: ${text}`;
    });
}

const SYSTEM = [
  "You help a strength coach, Jared, triage his client inbox.",
  "From one client's chat, what's waiting on Jared and their recent training, write him a brief.",
  "Facts only from the data given: never invent, never guess numbers, never give medical advice.",
  "Plain words, short sentences, no greeting, no fluff, no emoji, no markdown.",
  "Reply with one JSON object only, no code fences: {\"summary\": string, \"next_step\": string}.",
  "summary: 2 or 3 sentences, at most 60 words: what's going on with the client right now",
  "(what they said or sent lately and how training is going) and what is waiting on Jared.",
  "next_step: the single most useful thing Jared should do next, as an instruction under 14 words.",
  "If nothing needs him, next_step says so in a few words.",
].join(" ");

function parseAi(text: string): { summary: string; next_step: string | null } {
  const stripped = (text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("The summary came back unreadable");
    raw = JSON.parse(m[0]);
  }
  const out = z.object({ summary: z.string().min(1), next_step: z.string().nullish() }).parse(raw);
  return { summary: out.summary.trim(), next_step: out.next_step?.trim() || null };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const getClientBriefAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ClientBriefAi> => {
    const sb = context.supabase as any;
    const { data: isStaff } = await sb.rpc("is_coach_or_admin", { _user_id: context.userId });
    if (!isStaff) throw new Error("Forbidden");

    // As the coach: RLS decides whether this client (and their chat) is theirs to read.
    const { data: client, error: clientError } = await sb
      .from("clients")
      .select("id, first_name, full_name, last_active_at")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) throw new Error("Client not found");
    const firstName = (client.first_name || client.full_name || "Client").trim().split(/\s+/)[0];

    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const [msgs, done] = await Promise.all([
      sb.from("messages")
        .select("sender_role, body, attachments, created_at, is_internal_note, is_automated")
        .eq("client_id", data.clientId)
        .is("deleted_at", null)
        .in("delivery_status", ["sent", "sending"])
        .order("created_at", { ascending: false })
        .limit(MAX_MESSAGES),
      sb.from("pl_day_completions")
        .select("completed_at, session_rating, logging_percentage")
        .eq("client_id", data.clientId)
        .not("completed_at", "is", null)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(30),
    ]);
    if (msgs.error) throw msgs.error;

    const workouts = (done.data ?? []) as { completed_at: string; session_rating: number | null; logging_percentage: number | null }[];
    const ratings = workouts.map((w) => w.session_rating).filter((r): r is number => typeof r === "number");
    const training = workouts.length
      ? `${workouts.length} workout${workouts.length === 1 ? "" : "s"} finished in the last 14 days, the last on ${stamp(workouts[0].completed_at)}` +
        (ratings.length ? `; average session rating ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}` : "")
      : "No workouts finished in the last 14 days";
    const lastActive = client.last_active_at ? `Last in the app ${stamp(client.last_active_at)}` : "No app activity on record";
    const transcript = briefTranscript(msgs.data ?? [], firstName);

    const prompt = [
      `Client: ${firstName}`,
      `Now: ${stamp(new Date().toISOString())}`,
      lastActive,
      `Training: ${training}`,
      "",
      "Waiting on Jared:",
      ...(data.waiting.length ? data.waiting.map((w) => `- ${w}`) : ["- nothing flagged"]),
      "",
      `Chat (oldest first, last ${transcript.length} messages):`,
      ...transcript,
    ].join("\n");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    // "Now" changes every call; the hash is everything else, so an unchanged client reuses its brief.
    const hash = await sha256(prompt.replace(/^Now: .*$/m, ""));
    if (!data.refresh) {
      const { data: hit } = await admin.from("inbox_client_briefs").select("*").eq("client_id", data.clientId).maybeSingle();
      if (hit && hit.input_hash === hash) {
        return { summary: hit.summary, next_step: hit.next_step ?? null, generated_at: hit.generated_at, cached: true };
      }
    }

    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGateway();
    const result = await generateText({ model: gateway(DEFAULT_AI_MODEL), system: SYSTEM, prompt });
    const ai = parseAi(result.text);
    const generated_at = new Date().toISOString();
    await admin.from("inbox_client_briefs").upsert({
      client_id: data.clientId,
      input_hash: hash,
      summary: ai.summary,
      next_step: ai.next_step,
      model: DEFAULT_AI_MODEL,
      generated_at,
    }, { onConflict: "client_id" });
    return { ...ai, generated_at, cached: false };
  });

export { parseAi as _parseBriefAi };
