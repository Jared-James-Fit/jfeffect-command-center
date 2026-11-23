/**
 * A message from the coach about a client's pain, written from their reports,
 * history, training and health (server only). One writer for every way a
 * message is made: the coach asking for a draft in the pain sheet (Assist),
 * and recovery automation's replies and follow-ups.
 *
 * Who it sounds like is a capability: the owner's private voice and approved
 * examples (My Voice) only when the coach it's for has `owner.voice`; anyone
 * else gets a plain, direct coach voice. An automatic message (sent before the
 * coach reads it) is told it is one: it never says he saw, noticed or reviewed
 * anything, never mentions a program change, and is checked in code before
 * it can go (autoMessageProblems).
 */
import { buildPainHistory, type PainEntry, type PainHistory } from "@/lib/pain/history";
import type { RecoverySuggestion } from "@/lib/pain/recovery";
import type { PainSession } from "@/lib/pain/sessions";
import type { AiTask } from "@/lib/ai/routing";

export type PainDraftInput = {
  clientId: string;
  /** Write in the owner's own voice (owner.voice). */
  voice: boolean;
  /** Sent without the coach reading it first. */
  automatic: boolean;
  /** The review this reply is about (its places lead). */
  feedbackId?: string | null;
  /** A follow-up before a session (else a reply to the report). */
  followUp?: { regions: string[]; session: { title: string | null; date: string } | null; repliedOn: string | null } | null;
  route?: AiTask;
};

export type PainDraft = {
  message: string;
  insights: string[];
  used: string[];
  model: string;
  warnings: string[];
  redFlags: number;
  history: PainHistory;
  suggestions: RecoverySuggestion[];
  sessions: PainSession[];
  entries: PainEntry[];
  firstName: string;
  today: string;
};

function suggestionKey(s: RecoverySuggestion): string {
  return `${s.key}:${s.region ?? ""}`;
}

const parse = (text: string) => {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  }
};

const PLAIN_VOICE = [
  "HOW IT SOUNDS: a strength coach texting a client he knows. Lowercase is fine, short sentences, contractions, no exclamation marks unless something good happened, no emoji, no greeting card warmth, no sign-off.",
].join("\n");

