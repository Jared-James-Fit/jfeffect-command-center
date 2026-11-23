/**
 * Coaching automation beyond pain (pure, tested): for each kind of client
 * update, whether a reply is worth sending at all, and how risky it is. Never
 * a model: a reply is drafted only after these say it's useful, and only a
 * routine one can ever go out by itself.
 *
 *   workout_reply   a workout review that says something (a note, or a
 *                   session rated 1 or 2 out of 5), or a session with a
 *                   headline PR (community.ts `headlinePr`). A one-word note
 *                   needs no reply. A question, a request to change their
 *                   training, pain mentioned without being reported, feeling
 *                   sick or a low rating waits for the coach; words that may
 *                   need medical help are urgent.
 *   checkin_reply   a weekly check-in once its recap is written. Its recap's
 *                   urgency, red flags, a request for help or pain waits for
 *                   the coach.
 *   missed_session  a planned workout that went by with nothing logged. A
 *                   second one in two weeks is a pattern for the coach.
 *   video_reply     the set videos a client sent that day, and
 *   progress_reply  a progress check-in (photos or a video): both need the
 *                   coach's own eyes, so both always wait for him (never
 *                   automatic, at every level) and their drafts only use the
 *                   records, never how anything looked (`eyesProblems`).
 */
import type { AutomationCategory, Risk } from "@/lib/recovery-automation/rules";

