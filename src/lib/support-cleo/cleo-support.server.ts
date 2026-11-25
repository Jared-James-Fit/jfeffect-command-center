/**
 * Cleo's turn in a JF Effect Support chat (server only; load inside handlers).
 * Runs right after the person's message is saved, inside their send, so the
 * answer is in the chat by the time their send returns (a few seconds). It
 * answers from the knowledge base or hands off (rules.ts), and never writes
 * while a person handles the chat: the claim below only succeeds on a thread
 * Cleo still has. A model that fails or answers something that can't be shown
 * is a hand-off, never a guess.
 */
import {
  MAX_CLEO_TURNS, SUPPORT_SYSTEM, cleanAnswer, cleoStreak, escalationTrigger, handoffMessage, isRepeat,
  modelEscalation, parseCleoReply, ruleEscalation, supportPrompt, type Escalation, type EscalationCategory,
} from "./rules";
import type { KbTier } from "@/content/support-kb";

type Db = any;
type Msg = { sender_role: string; body: string; created_at: string };

async function personFor(admin: Db, thread: any): Promise<{ tier: KbTier; firstName: string | null; clientId: string | null }> {
  let client: any = null;
  if (thread.client_id) {
    const { data } = await admin.from("clients").select("id, service_tier, first_name, preferred_name, full_name").eq("id", thread.client_id).maybeSingle();
    client = data;
  }
  const name = (client?.preferred_name || client?.first_name || (client?.full_name ?? "").split(" ")[0] || "").trim();
  return { tier: client?.service_tier === "coaching" ? "coaching" : "self_serve", firstName: name || null, clientId: client?.id ?? null };
}

async function memberUserId(admin: Db, memberId: string | null | undefined): Promise<string | null> {
  if (!memberId) return null;
  const { data } = await admin.from("app_members").select("user_id").eq("id", memberId).maybeSingle();
  return (data?.user_id as string | null) ?? null;
}

/**
 * Hand the chat to the team: Cleo says so once (unless it already did), the
 * card is saved, the team's badge lights and the team gets one push.
 */
export async function escalateSupportThread(admin: Db, thread: any, esc: Escalation, opts: { firstName?: string | null; actorUserId?: string | null } = {}) {
  const { data: claimed } = await admin
    .from("member_support_threads")
    .update({
      handler: "human",
      escalation: esc,
      escalated_at: esc.at,
      unread_for_team: Math.max(1, thread.unread_for_team ?? 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread.id)
    .eq("handler", "cleo")
    .select("id")
    .maybeSingle();
  if (!claimed) return { escalated: false };
  await admin.from("member_support_messages").insert({
    thread_id: thread.id,
    member_id: thread.member_id ?? null,
    sender_user_id: null,
    sender_role: "cleo",
    category: "handoff",
    body: handoffMessage(esc.category, opts.firstName),
  });
  try {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    if (thread.client_id) {
      await notifyAppEvent(admin, "support_message", { clientId: thread.client_id, sourceId: `${thread.id}:handoff:${Date.parse(esc.at) || Date.now()}`, actorUserId: opts.actorUserId ?? null, target: thread.id });
    }
  } catch (e) {
    console.warn("[support] hand-off push failed", e);
  }
  return { escalated: true };
}

/** Cleo's answer to the newest message, or its hand-off. Never throws: a failure hands off. */
export async function runCleoSupportTurn(admin: Db, threadId: string, actorUserId: string | null): Promise<{ outcome: "answered" | "escalated" | "skipped" }> {
  const { data: thread } = await admin.from("member_support_threads").select("*").eq("id", threadId).maybeSingle();
  if (!thread || thread.handler !== "cleo" || thread.status === "closed") return { outcome: "skipped" };
  const { data: rows } = await admin
    .from("member_support_messages")
    .select("sender_role, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);
  const messages = (rows ?? []) as Msg[];
  const last = messages[messages.length - 1];
  if (!last || last.sender_role !== "member") return { outcome: "skipped" };
  const person = await personFor(admin, thread);
  const now = new Date().toISOString();
  const mine = messages.filter((m) => m.sender_role === "member").map((m) => m.body);
  const cleoSaid = messages.filter((m) => m.sender_role === "cleo").map((m) => m.body);
  const handOff = (category: EscalationCategory) =>
    escalateSupportThread(admin, thread, ruleEscalation({ category, by: "cleo", lastAsk: last.body, cleoSaid, at: now }), { firstName: person.firstName, actorUserId })
      .then((r) => ({ outcome: r.escalated ? ("escalated" as const) : ("skipped" as const) }));

  // Code decides first: some things are never Cleo's.
  const trigger = escalationTrigger(last.body);
  if (trigger) return handOff(trigger);
  if (cleoStreak(messages) >= MAX_CLEO_TURNS || isRepeat(last.body, mine.slice(0, -1))) return handOff("repeated");

  // Their message goes to OpenAI only with their permission (5.1.2(i), src/lib/ai-consent). Without it, or
  // when the answer can't be read (fails closed), no model is called: a person answers, and the member is told so.
  const ownerId = actorUserId ?? (await memberUserId(admin, thread.member_id));
  const { userAllowsAi } = await import("@/lib/ai-consent/consent.server");
  if (!ownerId || !(await userAllowsAi(ownerId))) return handOff("no_ai_consent");

  let reply;
  try {
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const history = messages.map((m) => ({ role: m.sender_role === "member" ? ("person" as const) : m.sender_role === "cleo" ? ("cleo" as const) : ("team" as const), body: m.body }));
    const r = await askRoute("support_answer", {
      system: SUPPORT_SYSTEM,
      prompt: supportPrompt({ tier: person.tier, firstName: person.firstName, history }),
      timeoutMs: 25_000,
    }, { sb: admin, openaiOnly: true });
    reply = parseCleoReply(r.text);
  } catch (e) {
    console.warn("[support] Cleo couldn't answer", (e as Error)?.message);
    return handOff("cleo_unavailable");
  }
  if (!reply) return handOff("unsure");
  const answer = reply.escalate || !reply.confident ? null : cleanAnswer(reply.answer);
  if (!answer) {
    const base = ruleEscalation({ category: reply.category, by: "cleo", lastAsk: last.body, cleoSaid, at: now });
    const r = await escalateSupportThread(admin, thread, modelEscalation(reply, base), { firstName: person.firstName, actorUserId });
    return { outcome: r.escalated ? "escalated" : "skipped" };
  }

  // Claim the turn: only a thread Cleo still has (a person may have taken over meanwhile).
  const { data: claimed } = await admin
    .from("member_support_threads")
    .update({ cleo_turns: (thread.cleo_turns ?? 0) + 1 })
    .eq("id", threadId)
    .eq("handler", "cleo")
    .neq("status", "closed")
    .select("id")
    .maybeSingle();
  if (!claimed) return { outcome: "skipped" };
  await admin.from("member_support_messages").insert({
    thread_id: threadId,
    member_id: thread.member_id ?? null,
    sender_user_id: null,
    sender_role: "cleo",
    category: "reply",
    body: answer,
  });
  return { outcome: "answered" };
}
