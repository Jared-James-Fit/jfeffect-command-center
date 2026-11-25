/**
 * The check-in reply's length and openers (Nov 25 2026), shared by the recap
 * writer (messenger-checkins.functions.ts, its suggested reply) and Re-create
 * (reply.server.ts): written in the coach's existing saved voice (My Voice,
 * `voicePromptForClient`), from the same weekly assessment, short. A system
 * card is 5–20 words, a quick reply 15–50, a weekly check-in reply normally
 * 40–80, a complex one (pain, a protected decision, a request for help) at
 * most 120. No generic openers, and nothing that says the coach typed it
 * himself. Pure and tested (autopilot.test.ts).
 */
import { wordCount } from "@/lib/autopilot/publish";

export type ReplyKind = "system" | "quick" | "weekly" | "complex";
export const REPLY_WORDS: Record<ReplyKind, { min: number; max: number }> = {
  system: { min: 5, max: 20 },
  quick: { min: 15, max: 50 },
  weekly: { min: 40, max: 80 },
  complex: { min: 40, max: 120 },
};

export type ReplyStyle = "initial" | "redo" | "shorter" | "like_me" | "direct" | "supportive" | "custom";
export const STYLE_LABEL: Record<Exclude<ReplyStyle, "initial" | "redo">, string> = {
  shorter: "Make shorter",
  like_me: "More like me",
  direct: "More direct",
  supportive: "More supportive",
  custom: "Custom",
};

/** Openers that read as a template, at the start of a reply. */
export const GENERIC_OPENERS: RegExp[] = [
  /^thanks?( you)? for (checking in|the check[- ]?in|the update|sending|filling)/i,
  /^based on (the|your) (data|check[- ]?in|answers|numbers)/i,
  /^great (check[- ]?in|update|job this week)[,.! ]/i,
  /^hope (you're|youre|you are) (doing )?well/i,
  /^i (hope|trust) /i,
  /^(hi|hey|hello)[ ,!]+(there)?[,!. ]*$/i,
];

/** Never claims the coach wrote it himself (the reply is a draft he sends, or one marked as sent automatically). */
export const FALSE_AUTHORSHIP: RegExp = /\b(i (personally )?(wrote|typed) this|written by (me|jared)|this is jared( here)?|from jared himself|personally written)\b/i;

/** How long a reply to this check-in should be. */
export function replyKindFor(x: { taskType: string; redFlags: number; protectedDecision: boolean; helpAsked: boolean }): ReplyKind {
  if (x.taskType !== "weekly_checkin") return "quick";
  if (x.redFlags > 0 || x.protectedDecision || x.helpAsked) return "complex";
  return "weekly";
}

/** The rules for the reply writer's prompt. */
export function replyLengthRule(kind: ReplyKind): string {
  const w = REPLY_WORDS[kind];
  return [
    `The suggested reply is ${w.min}–${w.max} words${kind === "weekly" ? " (a normal week; up to 120 only when there's pain, a request for help or a decision the coach makes first)" : ""}. Count them.`,
    "Start with something specific from their week, never a generic opener (no \"Thanks for checking in\", \"Based on the data\", \"Great check-in\", \"Hope you're well\").",
    "Never say or imply the coach typed it himself, and never claim a plan already changed unless the assessment says it was published.",
  ].join(" ");
}

/** A restyle's instruction (Re-create's menu); wording only, the facts and decision stay. */
export function styleInstruction(style: ReplyStyle, custom?: string | null): string {
  switch (style) {
    case "shorter":
      return "Make it noticeably shorter: keep the one main point and the next step, cut the rest.";
    case "like_me":
      return "Make it sound more like the coach's own texts in MY VOICE: his words, his rhythm, casual.";
    case "direct":
      return "Make it more direct: say the main point first and plainly, fewer softeners.";
    case "supportive":
      return "Make it more supportive and warm, without losing the main point or the next step.";
    case "custom":
      return `The coach's note for this version: ${String(custom ?? "").trim().slice(0, 400)}`;
    default:
      return "Write it fresh: different wording, same facts and decision.";
  }
}

export type ReplyProblem = "too_long" | "too_short" | "generic_opener" | "false_authorship" | "empty";

/** What's wrong with a reply, by these rules. */
export function replyProblems(text: string, kind: ReplyKind): ReplyProblem[] {
  const t = String(text ?? "").trim();
  if (!t) return ["empty"];
  const out: ReplyProblem[] = [];
  const n = wordCount(t);
  const w = REPLY_WORDS[kind];
  if (n > w.max) out.push("too_long");
  if (n < Math.min(w.min, 10)) out.push("too_short");
  if (GENERIC_OPENERS.some((r) => r.test(t))) out.push("generic_opener");
  if (FALSE_AUTHORSHIP.test(t)) out.push("false_authorship");
  return out;
}

/**
 * The last deterministic pass: a generic opening sentence dropped, anything
 * claiming the coach typed it removed, and a reply over its limit cut back at
 * a sentence end (never mid-sentence; a single long sentence is cut at the
 * word limit).
 */
export function fitReply(text: string, kind: ReplyKind): string {
  let t = String(text ?? "").trim();
  const sentences = () => t.match(/[^.!?\n]+[.!?]*\s*/g) ?? [t];
  // drop a generic first sentence when there's something after it
  const first = sentences()[0] ?? "";
  if (GENERIC_OPENERS.some((r) => r.test(first.trim())) && sentences().length > 1) t = t.slice(first.length).trim();
  t = sentences()
    .filter((s) => !FALSE_AUTHORSHIP.test(s))
    .join("")
    .trim();
  const max = REPLY_WORDS[kind].max;
  if (wordCount(t) <= max) return t;
  let out = "";
  for (const s of sentences()) {
    if (wordCount(out + s) > max) break;
    out += s;
  }
  out = out.trim();
  if (!out) out = (t.match(/\S+/g) ?? []).slice(0, max).join(" ");
  return out;
}