export type UpdateRead = { useful: boolean; why: string | null; risk: Risk; reasons: string[] };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Words in a note that may need medical help (never a diagnosis: the coach reads it). */
const WARNING = /\b(chest (pain|tight\w*|pressure)|dizz\w*|faint\w*|black(ed)? out|pass(ed)? out|numb\w*|tingl\w*|short(ness)? of breath|couldn'?t breathe|heart (racing|pounding)|vomit\w*|threw up|concussion|hit my head)\b/i;
/** Pain said in words without ticking "Anything hurt?". */
const HURTS = /\b(hurt\w*|pain\w*|sore(ness)?|tweak\w*|strain\w*|pull(ed)? (a|my)|injur\w*|ache?s?|aching|achy|sharp|pinch\w*|twing\w*|pop(ped)?|swollen|swelling|flare\w*|killing me|stiff\w*|tendon\w*|tendin\w*|irritat\w*|aggravat\w*|bother(ing|ed|s)?|throb\w*|cramp\w*|spasm\w*|bruis\w*)\b/i;
const ILL = /\b(sick|ill|flu|covid|fever|migraine|headache|nause\w*|food poisoning|sore throat|stomach bug|under the weather|coming down with|run down|rundown)\b/i;
/** Asking to change their training (a coach's decision, never an automatic one). */
const PROGRAM = /\b(move|swap|switch (to|days?|it)|change (it|the|my|this)|skip|replace|drop (it|the|this|that)|deload|reschedule|travel\w*|vacation|holiday|out of town|can'?t make|cannot make|miss(ing)? (next|tomorrow|this))\b/i;
const QUESTION = /\?|^\s*(should|can|could|do|does|is|are|how|what|when|why|would|will)\b/i;

export const UPDATE_REASON_WORDS: Record<string, string> = {
  warning_words: "words that may need medical help",
  mentions_pain: "mentions pain without reporting it",
  ill: "says they're unwell",
  question: "asks you something",
  program_request: "asks about changing their training",
  low_rating: "rated the session low",
  checkin_urgent: "the check-in's recap marks it urgent",
  checkin_important: "the check-in's recap flags it",
  checkin_flags: "flagged something in the check-in",
  help: "asked for help",
  pain_flag: "ticked pain or injury",
  missed_repeat: "missed more than one session in two weeks",
  needs_eyes_video: "a video only you can judge",
  needs_eyes_progress: "progress photos only you can judge",
};

/** Kinds that answer something only the coach can judge by looking at it: drafted for him, never sent by themselves. */
export const NEEDS_EYES: readonly AutomationCategory[] = ["video_reply", "progress_reply"];
export const needsEyes = (c: AutomationCategory) => NEEDS_EYES.includes(c);

/**
 * What a draft about a video or progress photos may never say: how anything
 * looked (technique, depth, bar path, a body), since nobody but the coach has
 * seen it. He adds that himself.
 */
const LOOKS = [
  /\b(look(ed|s|ing)?|seem(ed|s)?) (so |really |super |very |way |a lot |much )?(good|great|clean|solid|smooth|strong|fast|easy|crisp|sharp|tight|better|perfect|perff|amazing|leaner|lean|bigger|smaller|fuller|toned|shredded|jacked|yoked|massive|huge|fire|cooking)\b/i,
  /\b(form|technique|depth|bar ?path|lockout|bracing|brace|posture|setup|position|positions|tempo|speed off the floor|leg drive) (was|is|looked|looks|looking|on|in) /i,
  /\b(you look|you're looking|youre looking|your (physique|shape|body|abs))\b/i,
  /\b(leaner|lean out|definition|vascular|shredded|toned|bulky|skinny|fat loss shows|abs are)\b/i,
];

export function eyesProblems(text: string): string[] {
  const out: string[] = [];
  for (const re of LOOKS) {
    const m = text.match(re);
    if (m) out.push(m[0].toLowerCase());
  }
  return out;
}

export function workoutReplyRead(input: { note: string | null; rating: number | null; headlinePr?: boolean }): UpdateRead {
  const note = (input.note ?? "").trim();
  const low = input.rating != null && input.rating <= 2;
  const pr = !!input.headlinePr;
  if (!note && !low && !pr) return { useful: false, why: "Nothing in the review needs a reply", risk: "routine", reasons: [] };
  const question = !!note && QUESTION.test(note);
  if (note && words(note).length < 2 && !question && !low && !pr) return { useful: false, why: "A one-word note doesn't need a reply", risk: "routine", reasons: [] };
  const reasons: string[] = [];
  if (note && WARNING.test(note)) reasons.push("warning_words");
  if (note && HURTS.test(note)) reasons.push("mentions_pain");
  if (note && ILL.test(note)) reasons.push("ill");
  if (question) reasons.push("question");
  if (note && PROGRAM.test(note)) reasons.push("program_request");
  if (low) reasons.push("low_rating");
  const risk: Risk = reasons.includes("warning_words") ? "urgent" : reasons.length ? "review" : "routine";
  return { useful: true, why: null, risk, reasons };
}

export type CheckinAnalysisLike = { urgency?: string | null; red_flags?: unknown[] | null; suggested_response?: string | null };

export function checkinReplyRead(input: { analysis: CheckinAnalysisLike | null; answers: Record<string, unknown> | null }): UpdateRead {
  const a = input.analysis ?? {};
  const answers = input.answers ?? {};
  if (!String(a.suggested_response ?? "").trim()) return { useful: false, why: "Its recap has no reply to start from", risk: "routine", reasons: [] };
  const reasons: string[] = [];
  if (a.urgency === "urgent") reasons.push("checkin_urgent");
  else if (a.urgency === "high") reasons.push("checkin_important");
  if (Array.isArray(a.red_flags) && a.red_flags.length) reasons.push("checkin_flags");
  const help = String((answers as any).help ?? "").trim();
  if (help && !/^(no|nope|none|nothing|n\/?a|all good|i'?m good|im good|good)\.?$/i.test(help)) reasons.push("help");
  const flags = Array.isArray((answers as any).recovery_flags) ? ((answers as any).recovery_flags as unknown[]).map(String) : [];
  if (flags.some((f) => /pain|injur/i.test(f))) reasons.push("pain_flag");
  const risk: Risk = reasons.includes("checkin_urgent") ? "urgent" : reasons.length ? "review" : "routine";
  return { useful: true, why: null, risk, reasons };
}

/** The day's set videos: always the coach's to look at first. */
export function videoReplyRead(input: { videos: number }): UpdateRead {
  if (input.videos < 1) return { useful: false, why: "The videos were removed", risk: "routine", reasons: [] };
  return { useful: true, why: null, risk: "review", reasons: ["needs_eyes_video"] };
}

/** A progress check-in: always the coach's to look at first. */
export function progressReplyRead(input: { media: number }): UpdateRead {
  if (input.media < 1) return { useful: false, why: "Nothing was uploaded with it", risk: "routine", reasons: [] };
  return { useful: true, why: null, risk: "review", reasons: ["needs_eyes_progress"] };
}

export function missedSessionRead(input: { missedInTwoWeeks: number }): UpdateRead {
  if (input.missedInTwoWeeks >= 2) return { useful: true, why: null, risk: "review", reasons: ["missed_repeat"] };
  return { useful: true, why: null, risk: "routine", reasons: [] };
}

/** Whether the coach gets a push for an item waiting on him (the client's own update already pushed for reviews and check-ins). */
export function pushesCoach(category: AutomationCategory, risk: Risk): boolean {
  if (category === "recovery_reply" || category === "recovery_follow_up") return true;
  // a missed session, a set video, a progress check-in: never (the client's own upload already pushed him)
  if (category === "missed_session" || needsEyes(category)) return false;
  return risk === "urgent";
}

/** What the message is filed as in the chat. */
export function messageTypeFor(category: AutomationCategory): string {
  if (category === "recovery_reply" || category === "recovery_follow_up") return "Recovery";
  if (category === "checkin_reply" || category === "progress_reply") return "General";
  return "Training";
}

const CATEGORY_WEIGHT: Record<AutomationCategory, number> = {
  recovery_reply: 0,
  checkin_reply: 1,
  recovery_follow_up: 2,
  video_reply: 3,
  workout_reply: 4,
  progress_reply: 5,
  missed_session: 6,
};
const RISK_WEIGHT: Record<Risk, number> = { urgent: 0, review: 1, routine: 2 };

/**
 * The queue's order: what could be serious first, then what needs his
 * judgment, then routine ones, each by kind (pain, check-ins, follow-ups,
 * set videos, workouts, progress check-ins, missed sessions) and then the
 * oldest first.
 */
export function queueOrder<T extends { risk: Risk | null; category: AutomationCategory; due_at: string; status: string }>(a: T, b: T): number {
  const r = RISK_WEIGHT[a.risk ?? "routine"] - RISK_WEIGHT[b.risk ?? "routine"];
  if (r) return r;
  const waitA = a.status === "awaiting_approval" ? 0 : a.status === "draft" ? 1 : 2;
  const waitB = b.status === "awaiting_approval" ? 0 : b.status === "draft" ? 1 : 2;
  if (waitA !== waitB) return waitA - waitB;
  const c = CATEGORY_WEIGHT[a.category] - CATEGORY_WEIGHT[b.category];
  if (c) return c;
  return a.due_at.localeCompare(b.due_at);
}
