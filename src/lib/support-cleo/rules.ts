/**
 * Cleo as JF Effect Support's first line (Nov 25 2026): what Cleo may answer,
 * when it must hand the chat to a person, and how an answer is checked before
 * anyone reads it. Pure and tested (support-cleo.test.ts); the server side is
 * cleo-support.server.ts.
 *
 * Cleo answers only from the knowledge base (src/content/support-kb.ts), short,
 * labelled as Cleo, never inventing a feature or a benefit and never touching
 * billing, access or plans (it has no tools: it can only write). It hands off
 * when it isn't sure, when the person asks for a human, for billing, refunds or
 * exceptions, coaching judgement, a complaint, a repeated issue, and account or
 * security problems; then it says so once and stays quiet until the team hands
 * the chat back.
 */
import { SUPPORT_KB, kbLinks, type KbArticle, type KbTier } from "@/content/support-kb";

export const CLEO_SUPPORT_NAME = "Cleo";
/** Under each of Cleo's messages, so nobody mistakes it for the team. */
export const CLEO_SUPPORT_LABEL = "Cleo · JF Effect's assistant";
/** Cleo's answers in a row (no person in between) before the team takes over: no endless loop. */
export const MAX_CLEO_TURNS = 4;
/** A short answer: two or three sentences and a link. */
export const MAX_ANSWER_CHARS = 600;

export type EscalationCategory =
  | "human_request" | "billing" | "account_security" | "coaching" | "complaint" | "repeated" | "bug" | "unsure" | "cleo_unavailable" | "no_ai_consent";
export type Priority = "high" | "normal" | "low";

export type Escalation = {
  category: EscalationCategory;
  priority: Priority;
  /** What they need, in one or two lines (Cleo's summary). */
  summary: string;
  /** What Cleo already told them or tried. */
  tried: string[];
  /** What the team should do next. */
  next_action: string;
  /** Why Cleo handed off (shown on the card). */
  reason: string;
  /** Who asked for the hand-off: Cleo, or the person ("Talk to a person"). */
  by: "cleo" | "person";
  at: string;
};

export const CATEGORY_LABEL: Record<EscalationCategory, string> = {
  human_request: "Asked for a person",
  billing: "Billing or refund",
  account_security: "Account or security",
  coaching: "Coaching question",
  complaint: "Complaint",
  repeated: "Still stuck",
  bug: "Something isn't working",
  unsure: "Cleo wasn't sure",
  cleo_unavailable: "Cleo couldn't answer",
  no_ai_consent: "AI answers are off for them",
};

const NEXT_ACTION: Record<EscalationCategory, string> = {
  human_request: "Reply to them here; they asked for a person.",
  billing: "Check their plan and payments, then answer here. Cleo said nothing about charges or refunds.",
  account_security: "Check their login and account, then answer here. Cleo changed nothing.",
  coaching: "Give your coaching answer, or point them to their coach.",
  complaint: "Read it and reply personally.",
  repeated: "Cleo's answers didn't fix it: read the chat and take it from here.",
  bug: "Check what they describe, reply with a fix or a workaround, and log the bug if it's real.",
  unsure: "Answer their question; the help answers don't cover it yet (worth adding).",
  cleo_unavailable: "Answer their question; Cleo couldn't reach its model.",
  no_ai_consent: "Answer their question yourself: they haven't allowed their messages to be sent to AI services, so Cleo didn't read this.",
};

const PRIORITY: Record<EscalationCategory, Priority> = {
  human_request: "normal",
  billing: "high",
  account_security: "high",
  coaching: "normal",
  complaint: "high",
  repeated: "normal",
  bug: "normal",
  unsure: "normal",
  cleo_unavailable: "normal",
  no_ai_consent: "normal",
};

type Rule = { category: EscalationCategory; re: RegExp };
/** Checked in this order: the first that matches decides. */
const RULES: Rule[] = [
  { category: "human_request", re: /\b(talk|speak|chat)\s+(to|with)\s+(a\s+)?(real\s+)?(human|person|someone|somebody|jared|coach|team|staff)\b|\b(real|actual)\s+(human|person)\b|\bhuman\s+please\b|\bnot\s+a\s+bot\b|\bagent\b/i },
  { category: "account_security", re: /\b(hack(ed)?|compromis|stolen|someone\s+(else\s+)?(logged|got)\s+in|can'?t\s+(log|sign)\s*in|cannot\s+(log|sign)\s*in|locked\s+out|two[- ]step|2fa|verification\s+code|change\s+(my\s+)?email|wrong\s+email|merge\s+(my\s+)?accounts?|someone\s+else'?s\s+(data|account))/i },
  { category: "billing", re: /\b(refund|charge[ds]?|charging|billed|billing|invoice|receipt|payment|paid|pay\b|credit\s+card|card\s+(was|got)|subscription|cancel\s+(my\s+)?(plan|membership|subscription|coaching)|price|discount|promo|coupon|money\s+back|exception)/i },
  { category: "complaint", re: /\b(complain|complaint|unacceptable|ridiculous|terrible|awful|worst|disappointed|frustrat|angry|furious|scam|rip[- ]?off|waste\s+of)/i },
  { category: "coaching", re: /\b(pain|hurts?|injur|tweak(ed)?|pulled|strain(ed)?|doctor|physio|pregnan|medical|medication|should\s+i\s+(train|lift|squat|bench|deadlift|eat|cut|bulk|skip|deload|rest)|what\s+should\s+i\s+(eat|lift|do)\b|is\s+my\s+form|form\s+check|macros?\s+for\s+me|how\s+much\s+should\s+i)/i },
];

