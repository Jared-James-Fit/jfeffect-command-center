/**
 * A short message from the coach about a workout review, a weekly check-in, a
 * missed session, the day's set videos or a progress check-in (server only): coaching automation's writer for everything
 * that isn't pain (pain is pain-draft.server.ts). Written from the facts the
 * worker read from the records, never anything else.
 *
 * Whose voice: the owner's private voice and approved examples (My Voice) only
 * for a coach with `owner.voice`; anyone else gets a plain, direct coach
 * voice. An automatic message (sent before the coach reads it) is told it is
 * one and checked in code before it can go (autoMessageProblems): it never
 * says he saw or reviewed anything and never claims a program change. A reply
 * about a video or progress photos is only ever a draft he sends himself, and
 * never says how anything looked (`eyesProblems`): that part is his.
 */
import type { AiTask } from "@/lib/ai/routing";

export type ReplyKind = "workout" | "checkin" | "missed" | "video" | "progress";

export type ReplyInput = {
  clientId: string;
  voice: boolean;
  automatic: boolean;
  kind: ReplyKind;
  /** What the records say, one line each (the only things the message may use). */
  facts: string[];
  /** A reply to start from (a check-in's suggested reply): kept close, fixed only where it must be. */
  startFrom?: string | null;
  route?: AiTask;
};

export type ReplyDraft = { message: string; model: string; warnings: string[]; firstName: string };

const PLAIN_VOICE =
  "HOW IT SOUNDS: a strength coach texting a client he knows. Lowercase is fine, short sentences, contractions, no exclamation marks unless something good happened, no emoji, no greeting card warmth, no sign-off.";

const TASK: Record<ReplyKind, (first: string) => string[]> = {
  workout: (first) => [
    `You draft a short reply from a strength coach to his client ${first} about the workout they just finished and the review they sent.`,
    "1 to 3 short sentences, under 50 words. React to what they actually wrote first; when they wrote nothing, it's about the headline PR in FACTS. Be specific to the session: name a lift, a number or a PR only if it's in FACTS, and call a record a PR only when FACTS calls it one.",
    "If they asked something, answer only what FACTS can answer; otherwise say you'll look at it and get back to them. If they rated it low, be straight and supportive without a lecture.",
  ],
  video: (first) => [
    `You draft the start of a strength coach's reply to ${first} about the set videos they sent today. The coach watches the videos and adds his own technique notes before he sends it.`,
    "1 to 3 short sentences, under 45 words: acknowledge the sets by name with their numbers from FACTS, and the bar speed only where FACTS gives one (say it plainly, e.g. 0.42 m/s, and that it held or dropped across the reps only if FACTS says so).",
    "Never say how anything looked or moved (technique, depth, bar path, lockout, bracing, speed off the floor, 'looked good', 'looked clean'): nobody has watched it but the coach. No placeholder, no brackets, no question about technique.",
  ],
  progress: (first) => [
    `You draft the start of a strength coach's reply to ${first} about the progress check-in (photos or a video) they just sent. The coach looks at it and adds his own notes before he sends it.`,
    "1 to 3 short sentences, under 45 words: thank them for sending it, and say what FACTS says about their bodyweight trend or their goal in plain numbers, only if FACTS gives them.",
    "Never comment on how they look, their body, their shape or any change you could only see (leaner, bigger, definition, 'looking good'): nobody has looked at the photos but the coach. Never praise or criticise a bodyweight number; say it plainly. No placeholder, no brackets.",
  ],
  checkin: (first) => [
    `You write the coach's reply to ${first}'s weekly check-in.`,
    "2 to 4 short sentences, under 70 words: acknowledge one real win, name the main focus for the week, and answer anything they asked for help with using only FACTS.",
  ],
  missed: (first) => [
    `You write a short check-in from a strength coach to ${first} the day after a planned workout went by with nothing logged.`,
    "One or two sentences, under 35 words, one question: whether something came up, or if they want to fit it in later this week. No guilt, never 'you missed', no lecture about consistency.",
  ],
};

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

export async function writeCoachReply(sb: any, input: ReplyInput): Promise<ReplyDraft> {
  const { data: client } = await sb.from("clients").select("id, full_name, preferred_name").eq("id", input.clientId).maybeSingle();
  if (!client) throw new Error("Client not found.");
  const first = (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them";
  const [{ voicePromptForClient }, { casualize }, { askRoute }, { autoMessageProblems }, { draftProblems }, { eyesProblems }] = await Promise.all([
    import("@/lib/coach-voice.functions"),
    import("@/lib/coach-voice"),
    import("@/lib/ai/route-call.server"),
    import("@/lib/recovery-automation/rules"),
    import("@/lib/pain/ai"),
    import("@/lib/recovery-automation/categories"),
  ]);
  const voice = input.voice ? await voicePromptForClient(sb, client.id).catch(() => PLAIN_VOICE) : PLAIN_VOICE;
  const automaticRules = input.automatic
    ? "THIS MESSAGE IS SENT AUTOMATICALLY under the coach's name, before he has read what they sent. So: never say or imply he saw, noticed, looked at, checked or reviewed anything (no 'just saw', 'I noticed', 'I looked at'); write as answering what they sent. Never say anything was or will be changed in their program."
    : "The coach reads it, edits it and sends it himself.";
  const system = [
    ...TASK[input.kind](first),
    automaticRules,
    "Sound like an experienced powerlifting and bodybuilding coach texting a client he knows: direct, specific, practical, conversational. No generic motivation, no wellness-app language, no 'listen to your body', no 'you got this', no dashes, at most one emoji and only if his voice uses them.",
    "Never diagnose, never mention medication, never invent a number, a lift, a date or anything not in FACTS.",
    input.startFrom ? "START FROM is the reply already written for this check-in: keep its substance and wording where you can, change only what the rules above require." : "",
    voice,
    'Return ONLY JSON: {"message": string}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = [`CLIENT: ${first}`, "FACTS:", ...input.facts.map((f) => `- ${f}`), input.startFrom ? `\nSTART FROM:\n${input.startFrom}` : "", "\nWrite the message."].join("\n");

  const route = input.route ?? "recovery_write";
  const eyes = input.kind === "video" || input.kind === "progress";
  const check = (m: string) => [...(input.automatic ? autoMessageProblems(m) : draftProblems(m)), ...(eyes ? eyesProblems(m) : [])];
  let reply = await askRoute(route, { system, prompt, timeoutMs: 45_000 }, { sb });
  let message = casualize(String(parse(reply.text ?? "")?.message ?? "").trim());
  const problems = message ? check(message) : ["empty"];
  if (problems.length) {
    reply = await askRoute(route, { system, prompt: `${prompt}\n\nYour last draft used words it must never use (${problems.join(", ")}). Write it again without them.`, timeoutMs: 45_000 }, { sb });
    message = casualize(String(parse(reply.text ?? "")?.message ?? "").trim()) || message;
  }
  if (!message) throw new Error("Couldn't write a draft. Try again.");
  return { message: message.slice(0, 2000), model: reply.model, warnings: check(message), firstName: first };
}
