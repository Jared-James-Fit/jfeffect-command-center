/**
 * Coaching leads: a person who applied for coaching (coaching_applications),
 * the coach's read on them and the text that gets them to the next step.
 *
 * The AI writes, in the background (coaching-leads.server.ts), a short brief
 * for the coach (who they are, why they're ready, what to watch for, the
 * angle, the next step) and two texts in the coach's voice with Grant
 * Cardone's close: the first one to send now (speed, certainty, one next
 * step, an either/or time, the discovery-call link) and the follow-up if
 * they go quiet. Pure: prompts, parsing, what counts as waiting, the links
 * a tap opens. Shown on the Leads screen, Home and the pinned Messages row.
 */
import { APPLY_GOALS, APPLY_TIMELINES } from "@/lib/apply-form";

/** A lead is "waiting on you" this long after applying; older ones stay listed but quiet. */
export const LEAD_WAITING_DAYS = 14;
/** Cut-off runs (generating this long) are picked up again. */
export const LEAD_STALE_MS = 10 * 60_000;
/** Tries before a reply is left as failed (the coach can still tap Write again). */
export const LEAD_MAX_ATTEMPTS = 3;
/** The coach's note for a rewrite ("shorter", "mention in-person"). */
export const LEAD_INSTRUCTIONS_MAX = 500;
export const LEADS_URL = "/admin/leads";
/** The public site, for the booking link in a text. */
export const PUBLIC_ORIGIN = "https://jfeffect.com";

export type LeadBrief = {
  /** Who they are and what they actually want, 1–2 sentences. */
  read: string;
  /** Why they're ready (from their own answers). */
  signals: string[];
  /** What's unknown or likely to come up (price, time, past attempts). */
  watch: string[];
  /** How to pitch it to them. */
  angle: string;
  /** The one move, now. */
  next_step: string;
};

export type LeadReplyStatus = "pending" | "generating" | "ready" | "error";

export type LeadReplyRow = {
  application_id: string;
  status: LeadReplyStatus;
  brief: LeadBrief | null;
  reply: string | null;
  follow_up: string | null;
  instructions: string | null;
  error: string | null;
  attempts: number | null;
  generated_at: string | null;
  copied_at: string | null;
  updated_at: string | null;
};

export type LeadApplication = {
  id: string;
  created_at: string;
  full_name: string | null;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  main_goal: string | null;
  target_outcome: string | null;
  timeline: string | null;
  lead_score: number | null;
  lead_temperature: string | null;
  qualification_label: string | null;
  recommended_offer: string | null;
  status: string | null;
  call_status: string | null;
  /** When the follow-up text is due (a day after the first, set by Mark texted). */
  follow_up_at?: string | null;
  client_id: string | null;
  is_test: boolean | null;
  source_label?: string | null;
  booking_link_slug?: string | null;
};