/** The hand-off a message calls for on its own words, or null (Cleo may try). */
export function escalationTrigger(text: string): EscalationCategory | null {
  const t = text.trim();
  if (!t) return null;
  for (const r of RULES) if (r.re.test(t)) return r.category;
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Is this the same thing they already asked (most of its words again)? Three
 * asks of one thing, or Cleo's MAX_CLEO_TURNS answers in a row, hand off.
 */
export function isRepeat(text: string, earlier: string[]): boolean {
  const words = new Set(norm(text).split(" ").filter((w) => w.length > 3));
  if (words.size < 2) return false;
  let same = 0;
  for (const e of earlier) {
    const other = new Set(norm(e).split(" ").filter((w) => w.length > 3));
    let shared = 0;
    for (const w of words) if (other.has(w)) shared++;
    if (shared / words.size >= 0.6) same++;
  }
  return same >= 2;
}

/** The articles this person can be told about (the features their tier has). */
export function articlesFor(tier: KbTier): KbArticle[] {
  return SUPPORT_KB.filter((a) => !a.tiers || a.tiers.includes(tier));
}

/** The articles most likely to answer it, best first (keyword and title words). */
export function searchKb(query: string, tier: KbTier, limit = 5): KbArticle[] {
  const q = ` ${norm(query)} `;
  const words = norm(query).split(" ").filter((w) => w.length > 2);
  const scored = articlesFor(tier).map((a) => {
    let score = 0;
    for (const k of a.keywords) if (q.includes(` ${k} `) || (k.length > 4 && q.includes(k))) score += k.includes(" ") ? 3 : 2;
    const title = norm(a.title);
    for (const w of words) if (title.includes(w)) score += 1;
    return { a, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).slice(0, limit).map((s) => s.a);
}

/** The knowledge base as Cleo reads it: only what this person has. */
export function kbForPrompt(tier: KbTier): string {
  return articlesFor(tier)
    .map((a) => `## ${a.title} [${a.id}]\n${a.answer}\nLinks: ${a.links.map((l) => `${l.label} (${l.to})`).join(", ")}`)
    .join("\n\n");
}

export const SUPPORT_SYSTEM = `You are Cleo, JF Effect's assistant, answering the first line of the "JF Effect Support" chat inside the JF Effect fitness app. You are not Jared or the team, and never claim to be.

Rules:
- Answer ONLY from the HELP ANSWERS below. If they don't answer the question, say you'll pass it to the team: set "escalate": true. Never guess.
- Never invent a feature, screen, setting, price, plan, benefit, timeline or policy. Never promise anything.
- Never change, offer to change, or say you changed billing, payments, refunds, plans, access or accounts. Those are the team's.
- Never give training, nutrition, injury or medical advice: that is coaching. Escalate it.
- Short: two or three sentences, plain words, the answer first. At most two links, written as the in-app path from the help answers exactly (e.g. /portal/account#units). No headings, no lists, no emojis.
- If they ask for a person, are upset, it's about money or their account, or the same problem is still not fixed: escalate.

Reply with JSON only:
{"answer": string, "escalate": boolean, "confident": boolean, "category": "unsure"|"bug"|"billing"|"account_security"|"coaching"|"complaint"|"human_request"|"repeated", "summary": string, "tried": string, "next_action": string}
"answer" is what they read (empty when escalating). "summary" is one line for the team about what they need. "tried" is what the help answers already told them, if anything. "next_action" is one line for the team.`;

export function supportPrompt(input: {
  tier: KbTier;
  firstName: string | null;
  history: { role: "person" | "cleo" | "team"; body: string }[];
}): string {
  const convo = input.history.slice(-12).map((m) => `${m.role === "person" ? "PERSON" : m.role === "cleo" ? "CLEO" : "TEAM"}: ${m.body.slice(0, 1200)}`).join("\n");
  return [
    `WHO: ${input.firstName ? `${input.firstName}, ` : ""}${input.tier === "coaching" ? "a coaching client (has a coach)" : "a JF Effect member (free app, no coach)"}.`,
    "HELP ANSWERS (the only things you may tell them):",
    kbForPrompt(input.tier),
    "CONVERSATION (newest last):",
    convo,
  ].join("\n\n");
}

export type CleoReply = {
  answer: string;
  escalate: boolean;
  confident: boolean;
  category: EscalationCategory;
  summary: string;
  tried: string;
  next_action: string;
};

const CATEGORIES = new Set<EscalationCategory>(["human_request", "billing", "account_security", "coaching", "complaint", "repeated", "bug", "unsure", "cleo_unavailable"]);

/** The model's JSON, read strictly: anything that doesn't parse is a hand-off, never a guess shown to someone. */
export function parseCleoReply(text: string): CleoReply | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const category = CATEGORIES.has(j.category) ? (j.category as EscalationCategory) : "unsure";
    return {
      answer: str(j.answer),
      escalate: j.escalate === true,
      confident: j.confident !== false,
      category,
      summary: str(j.summary).slice(0, 300),
      tried: str(j.tried).slice(0, 300),
      next_action: str(j.next_action).slice(0, 300),
    };
  } catch {
    return null;
  }
}

const URLISH = /(https?:\/\/[^\s)]+)|((?:^|[\s(])\/(?:portal|challenges|install|recover)[^\s),.!?]*)/g;

