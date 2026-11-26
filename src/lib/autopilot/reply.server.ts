/**
 * The check-in reply's versions and Re-create (Nov 25 2026). The first
 * version is the recap's own suggested reply (written in the same call as the
 * recap, from the week's autopilot assessment, in the coach's saved voice:
 * My Voice, `voicePromptForClient`; no second voice profile). Re-create
 * writes new wording only, from what's stored: the assessment (or, for an
 * older check-in, the recap), the client's answers and the current wording,
 * with an optional style (Make shorter / More like me / More direct / More
 * supportive / Custom). Every version is kept (`autopilot_reply_versions`,
 * append-only: a version's words are never rewritten), the newest becomes the
 * card's suggested reply, and nothing already sent in the chat is touched.
 * Server only.
 */
import { assessmentForReply } from "@/lib/autopilot/assess";
import { fitReply, replyKindFor, replyLengthRule, styleInstruction, type ReplyStyle } from "@/lib/autopilot/reply";
import { wordCount } from "@/lib/autopilot/publish";
import type { AutopilotAssessment } from "@/lib/autopilot/types";

type Db = any;

export type ReplyVersion = {
  id: string;
  version_no: number;
  style: ReplyStyle;
  custom_note: string | null;
  body: string;
  words: number;
  model: string | null;
  status: "draft" | "sent" | "discarded";
  created_at: string;
};

async function available(sb: Db): Promise<boolean> {
  const { error } = await sb.from("autopilot_reply_versions").select("id").limit(1);
  return !error;
}

export async function recordReplyVersion(
  sb: Db,
  x: { clientId: string; checkinId: string; decisionId: string | null; body: string; style: ReplyStyle; customNote?: string | null; model: string | null; usage: { input: number | null; output: number | null } | null; userId: string | null },
): Promise<ReplyVersion | null> {
  if (!(await available(sb))) return null;
  const { data: last } = await sb.from("autopilot_reply_versions").select("version_no, body").eq("checkin_id", x.checkinId).order("version_no", { ascending: false }).limit(1).maybeSingle();
  // the same words again (a recap redone to the same answer) aren't a new version
  if (last && last.body === x.body) return null;
  const { data, error } = await sb
    .from("autopilot_reply_versions")
    .insert({
      client_id: x.clientId,
      checkin_id: x.checkinId,
      decision_id: x.decisionId,
      version_no: (last?.version_no ?? 0) + 1,
      style: x.style,
      custom_note: x.customNote ?? null,
      body: x.body,
      words: wordCount(x.body),
      model: x.model,
      input_tokens: x.usage?.input ?? null,
      output_tokens: x.usage?.output ?? null,
      created_by: x.userId,
    })
    .select("*")
    .single();
  if (error) return null;
  return data as ReplyVersion;
}

export async function listReplyVersions(sb: Db, checkinId: string): Promise<ReplyVersion[]> {
  if (!(await available(sb))) return [];
  const { data } = await sb.from("autopilot_reply_versions").select("id, version_no, style, custom_note, body, words, model, status, created_at").eq("checkin_id", checkinId).order("version_no", { ascending: false }).limit(30);
  return (data ?? []) as ReplyVersion[];
}

/** The stored decision read back as an assessment, for the reply writer. */
export function assessmentFromRow(row: any): AutopilotAssessment {
  return {
    category: row.category,
    headline: row.headline,
    rationale: row.rationale ?? "",
    expected: row.expected_outcome ?? null,
    reassessOn: row.reassess_on,
    evidence: row.evidence ?? [],
    protections: row.protected ?? [],
    missing: row.missing ?? [],
    domains: row.domains,
  };
}