const label = (list: ReadonlyArray<{ v: string; l: string }>, v: string | null | undefined) =>
  list.find((x) => x.v === v)?.l ?? (v ? v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");

export const goalLabel = (v: string | null | undefined) => label(APPLY_GOALS, v);
export const timelineLabel = (v: string | null | undefined) => label(APPLY_TIMELINES, v).replace("–", "-");

export function firstNameOf(app: Pick<LeadApplication, "first_name" | "full_name">): string {
  return (app.first_name || app.full_name || "").trim().split(/\s+/)[0] ?? "";
}

type NeedsInput = Pick<LeadApplication, "status" | "call_status" | "created_at" | "is_test"> & { follow_up_at?: string | null };

/**
 * What a lead needs from the coach now: the first text (a new application,
 * up to LEAD_WAITING_DAYS old), the follow-up (texted, no call booked, and
 * the follow-up is due), or nothing (booked, decided, or gone quiet long ago).
 */
export function leadNeeds(app: NeedsInput, now = Date.now()): "reply" | "follow_up" | null {
  if (app.is_test) return null;
  if (["booked", "completed", "rescheduled"].includes(app.call_status ?? "")) return null;
  const recent = (iso: string | null | undefined) => !!iso && now - Date.parse(iso) < LEAD_WAITING_DAYS * 86_400_000;
  const status = app.status ?? "New";
  if ((status === "New" || status === "Needs Review") && recent(app.created_at)) return "reply";
  if (status === "Contacted" && app.follow_up_at && Date.parse(app.follow_up_at) <= now && recent(app.follow_up_at)) return "follow_up";
  return null;
}

export const isLeadWaiting = (app: NeedsInput, now = Date.now()) => leadNeeds(app, now) !== null;

/** "Fat Loss · ASAP": what they're after, for a row. */
export function leadLine(app: Pick<LeadApplication, "main_goal" | "timeline">): string {
  return [goalLabel(app.main_goal), timelineLabel(app.timeline)].filter(Boolean).join(" · ");
}

/** Where the lead stands, in a word. */
export function leadStage(app: Pick<LeadApplication, "status" | "call_status">): { label: string; tone: "new" | "done" | "muted" } {
  if (app.call_status === "booked" || app.call_status === "rescheduled") return { label: "Call booked", tone: "done" };
  if (app.call_status === "completed") return { label: "Call done", tone: "done" };
  if (app.status === "Approved") return { label: "Signed up", tone: "done" };
  if (app.status === "Rejected") return { label: "Not a fit", tone: "muted" };
  if (app.status === "Contacted") return { label: "Texted", tone: "muted" };
  return { label: "New", tone: "new" };
}

/** Digits a phone link can dial: "+1-613-204-9868" → "+16132049868". */
export function dialable(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  return raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

/** Opens Messages on the phone with the text filled in (iPhone and Android alike). */
export function smsHref(phone: string | null | undefined, body: string): string | null {
  const to = dialable(phone);
  return to ? `sms:${to}?&body=${encodeURIComponent(body)}` : null;
}

/** An Instagram DM to their handle ("@doubledbuth", "doubledbuth" or a profile link). */
export function igDmHref(handle: string | null | undefined): string | null {
  const h = String(handle ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://ig.me/m/${h}` : null;
}

export function bookingUrl(slug: string | null | undefined): string | null {
  return slug ? `${PUBLIC_ORIGIN}/book/${slug}` : null;
}

/* ------------------------------------------------------------------ */
/* The AI                                                              */
/* ------------------------------------------------------------------ */

export const LEAD_REPLY_PROMPT = `You are Jared, head coach and owner of JF Effect (1:1 online and in-person coaching for powerlifting, building muscle, fat loss and general strength, based in Selkirk, Manitoba). Someone just applied for coaching. You do two jobs:

1. A quick read for yourself (plain and clear, not in your texting voice).
2. The text you'll send them right now, and the follow-up if they go quiet.

THE TEXT: Grant Cardone's way of closing, in your own voice.
- Speed and certainty: you got their application, you're on it, you know you can help with exactly what they asked for. No "if you're interested", "no pressure", "just checking", "whenever works".
- Make it about them: their first name and their own words for the result they want (rephrase, don't quote back a whole sentence).
- One next step only: a quick call (the discovery call, about 20 minutes) to map out their plan. Assume the call is happening and give them an either/or: "today or tomorrow?" or "afternoon or evening?". Never a yes/no question.
- If a booking link is given, add it once as the easy option ("or grab a time here: <link>"). Never make up a link.
- Short like a real text: 2 to 4 sentences, under 420 characters. No greeting card, no sign-off, no hashtags, no bullet points.
- Never promise a specific result, a number of pounds or a price. Never mention their lead score, "application score" or that they look like a good lead.
- If they're "just exploring", lower the bar (a quick chat to see if it's a fit), still with an either/or.

THE FOLLOW-UP (if they don't answer within a day): one or two sentences, still certain and warm, never needy or guilt-trippy, a new reason to talk (what you'd do first for their goal), ends on an either/or. No "just following up" / "bumping this".

THE READ (for the coach only):
- read: who they are and what they really want under the stated goal, 1-2 sentences.
- signals: up to 3 reasons they're ready, from their answers (start date, what they shared, the result they named).
- watch: up to 3 things you don't know yet or that may come up on the call (budget, schedule, training history, injuries, a past coach), each with how to handle it in a few words.
- angle: how to pitch coaching to this person in one sentence.
- next_step: the one move now, in one sentence.

Never invent facts about them. Only use what they wrote.

Reply ONLY with JSON, no code fences:
{"read": "...", "signals": ["..."], "watch": ["..."], "angle": "...", "next_step": "...", "text": "...", "follow_up": "..."}`;

/** What the model is told about the applicant. Only their own answers, never the score. */
export function leadUserPrompt(
  app: LeadApplication,
  opts: { bookingUrl?: string | null; instructions?: string | null; now?: number } = {},
): string {
  const ageH = Math.max(0, Math.round(((opts.now ?? Date.now()) - Date.parse(app.created_at)) / 3_600_000));
  const lines = [
    "THE APPLICATION",
    `First name: ${firstNameOf(app) || "(not given)"}`,
    `Wants help with: ${goalLabel(app.main_goal) || "(not given)"}`,
    `The result they want, in their words: ${app.target_outcome?.trim() || "(not given)"}`,
    `When they want to start: ${timelineLabel(app.timeline) || "(not given)"}`,
    `Gave a phone: ${app.phone ? "yes" : "no"} · Instagram: ${app.instagram ? "yes" : "no"}`,
    `Applied: ${ageH < 1 ? "just now" : ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)} days ago`}`,
    app.recommended_offer ? `Coaching that fits: ${app.recommended_offer}` : "",
    "",
    opts.bookingUrl ? `Discovery call booking link: ${opts.bookingUrl}` : "No booking link: ask which time works and say you'll call them.",
    ageH >= 24 ? "They applied a while ago: open by owning that you're getting to them now, no excuses." : "",
    opts.instructions?.trim() ? `\nCOACH'S NOTE FOR THIS VERSION (follow it): ${opts.instructions.trim().slice(0, LEAD_INSTRUCTIONS_MAX)}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];

/**
 * The model's answer → the brief and both texts, or null when it isn't one
 * (no JSON, or no text to send). Tolerates code fences and words around it.
 */
export function parseLeadReply(raw: string): { brief: LeadBrief; text: string; followUp: string } | null {
  const s = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: any;
  try {
    j = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  const text = str(j?.text, 1200);
  if (!text) return null;
  return {
    brief: {
      read: str(j.read, 600),
      signals: strs(j.signals, 3, 200),
      watch: strs(j.watch, 3, 240),
      angle: str(j.angle, 300),
      next_step: str(j.next_step, 300),
    },
    text,
    followUp: str(j.follow_up, 800),
  };
}

/** Never send a link the model made up: any URL that isn't the booking link comes out. */
export function keepOnlyBookingLink(text: string, booking: string | null | undefined): string {
  return text
    .replace(/https?:\/\/\S+/g, (url) => {
      const bare = url.replace(/[).,!?]+$/, "");
      return booking && bare === booking ? url : "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Unfinished applications                                             */
/* ------------------------------------------------------------------ */

export type LeadDraft = {
  id: string;
  full_name: string | null;
  main_goal: string | null;
  target_outcome: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  step: number | null;
  updated_at: string;
};

/** The text for someone who started applying and stopped: no AI needed, same close. */
export function draftNudge(draft: Pick<LeadDraft, "full_name" | "main_goal">, booking: string | null): string {
  const first = (draft.full_name ?? "").trim().split(/\s+/)[0];
  const goal = goalLabel(draft.main_goal).toLowerCase();
  const hey = first ? `Hey ${first}, ` : "Hey, ";
  const what = goal && goal !== "other" ? ` for ${goal}` : "";
  const link = booking ? ` Or grab a time here: ${booking}` : "";
  return `${hey}Jared from JF Effect here. Saw you started your coaching application${what}. Easier to just hop on a quick 20 min call and map out your plan. Today or tomorrow better for you?${link}`;
}