/**
 * An answer as it may be shown: only in-app links from the knowledge base
 * (anything else is a hand-off, never sent), short, no markdown.
 * Null when it can't be shown as it is.
 */
export function cleanAnswer(answer: string, allowed: string[] = kbLinks()): string | null {
  const text = answer.replace(/\*\*|__|^#+\s*/gm, "").replace(/\s+\n/g, "\n").trim();
  if (!text) return null;
  const links = [...text.matchAll(URLISH)].map((m) => (m[1] ?? m[2] ?? "").trim().replace(/^\(/, ""));
  if (links.some((l) => !allowed.includes(l))) return null;
  if (text.length > MAX_ANSWER_CHARS) return null;
  return text;
}

/** What Cleo says once when it hands off: it acknowledges, says who and when, and stops. */
export function handoffMessage(category: EscalationCategory, firstName?: string | null): string {
  const hi = firstName ? `Thanks, ${firstName}. ` : "Thanks. ";
  const what: Record<EscalationCategory, string> = {
    human_request: "I've asked the JF Effect team to jump in.",
    billing: "Billing and refunds are handled by the JF Effect team, so I've passed this to them.",
    account_security: "Account and sign-in issues are handled by the JF Effect team, so I've passed this to them. I haven't changed anything.",
    coaching: "That's a coaching question, so I've passed it to the JF Effect team rather than guess.",
    complaint: "I'm sorry about this. I've passed it straight to the JF Effect team.",
    repeated: "I don't want to keep you going in circles, so I've passed this to the JF Effect team.",
    bug: "I've passed this to the JF Effect team so they can look into it.",
    unsure: "I'm not sure about that one, so I've passed it to the JF Effect team.",
    cleo_unavailable: "I've passed this to the JF Effect team.",
    no_ai_consent: "AI answers are switched off for your account, so a person on the JF Effect team will answer this.",
  };
  return `${hi}${what[category]} They'll reply right here, usually within a day, and you'll get a notification.`;
}

/** The card for a hand-off code decided (no model): grounded in their words and what Cleo already said. */
export function ruleEscalation(input: {
  category: EscalationCategory;
  by: "cleo" | "person";
  lastAsk: string;
  cleoSaid: string[];
  at: string;
}): Escalation {
  const ask = input.lastAsk.replace(/\s+/g, " ").trim();
  return {
    category: input.category,
    priority: PRIORITY[input.category],
    summary: ask ? `They wrote: "${ask.length > 220 ? `${ask.slice(0, 217)}…` : ask}"` : "They asked to talk to a person.",
    tried: input.cleoSaid.slice(-3).map((s) => (s.length > 160 ? `${s.slice(0, 157)}…` : s)),
    next_action: NEXT_ACTION[input.category],
    reason: CATEGORY_LABEL[input.category],
    by: input.by,
    at: input.at,
  };
}

/** The card for a hand-off the model asked for: its summary when it gave one, the rule's otherwise. */
export function modelEscalation(reply: CleoReply, fallback: Escalation): Escalation {
  return {
    ...fallback,
    category: reply.category,
    priority: PRIORITY[reply.category],
    summary: reply.summary || fallback.summary,
    tried: reply.tried ? [reply.tried, ...fallback.tried].slice(0, 3) : fallback.tried,
    next_action: reply.next_action || NEXT_ACTION[reply.category],
    reason: CATEGORY_LABEL[reply.category],
  };
}

/** Cleo's answers since a person last wrote from the team (the loop guard). */
export function cleoStreak(messages: { sender_role: string }[]): number {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const r = messages[i].sender_role;
    if (r === "team") break;
    if (r === "cleo") n++;
  }
  return n;
}

export type SupportSegment = { text: string } | { to: string; label: string };

/** A message split so its in-app paths become taps (only knowledge-base paths; anything else stays text). */
export function supportSegments(body: string, allowed: string[] = kbLinks()): SupportSegment[] {
  const label = new Map(SUPPORT_KB.flatMap((a) => a.links.map((l) => [l.to, l.label] as const)));
  const out: SupportSegment[] = [];
  const re = /\/(?:portal|challenges|install)(?:[^\s),!?]*[^\s),.!?])?/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const to = m[0];
    if (!allowed.includes(to)) continue;
    if (m.index! > last) out.push({ text: body.slice(last, m.index) });
    out.push({ to, label: label.get(to) ?? to });
    last = m.index! + to.length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}