/** New wording for a check-in's reply; the facts and decision stay as they were. */
export async function recreateReply(sb: Db, x: { checkinId: string; style: ReplyStyle; custom?: string | null; userId: string }): Promise<{ version: ReplyVersion | null; body: string }> {
  const { data: row } = await sb.from("messenger_checkins").select("id, client_id, task_type, answers, ai_analysis, status").eq("id", x.checkinId).maybeSingle();
  if (!row) throw new Error("Check-in not found.");
  if (row.status !== "completed") throw new Error("This check-in hasn't been submitted.");
  // The client's answers go to OpenAI only with their permission (5.1.2(i), src/lib/ai-consent). Without it
  // (or when it can't be read: fails closed) no new wording is written, nothing reaches the client, and the
  // check-in's card says why (`ai_error`, like a recap that couldn't be written).
  const { clientAllowsAi, AiConsentError } = await import("@/lib/ai-consent/consent.server");
  const consent = await clientAllowsAi(row.client_id);
  if (!consent.ok) {
    const { coachConsentMessage } = await import("@/lib/ai-consent/consent");
    const words = coachConsentMessage(consent.name);
    await sb.from("messenger_checkins").update({ ai_error: words, updated_at: new Date().toISOString() }).eq("id", x.checkinId);
    throw new AiConsentError(words);
  }
  const a = row.ai_analysis ?? {};
  const current = String(a.suggested_response ?? "").trim();
  const { data: dec } = await sb.from("autopilot_decisions").select("*").eq("checkin_id", x.checkinId).maybeSingle();
  const assessment = dec ? assessmentFromRow(dec) : null;
  const protectedDecision = !!assessment && (assessment.category === "intervene" || assessment.protections.length > 0);
  const kind = replyKindFor({ taskType: row.task_type, redFlags: Array.isArray(a.red_flags) ? a.red_flags.length : 0, protectedDecision, helpAsked: !!String(row.answers?.help ?? "").trim() });

  const { voicePromptForClient } = await import("@/lib/coach-voice.functions");
  const { askRoute } = await import("@/lib/ai/route-call.server");
  const { casualize } = await import("@/lib/coach-voice");
  const voice = await voicePromptForClient(sb, row.client_id);
  const system = [
    "You rewrite a strength and nutrition coach's reply to a client's check-in. Wording only: keep every fact, number and decision exactly as given, add nothing new.",
    replyLengthRule(kind),
    styleInstruction(x.style, x.custom),
    "Never diagnose. Never promise a plan change the assessment doesn't say was published.",
    voice,
    "Return only the reply text, no quotes, no preamble.",
  ].join("\n\n");
  const recap = [
    a.summary ? `Recap: ${a.summary}` : "",
    Array.isArray(a.wins) && a.wins.length ? `Wins: ${a.wins.join("; ")}` : "",
    Array.isArray(a.focus) && a.focus.length ? `Focus: ${a.focus.join("; ")}` : "",
    Array.isArray(a.goals) && a.goals.length ? `Goals: ${a.goals.join("; ")}` : "",
    Array.isArray(a.red_flags) && a.red_flags.length ? `Red flags: ${a.red_flags.join("; ")}` : "",
  ].filter(Boolean);
  const answers = Object.entries(row.answers ?? {})
    .filter(([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .slice(0, 30)
    .join("\n");
  const prompt = [
    assessment ? assessmentForReply(assessment) : "",
    recap.join("\n"),
    "CLIENT ANSWERS:",
    answers,
    current ? `CURRENT WORDING:\n${current}` : "",
    "Write the new version.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await askRoute("coach_write", { system, prompt, timeoutMs: 45_000, tag: "checkin_recreate" }, { sb, openaiOnly: true });
  const body = fitReply(casualize(String(result.text ?? "").replace(/^["']|["']$/g, "").trim()), kind);
  if (!body) throw new Error("No new wording came back. Try again in a minute.");
  const style = x.style === "initial" ? "redo" : x.style;
  // the first version (if the recap was written before versions were kept) goes on record first
  const prior = await listReplyVersions(sb, x.checkinId);
  if (!prior.length && current) await recordReplyVersion(sb, { clientId: row.client_id, checkinId: x.checkinId, decisionId: dec?.id ?? null, body: current, style: "initial", model: null, usage: null, userId: null });
  const version = await recordReplyVersion(sb, { clientId: row.client_id, checkinId: x.checkinId, decisionId: dec?.id ?? null, body, style, customNote: x.style === "custom" ? x.custom ?? null : null, model: result.model, usage: { input: result.usage?.input ?? null, output: result.usage?.output ?? null }, userId: x.userId });
  // the card shows the newest wording (the recap's facts are untouched)
  await sb.from("messenger_checkins").update({ ai_analysis: { ...a, suggested_response: body }, updated_at: new Date().toISOString() }).eq("id", x.checkinId);
  if (dec?.id) {
    const { addUsage } = await import("@/lib/autopilot/cost");
    await sb.from("autopilot_decisions").update({ cost: addUsage(dec.cost, { model: result.model, input: result.usage?.input ?? null, output: result.usage?.output ?? null }) }).eq("id", dec.id);
  }
  return { version, body };
}

/** Show an earlier version again (it becomes the card's suggested reply; nothing is deleted). */
export async function pickReplyVersion(sb: Db, x: { checkinId: string; versionId: string }) {
  const { data: v } = await sb.from("autopilot_reply_versions").select("body, checkin_id").eq("id", x.versionId).maybeSingle();
  if (!v || v.checkin_id !== x.checkinId) throw new Error("That version wasn't found.");
  const { data: row } = await sb.from("messenger_checkins").select("ai_analysis").eq("id", x.checkinId).maybeSingle();
  await sb.from("messenger_checkins").update({ ai_analysis: { ...(row?.ai_analysis ?? {}), suggested_response: v.body }, updated_at: new Date().toISOString() }).eq("id", x.checkinId);
  return { body: v.body as string };
}