export async function writePainDraft(sb: any, input: PainDraftInput): Promise<PainDraft> {
  const { loadPainEntries, loadPainSessions, loadGivenSuggestions, todayIn } = await import("@/lib/pain/load");
  const { data: client } = await sb.from("clients").select("id, full_name, preferred_name, timezone").eq("id", input.clientId).maybeSingle();
  if (!client) throw new Error("Client not found.");
  const tz = client.timezone ?? null;
  const today = todayIn(tz);
  const [byClient, sessions, given] = await Promise.all([
    loadPainEntries(sb, [client.id], { tz: new Map([[client.id, tz]]) }),
    loadPainSessions(sb, client.id, tz).catch(() => [] as PainSession[]),
    loadGivenSuggestions(sb, client.id),
  ]);
  const [{ recoverySuggestions }, { painHistoryForAi, PAIN_RULES, draftProblems, URGENT_LINE }, { redFlags }] = await Promise.all([
    import("@/lib/pain/recovery"),
    import("@/lib/pain/ai"),
    import("@/lib/pain/safety"),
  ]);
  const entries = byClient.get(client.id) ?? [];
  const history = buildPainHistory(entries, today);
  if (!history.areas.length) throw new Error("No pain reported in the last 12 weeks.");
  const suggestions = recoverySuggestions(history, sessions, given.given);
  const painText = painHistoryForAi(history, { sessions })!;
  const first = (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them";

  const [{ voicePromptForClient }, { casualize }, { askRoute }, { loadProgramContext }, { programContextText }, health] = await Promise.all([
    import("@/lib/coach-voice.functions"),
    import("@/lib/coach-voice"),
    import("@/lib/ai/route-call.server"),
    import("@/lib/program-context.server"),
    import("@/lib/program-context"),
    import("@/lib/health/health-load"),
  ]);
  const [voice, program, records] = await Promise.all([
    input.voice ? voicePromptForClient(sb, client.id).catch(() => "") : Promise.resolve(PLAIN_VOICE),
    loadProgramContext(sb, client.id).catch(() => null),
    health.loadHealthRecords(sb, client.id, { today }).catch(() => null),
  ]);
  const { healthProfileForAi } = await import("@/lib/health/health-profile");
  const healthText = records ? healthProfileForAi(health.healthProfileFromRecords(records, today), "training") : null;
  const recent = sessions.slice(-12);
  const trainingLine = recent.length
    ? `RECENT TRAINING: ${recent.length} workouts finished in the last ${Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${recent[0].date}T00:00:00Z`)) / 86_400_000))} days; session effort ${recent.filter((s) => s.sessionRpe != null).map((s) => s.sessionRpe).join(", ") || "not rated"}; sleep under 6h before ${recent.filter((s) => s.sleep === "lt5" || s.sleep === "5_6").length} of them.`
    : "";
  const options = suggestions.map((s) => `- [${suggestionKey(s)}] ${s.area ? `${s.area}: ` : ""}${s.title} (why: ${s.why})`);
  const focus = input.feedbackId ? entries.filter((e) => e.feedbackId === input.feedbackId) : [];
  const { reportLine } = await import("@/lib/pain/report");
  const focusLine = focus.length ? `THIS REPORT (the one the message is about): ${focus.map((e) => reportLine(e)).join("; ")}.` : "";

  const follow = input.followUp;
  const followPlaces = follow ? history.areas.filter((a) => follow.regions.includes(a.region)) : [];
  const task = follow
    ? [
        `You write a short follow-up from a strength coach to his client ${first}, checking on pain they reported${follow.repliedOn ? ` (the coach replied on ${follow.repliedOn})` : ""}.`,
        follow.session
          ? `It goes the evening before their next session that loads the area: ${follow.session.title ?? "their next session"} on ${follow.session.date}. Ask how ${followPlaces.map((a) => a.label.toLowerCase()).join(" and ") || "it"} feels going into it, and to tell you before they train if it's worse.`
          : `Ask how ${followPlaces.map((a) => a.label.toLowerCase()).join(" and ") || "it"} is feeling now.`,
        "One or two short sentences, under 40 words, one question. Never repeat the earlier reply.",
      ]
    : [
        `You draft a short message from a strength coach to his client ${first} about pain they reported.`,
        "The message: 2 to 4 short sentences, under 70 words. Lead with the place and what came up (which place, what it came up on). Then the one thing that matters most. Ask one short, useful question only if the answer would change what the coach does (e.g. which part of the lift hurts).",
      ];
  const automaticRules = input.automatic
    ? [
        "THIS MESSAGE IS SENT AUTOMATICALLY under the coach's name, before he has read the report himself. So: never say or imply he saw, noticed, looked at, checked or reviewed anything (no 'just saw', 'I noticed', 'I looked at'); write as acknowledging what they sent ('thanks for flagging the knee'). Never say anything was or will be changed in the program; at most 'we'll work the plan around it'.",
      ]
    : ["The coach reads it, edits it and sends it himself."];

  const system = [
    ...task,
    ...automaticRules,
    "Sound like an experienced powerlifting and bodybuilding coach texting a client he knows: direct, specific, practical, conversational. No generic motivation, no wellness-app language, no 'listen to your body', no 'you got this', no dashes, at most one emoji and only if his voice uses them.",
    "Training changes: say what we'll do in plain coach words ('let's stop forcing the movements that aggravate it'), never claim the program was already changed.",
    "Recovery: only an option from RECOVERY OPTIONS, at most one, and only if it fits. Heat or massage is for comfort, never a fix. If an assessment is listed, say it plainly ('if it's not settling I'd rather you get it assessed than keep guessing').",
    "If WARNING SIGNS are listed, the message asks about them directly and says to get it checked; if one is urgent, it says to get medical help right away if any of those are there.",
    "Never diagnose, never name a condition or injury type, never mention medication, ice protocols or a return date.",
    PAIN_RULES,
    URGENT_LINE,
    voice,
    'Return ONLY JSON: {"insights": string[] (2 to 4 short coach-facing lines: the pattern, and what to consider in his training; facts only from the data), "message": string, "options_used": string[] (the [keys] of RECOVERY OPTIONS the message uses)}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = [
    `CLIENT: ${first}`,
    `TODAY: ${today}`,
    focusLine,
    "",
    painText,
    "",
    options.length ? ["RECOVERY OPTIONS (keys in brackets):", ...options].join("\n") : "RECOVERY OPTIONS: none. Suggest no recovery action.",
    "",
    healthText ?? "",
    program ? `PROGRAM:\n${programContextText(program)}` : "",
    trainingLine,
    "",
    follow ? "Write the insights and the follow-up." : "Write the insights and the message.",
  ]
    .filter((x) => x !== undefined)
    .join("\n");

  const route = input.route ?? "coach_write";
  const { autoMessageProblems } = await import("@/lib/recovery-automation/rules");
  const check = (m: string) => (input.automatic ? autoMessageProblems(m) : draftProblems(m));
  let reply = await askRoute(route, { system, prompt, timeoutMs: 45_000, tag: `${route}:pain` }, { sb });
  let parsed = parse(reply.text ?? "");
  let message = casualize(String(parsed?.message ?? "").trim());
  const problems = message ? check(message) : ["empty"];
  if (problems.length) {
    reply = await askRoute(
      route,
      { system, prompt: `${prompt}\n\nYour last draft used words it must never use (${problems.join(", ")}). Write it again without them.`, timeoutMs: 45_000, tag: `${route}:pain` },
      { sb },
    );
    parsed = parse(reply.text ?? "") ?? parsed;
    message = casualize(String(parsed?.message ?? "").trim());
  }
  if (!message) throw new Error("Couldn't write a draft. Try again.");
  const offered = new Set(suggestions.map(suggestionKey));
  const used = (Array.isArray(parsed?.options_used) ? parsed.options_used : [])
    .map(String)
    .map((k: string) => k.replace(/^\[|\]$/g, ""))
    .filter((k: string) => offered.has(k));
  const insights = (Array.isArray(parsed?.insights) ? parsed.insights : []).map(String).filter(Boolean).slice(0, 4);
  const flags = redFlags(history.flagged.flatMap((a) => a.entries));
  return {
    message: message.slice(0, 2000),
    insights,
    used,
    model: reply.model,
    warnings: check(message),
    redFlags: flags.length,
    history,
    suggestions,
    sessions,
    entries,
    firstName: first,
    today,
  };
}
