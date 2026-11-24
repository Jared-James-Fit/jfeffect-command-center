/**
 * Cleo's conversations (summer_chats): what a conversation is called and what
 * it's about, how History groups them (and the archive), and the words for a
 * category. Pure, shared by the server and the UI.
 *
 * Nov 24 2026: conversations are permanent. Opening Cleo restores the most
 * recent conversation for where the coach is (a client's, or the general one)
 * until it's archived; quiet ones are archived after 30 days (the person's
 * archive_after_days), never deleted by the app.
 */

/** Before Nov 24 2026 a 6-hour gap started a fresh chat. Kept for the "Chat from …" note's wording only. */
export const CHAT_GAP_MS = 6 * 60 * 60_000;
/** How long a conversation sits quiet before it's archived, unless the person changed it (0 = never). */
export const DEFAULT_ARCHIVE_DAYS = 30;
export const ARCHIVE_DAY_CHOICES = [0, 14, 30, 60, 90, 180] as const;

export const CLEO_CATEGORIES = ["general", "workout", "nutrition", "cardio", "recovery", "analytics", "checkins", "program"] as const;
export type CleoCategory = (typeof CLEO_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<CleoCategory, string> = {
  general: "General",
  workout: "Workout",
  nutrition: "Nutrition",
  cardio: "Cardio",
  recovery: "Recovery",
  analytics: "Analytics",
  checkins: "Weekly check-ins",
  program: "Program building",
};

export function isCategory(v: unknown): v is CleoCategory {
  return typeof v === "string" && (CLEO_CATEGORIES as readonly string[]).includes(v);
}

export type CleoChat = {
  id: string;
  title: string;
  preview: string | null;
  created_at: string;
  last_message_at: string;
  client_id?: string | null;
  client_name?: string | null;
  category?: CleoCategory | null;
  pinned_at?: string | null;
  archived_at?: string | null;
  archived_by?: "auto" | "person" | null;
  title_source?: "question" | "auto" | "person" | null;
  /** Answers still being written, plus cards waiting on someone. */
  pending?: number;
};

/** Still the chat you're in: the latest one, if it had a message in the last 6 hours. */
export function isCurrentChat(lastMessageAt: string, now = Date.now()): boolean {
  const t = Date.parse(lastMessageAt);
  return Number.isFinite(t) && now - t < CHAT_GAP_MS;
}

const GREETING = /^(?:(?:hey|hi|hello|yo|ok(?:ay)?|so)[\s,!.]+)?(?:cleo|summer)\b[\s,!.:-]*/i;

/** A chat's first name: its first question, without "Hey Cleo,", cut at a word near 60 characters. */
export function chatTitle(message: string): string {
  let t = String(message ?? "").replace(/\s+/g, " ").trim().replace(GREETING, "").trim();
  if (!t) return "New chat";
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const space = cut.lastIndexOf(" ");
    t = `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * A title the AI wrote, cleaned: no quotes, no trailing stop, no "Title:", at most
 * 60 characters; null when there's nothing usable (the question's own title stays).
 */
export function cleanAiTitle(raw: unknown): string | null {
  let t = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(title|conversation)\s*[:\-–]\s*/i, "")
    .replace(/^["'“”‘’`*]+|["'“”‘’`*]+$/g, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (t.length < 3 || /^new chat$/i.test(t)) return null;
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const space = cut.lastIndexOf(" ");
    t = (space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "");
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// What a conversation is about, from its words and where it started. The AI's
// read (with the title) can refine it; this is the free first guess.
const CATEGORY_WORDS: Array<[CleoCategory, RegExp]> = [
  ["checkins", /\b(check[- ]?ins?|weekly check|checkin|form(s)? (to review|waiting)|reviewed)\b/i],
  ["cardio", /\b(cardio|treadmill|incline walk|steps? (target|per day)|zone 2|conditioning|bike|stairmaster|rower)\b/i],
  ["nutrition", /\b(nutrition|macros?|calories|kcal|protein|carbs?|fats?|meal plan|meals?|diet|cut(ting)?|bulk(ing)?|deficit|surplus|water intake|supplements?|creatine)\b/i],
  ["recovery", /\b(recovery|pain|hurts?|injur(y|ed|ies)|sore(ness)?|sleep|readiness|fatigue|tweak(ed)?|niggle|deload)\b/i],
  ["analytics", /\b(analytics|trend|progress(ing)?|e1rm|estimated max|volume (by|per)|adherence|compliance|how (is|are) .* (doing|trending)|stats?|bodyweight trend)\b/i],
  ["program", /\b(program(ming)?|block|mesocycle|template|build (a|an|the|their)|next program|periodi[sz]ation|peak(ing)?|taper|accessor(y|ies)|exercise order|split)\b/i],
  ["workout", /\b(workout|session|sets?|reps?|rpe|rir|squat|bench|deadlift|logged|today'?s training|exercise)\b/i],
];

/** The category a few words point to, else the section's, else general. */
export function guessCategory(text: string, section?: CleoSection | null): CleoCategory {
  const t = String(text ?? "");
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(t)) return cat;
  return section ? SECTION_CATEGORY[section] : "general";
}

// ---------------------------------------------------------------------------
// Where the coach is: the client and the section a page is about.

export const CLEO_SECTIONS = ["client", "workouts", "nutrition", "cardio", "builder", "intelligence", "analytics", "checkins", "messages"] as const;
export type CleoSection = (typeof CLEO_SECTIONS)[number];

export const SECTION_LABEL: Record<CleoSection, string> = {
  client: "Client management",
  workouts: "Workout management",
  nutrition: "Nutrition management",
  cardio: "Cardio management",
  builder: "Program builder",
  intelligence: "Program Intelligence",
  analytics: "Analytics",
  checkins: "Weekly check-ins",
  messages: "Messages",
};

export const SECTION_CATEGORY: Record<CleoSection, CleoCategory> = {
  client: "general",
  workouts: "workout",
  nutrition: "nutrition",
  cardio: "cardio",
  builder: "program",
  intelligence: "program",
  analytics: "analytics",
  checkins: "checkins",
  messages: "general",
};

export function isSection(v: unknown): v is CleoSection {
  return typeof v === "string" && (CLEO_SECTIONS as readonly string[]).includes(v);
}

export type CleoPlace = {
  /** The client the page is about (null: nobody in particular). */
  clientId: string | null;
  /** A program block whose client is looked up (the block editor). */
  blockId: string | null;
  section: CleoSection | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

const CLIENT_TAB_SECTION: Record<string, CleoSection> = {
  training: "workouts",
  nutrition: "nutrition",
  cardio: "cardio",
  metrics: "analytics",
  coaching: "checkins",
  "goals-setup": "client",
  summary: "client",
};

/**
 * Which client and section a page is about, from its path and search. Pure (the
 * block editor's client is looked up separately, from `blockId`).
 */
export function cleoPlaceFromLocation(pathname: string, search: Record<string, unknown> | string | null | undefined): CleoPlace {
  const params: Record<string, unknown> =
    typeof search === "string" ? Object.fromEntries(new URLSearchParams(search.replace(/^\?/, ""))) : (search ?? {});
  const path = String(pathname ?? "").replace(/\/+$/, "");
  const none: CleoPlace = { clientId: null, blockId: null, section: null };

  let m = path.match(/^\/admin\/clients\/([0-9a-f-]{36})(?:\/(progress|schedule))?$/i);
  if (m && uuidOr(m[1])) {
    const tab = typeof params.tab === "string" ? params.tab : "";
    const section: CleoSection = m[2] === "progress" ? "analytics" : m[2] === "schedule" ? "workouts" : CLIENT_TAB_SECTION[tab] ?? "client";
    return { clientId: uuidOr(m[1]), blockId: null, section };
  }
  if (/^\/admin\/clients$/i.test(path)) {
    const overlay = uuidOr(params.clientId);
    if (overlay) {
      const tab = typeof params.clientTab === "string" ? params.clientTab : "";
      return { clientId: overlay, blockId: null, section: CLIENT_TAB_SECTION[tab] ?? "client" };
    }
    const peek = uuidOr(params.peek);
    if (peek) return { clientId: peek, blockId: null, section: "workouts" };
    return none;
  }
  m = path.match(/^\/admin\/client-programs\/([0-9a-f-]{36})(?:\/(analytics|intelligence|next-program|history))?$/i);
  if (m && uuidOr(m[1])) {
    const sub = (m[2] ?? "").toLowerCase();
    const section: CleoSection = sub === "analytics" ? "analytics" : sub === "intelligence" || sub === "next-program" ? "intelligence" : "workouts";
    return { clientId: uuidOr(m[1]), blockId: null, section };
  }
  m = path.match(/^\/admin\/program-assign\/([0-9a-f-]{36})$/i);
  if (m && uuidOr(m[1])) return { clientId: uuidOr(m[1]), blockId: null, section: "builder" };
  m = path.match(/^\/admin\/blocks\/([0-9a-f-]{36})$/i);
  if (m && uuidOr(m[1])) return { clientId: null, blockId: uuidOr(m[1]), section: "builder" };
  if (/^\/admin\/program-library\/[0-9a-f-]{36}$/i.test(path)) return { clientId: null, blockId: null, section: "builder" };
  if (/^\/admin\/(communication|messages)$/i.test(path)) {
    const client = uuidOr(params.client);
    if (client) return { clientId: client, blockId: null, section: "messages" };
    return { clientId: null, blockId: null, section: "messages" };
  }
  if (/^\/admin\/forms/i.test(path)) return { clientId: null, blockId: null, section: "checkins" };
  return none;
}

// ---------------------------------------------------------------------------
// History: Pinned, Today, Yesterday, Previous 7 days, Previous 30 days, then by month.

const dayKeyIn = (d: Date, timeZone: string) => d.toLocaleDateString("en-CA", { timeZone });
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86_400_000;

/** History's sections, newest activity first; pinned conversations lead, in their own section. */
export function groupChats<T extends { last_message_at: string; pinned_at?: string | null }>(
  chats: T[],
  now = new Date(),
  timeZone = "America/Winnipeg",
  opts: { pinned?: boolean } = {},
): Array<{ label: string; chats: T[] }> {
  const usePinned = opts.pinned !== false;
  const todayN = dayNumber(dayKeyIn(now, timeZone));
  const out: Array<{ label: string; chats: T[] }> = [];
  const push = (label: string, chat: T) => {
    const existing = out.find((g) => g.label === label);
    if (existing) existing.chats.push(chat);
    else out.push({ label, chats: [chat] });
  };
  const byActivity = [...chats].sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
  if (usePinned) for (const c of byActivity) if (c.pinned_at) push("Pinned", c);
  for (const c of byActivity) {
    if (usePinned && c.pinned_at) continue;
    const d = new Date(c.last_message_at);
    const ago = todayN - dayNumber(dayKeyIn(d, timeZone));
    const label =
      ago <= 0 ? "Today"
      : ago === 1 ? "Yesterday"
      : ago < 7 ? "Previous 7 days"
      : ago < 30 ? "Previous 30 days"
      : d.toLocaleDateString("en-CA", { timeZone, month: "long", year: "numeric" });
    push(label, c);
  }
  return out;
}

/**
 * The archive: by year, then month, then day, the most recently active first
 * (a conversation sits where it was last active, not where it was archived).
 */
export function groupArchive<T extends { last_message_at: string }>(
  chats: T[],
  timeZone = "America/Winnipeg",
): Array<{ year: string; months: Array<{ label: string; days: Array<{ label: string; chats: T[] }> }> }> {
  const years: Array<{ year: string; months: Array<{ label: string; days: Array<{ label: string; chats: T[] }> }> }> = [];
  const sorted = [...chats].sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
  for (const c of sorted) {
    const d = new Date(c.last_message_at);
    const year = d.toLocaleDateString("en-CA", { timeZone, year: "numeric" });
    const month = d.toLocaleDateString("en-CA", { timeZone, month: "long" });
    const day = d.toLocaleDateString("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric" });
    let y = years.find((x) => x.year === year);
    if (!y) years.push((y = { year, months: [] }));
    let mo = y.months.find((x) => x.label === month);
    if (!mo) y.months.push((mo = { label: month, days: [] }));
    let dd = mo.days.find((x) => x.label === day);
    if (!dd) mo.days.push((dd = { label: day, chats: [] }));
    dd.chats.push(c);
  }
  return years;
}

/** "3:42 PM" today, "Mon" this week, "Nov 2" this year, "Nov 2, 2025" before. */
export function chatWhen(iso: string, now = new Date(), timeZone = "America/Winnipeg"): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const ago = dayNumber(dayKeyIn(now, timeZone)) - dayNumber(dayKeyIn(d, timeZone));
  if (ago <= 0) return d.toLocaleTimeString("en-CA", { timeZone, hour: "numeric", minute: "2-digit" });
  if (ago < 7) return d.toLocaleDateString("en-CA", { timeZone, weekday: "short" });
  const sameYear = dayKeyIn(d, timeZone).slice(0, 4) === dayKeyIn(now, timeZone).slice(0, 4);
  return d.toLocaleDateString("en-CA", { timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The device's time zone (the person's local time), else Manitoba's. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Winnipeg";
  } catch {
    return "America/Winnipeg";
  }
}

export type ChatFilters = {
  q?: string | null;
  clientId?: string | null;
  /** Only conversations about nobody in particular. */
  general?: boolean;
  category?: CleoCategory | null;
  /** yyyy-mm-dd, inclusive, in the person's time zone (the server takes instants). */
  from?: string | null;
  to?: string | null;
  archived?: boolean;
};
