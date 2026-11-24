/**
 * Training roadmap: the athlete's whole program at a glance (which block,
 * which week, how long, what's next) plus what each block is for and what
 * each week focuses on. Pure, shared by the server (Cleo's digest of a block)
 * and the client (the roadmap card and Block View).
 *
 * The words come from pl_roadmap_notes: Cleo writes ai_*, a coach may write
 * coach_*, and the coach's always wins (see noteText).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Notes

export type RoadmapNoteRow = {
  id?: string;
  block_id: string;
  week_id: string | null;
  ai_label?: string | null;
  ai_summary?: string | null;
  ai_style?: string | null;
  coach_label?: string | null;
  coach_summary?: string | null;
  hidden?: boolean | null;
  generated_at?: string | null;
  edited_at?: string | null;
};

export type NoteText = { label: string | null; summary: string | null; byCoach: boolean };

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** What the athlete reads: the coach's wording field by field, else Cleo's. Hidden reads as nothing. */
export function noteText(note: RoadmapNoteRow | null | undefined): NoteText {
  if (!note || note.hidden) return { label: null, summary: null, byCoach: false };
  const cl = clean(note.coach_label);
  const cs = clean(note.coach_summary);
  return {
    label: cl ?? clean(note.ai_label),
    summary: cs ?? clean(note.ai_summary),
    byCoach: !!(cl || cs),
  };
}

export const STYLE_LABEL: Record<string, string> = {
  powerlifting: "Powerlifting",
  meet_prep: "Meet prep",
  strength: "Strength",
  hypertrophy: "Hypertrophy",
  bodybuilding: "Bodybuilding",
  general_fitness: "General fitness",
};

// ---------------------------------------------------------------------------
// Cleo's digest of a block (server side input to the AI, and the change hash)

export type DigestExercise = {
  name: string;
  is_competition_lift?: boolean | null;
  category?: string | null;
  primary_muscle_group?: string | null;
};
export type DigestRow = {
  day_id: string;
  sort_order?: number | null;
  sets?: number | null;
  reps_text?: string | null;
  rpe?: string | null;
  rir?: string | null;
  percentage?: number | null;
  percentage_basis?: string | null;
  tempo?: string | null;
  intensity_techniques?: string[] | null;
  exercise_name_override?: string | null;
  exercise?: DigestExercise | null;
};
export type DigestDay = { id: string; week_id: string; day_index: number; title?: string | null; subtitle?: string | null; focus?: string | null };
export type DigestWeek = { id: string; week_index: number; phase?: string | null; start_date?: string | null; end_date?: string | null };
export type DigestBlock = {
  id: string;
  name: string;
  goal?: string | null;
  training_focus?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  weeks?: number | null;
  week_duration_days?: number | null;
};
export type DigestContext = {
  position?: { index: number; of: number } | null;
  previousBlock?: string | null;
  nextBlock?: string | null;
  meet?: { name?: string | null; date: string } | null;
};

export type WeekStats = {
  days: number;
  exercises: number;
  sets: number;
  compSets: number;
  rpeMin: number | null;
  rpeMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  pctMin: number | null;
  pctMax: number | null;
  repsMin: number | null;
  repsMax: number | null;
};

function nums(text: string | null | undefined): number[] {
  return (String(text ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
}

export function weekStats(days: DigestDay[], rows: DigestRow[]): WeekStats {
  const dayIds = new Set(days.map((d) => d.id));
  const mine = rows.filter((r) => dayIds.has(r.day_id));
  let sets = 0;
  let compSets = 0;
  const rpes: number[] = [];
  const rirs: number[] = [];
  const pcts: number[] = [];
  const reps: number[] = [];
  for (const r of mine) {
    const s = r.sets && r.sets > 0 ? r.sets : 1;
    sets += s;
    if (r.exercise?.is_competition_lift) compSets += s;
    rpes.push(...nums(r.rpe).filter((n) => n >= 4 && n <= 10));
    rirs.push(...nums(r.rir).filter((n) => n >= 0 && n <= 6));
    if (r.percentage != null && r.percentage > 0) pcts.push(r.percentage);
    reps.push(...nums(r.reps_text).filter((n) => n >= 1 && n <= 100));
  }
  const min = (a: number[]) => (a.length ? Math.min(...a) : null);
  const max = (a: number[]) => (a.length ? Math.max(...a) : null);
  return {
    days: days.length,
    exercises: mine.length,
    sets,
    compSets,
    rpeMin: min(rpes),
    rpeMax: max(rpes),
    rirMin: min(rirs),
    rirMax: max(rirs),
    pctMin: min(pcts),
    pctMax: max(pcts),
    repsMin: min(reps),
    repsMax: max(reps),
  };
}

function rowLine(r: DigestRow): string {
  const name = clean(r.exercise_name_override) ?? r.exercise?.name ?? "Exercise";
  const head = r.sets && r.reps_text ? `${r.sets}x${r.reps_text}` : r.sets ? `${r.sets} sets` : r.reps_text ? `${r.reps_text} reps` : "";
  const effort = r.rpe ? `@RPE ${r.rpe}` : r.rir ? `@${r.rir} RIR` : "";
  const pct = r.percentage != null ? `${r.percentage}%${r.percentage_basis && r.percentage_basis !== "1rm" ? ` ${r.percentage_basis}` : ""}` : "";
  const extra = [r.tempo ? `tempo ${r.tempo}` : "", (r.intensity_techniques ?? []).join("/")].filter(Boolean).join(", ");
  const tags = [r.exercise?.is_competition_lift ? "comp lift" : "", r.exercise?.primary_muscle_group ?? ""].filter(Boolean).join(", ");
  return `${name}${tags ? ` (${tags})` : ""}: ${[head, effort, pct, extra].filter(Boolean).join(" ")}`.trim();
}

const span = (a: number | null, b: number | null) => (a == null ? "" : a === b ? `${a}` : `${a}-${b}`);

/** How volume moved against the week before, in words (never a count). */
export function volumeChange(sets: number, prevSets: number | null): string {
  if (prevSets == null || prevSets <= 0) return "first week";
  const change = (sets - prevSets) / prevSets;
  if (Math.abs(change) < 0.08) return "about the same as last week";
  const pct = Math.round(Math.abs(change) * 10) * 10 || 10;
  return `about ${pct}% ${change > 0 ? "more" : "less"} than last week`;
}

function compShare(s: WeekStats): string {
  if (!s.compSets || !s.sets) return "";
  const share = s.compSets / s.sets;
  const words = share < 0.15 ? "a small part" : share < 0.4 ? "around a third" : share < 0.65 ? "about half" : "most";
  return `competition lifts are ${words} of the work`;
}

/**
 * The week's shape for Cleo to read. Totals and averages are left out on
 * purpose: Cleo can't quote what it never sees, so the athlete reads
 * "about 40% less volume than last week", not "52 working sets".
 */
function statsLine(s: WeekStats, prev: WeekStats | null): string {
  const effort = [s.rpeMin != null ? `RPE ${span(s.rpeMin, s.rpeMax)}` : "", s.rirMin != null ? `${span(s.rirMin, s.rirMax)} RIR` : ""]
    .filter(Boolean)
    .join(", ");
  const parts = [
    `${s.days} training day${s.days === 1 ? "" : "s"}`,
    `volume ${volumeChange(s.sets, prev?.sets ?? null)}`,
    effort ? `effort ${effort}` : "",
    s.pctMin != null ? `loads ${span(s.pctMin, s.pctMax)}%` : "",
    s.repsMin != null ? `reps ${span(s.repsMin, s.repsMax)}` : "",
    compShare(s),
  ];
  return parts.filter(Boolean).join("; ");
}

const DAY_MS = 86_400_000;
function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** A week's dates: its own, else counted from the block start. */
export function weekDates(block: DigestBlock, week: DigestWeek): { start: string; end: string } | null {
  if (week.start_date && week.end_date) return { start: week.start_date.slice(0, 10), end: week.end_date.slice(0, 10) };
  if (!block.start_date) return null;
  const len = block.week_duration_days ?? 7;
  const start = addDaysIso(block.start_date, (week.week_index - 1) * len);
  return { start, end: addDaysIso(start, len - 1) };
}

/** 53-bit string hash (cyrb53), hex. Stable across server and browser. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const MAX_DIGEST = 28_000;

/** Bump when the prompt changes, so every block is rewritten in the new style. */
export const ROADMAP_PROMPT_VERSION = 5;

/**
 * The block as Cleo reads it, plus a hash of only what the notes depend on
 * (the training itself, the coach's goal/focus and where a meet falls), so a
 * new date range or a renamed day doesn't spend a rewrite but a changed set,
 * rep, RPE or exercise does.
 */
export function digestBlock(input: {
  block: DigestBlock;
  weeks: DigestWeek[];
  days: DigestDay[];
  rows: DigestRow[];
  context?: DigestContext;
}): { text: string; hash: string; hasTraining: boolean; weekIndexes: number[]; shapes: WeekShape[]; blockWords: string } {
  const { block, context } = input;
  const weeks = input.weeks.slice().sort((a, b) => a.week_index - b.week_index);
  const rows = input.rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const daysByWeek = new Map<string, DigestDay[]>();
  for (const d of input.days) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }
  const rowsByDay = new Map<string, DigestRow[]>();
  for (const r of rows) {
    const list = rowsByDay.get(r.day_id) ?? [];
    list.push(r);
    rowsByDay.set(r.day_id, list);
  }

  const meetLine = (() => {
    const m = context?.meet;
    if (!m?.date) return "";
    const end = block.end_date ?? (block.start_date && weeks.length ? addDaysIso(block.start_date, weeks.length * (block.week_duration_days ?? 7) - 1) : null);
    if (!end) return `Competition: ${m.name ?? "meet"} on ${m.date}.`;
    const daysAfter = Math.round((Date.parse(`${m.date}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / DAY_MS);
    const when =
      daysAfter < -7 * weeks.length ? "before this block starts"
      : daysAfter < 0 ? "during this block"
      : daysAfter === 0 ? "on the last day of this block"
      : `${Math.ceil(daysAfter / 7)} week${Math.ceil(daysAfter / 7) === 1 ? "" : "s"} after this block ends`;
    return `Competition: ${m.name ?? "meet"} on ${m.date} (${when}).`;
  })();

  const head = [
    `Block: "${block.name}"`,
    block.goal ? `Coach's goal: ${block.goal}` : "",
    block.training_focus ? `Coach's training focus: ${block.training_focus}` : "",
    `Length: ${weeks.length} week${weeks.length === 1 ? "" : "s"}${block.start_date ? `, ${block.start_date} to ${block.end_date ?? "?"}` : ""}`,
    context?.position ? `Program position: block ${context.position.index} of ${context.position.of}` : "",
    context?.previousBlock ? `Previous block: "${context.previousBlock}"` : "",
    context?.nextBlock ? `Next block: "${context.nextBlock}"` : "",
    meetLine,
  ].filter(Boolean);

  const weekParts: string[] = [];
  const hashParts: string[] = [`v${ROADMAP_PROMPT_VERSION}`, block.goal ?? "", block.training_focus ?? "", meetLine.replace(/ on \d{4}-\d{2}-\d{2}/, "")];
  let hasTraining = false;
  let prev: WeekStats | null = null;
  const shapes: WeekShape[] = [];
  for (const w of weeks) {
    const days = (daysByWeek.get(w.id) ?? []).slice().sort((a, b) => a.day_index - b.day_index);
    const wRows = days.flatMap((d) => rowsByDay.get(d.id) ?? []);
    if (wRows.length) hasTraining = true;
    const s = weekStats(days, wRows);
    const prevStats = prev;
    prev = s;
    shapes.push(weekShape(w, s, prevStats, (context?.position?.index ?? 1) > 1));
    const dates = weekDates(block, w);
    const lines = [`Week ${w.week_index}${dates ? ` (${dates.start} to ${dates.end})` : ""}${w.phase ? ` [coach's phase: ${w.phase}]` : ""}: ${statsLine(s, prevStats)}`];
    for (const d of days) {
      const dr = rowsByDay.get(d.id) ?? [];
      const title = clean(d.title) ?? clean(d.subtitle) ?? clean(d.focus);
      lines.push(`  Day ${d.day_index}${title ? ` "${title}"` : ""}: ${dr.length ? dr.map(rowLine).join("; ") : "no exercises"}`);
    }
    weekParts.push(lines.join("\n"));
    hashParts.push(`${w.week_index}|${w.phase ?? ""}|${days.map((d) => (rowsByDay.get(d.id) ?? []).map(rowLine).join(";")).join("/")}`);
  }

  let body = weekParts.join("\n");
  if (head.join("\n").length + body.length > MAX_DIGEST) {
    // Long blocks: keep every week's numbers, list exercises only for the
    // first and last weeks (the shape of the block is in the numbers).
    body = weeks
      .map((w, i) => (i === 0 || i === weeks.length - 1 ? weekParts[i] : weekParts[i].split("\n")[0]))
      .join("\n")
      .slice(0, MAX_DIGEST);
  }
  return {
    text: `${head.join("\n")}\n\n${body}`,
    hash: hashText(hashParts.join("\n")),
    hasTraining,
    weekIndexes: weeks.map((w) => w.week_index),
    shapes,
    blockWords: [block.training_focus, block.goal, block.name].filter(Boolean).join(" / "),
  };
}

// ---------------------------------------------------------------------------
// Cleo's reply

export const ROADMAP_STYLES = ["powerlifting", "meet_prep", "strength", "hypertrophy", "bodybuilding", "general_fitness"] as const;

const short = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").replace(/(\d)\s*[—–]\s*(?=\d)/g, "$1 to ").replace(/\s*[—–]\s*/g, ", ").trim())
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1).replace(/[\s,.;:]+\S*$/, "")}…` : s));

const replySchema = z.object({
  style: z.string().transform((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_")),
  label: short(40),
  purpose: short(260),
  weeks: z
    .array(z.object({ week: z.coerce.number().int(), label: short(32), focus: short(170) }))
    .default([]),
});

/** Week totals or averages leaking into athlete text ("96 working sets", "average RPE 8.3"). */
export function quotesTotals(text: string): boolean {
  return /\b([2-9]\d|\d{3,})\s+(working\s+|total\s+|hard\s+)?sets\b|\b\d+\s+exercises\b|\baverage\b/i.test(text);
}

export type RoadmapReply = {
  style: (typeof ROADMAP_STYLES)[number];
  label: string;
  purpose: string;
  weeks: Array<{ week: number; label: string; focus: string }>;
};

/** Cleo's JSON, checked: known style, non-empty text, only the block's real weeks, one entry each. */
export function parseRoadmapReply(text: string, weekIndexes: number[]): RoadmapReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.label || !r.purpose) return null;
  if ([r.purpose, ...r.weeks.map((w) => w.focus)].some(quotesTotals)) return null;
  const style = (ROADMAP_STYLES as readonly string[]).includes(r.style) ? (r.style as RoadmapReply["style"]) : "general_fitness";
  const valid = new Set(weekIndexes);
  const seen = new Set<number>();
  const weeks = r.weeks.filter((w) => {
    if (!valid.has(w.week) || seen.has(w.week) || !w.label || !w.focus) return false;
    seen.add(w.week);
    return true;
  });
  return { style, label: r.label, purpose: r.purpose, weeks };
}

export const ROADMAP_SYSTEM_PROMPT = `You are Cleo, the assistant to the strength coaches at JF Effect. A coach has already written this training block. You write the few words the athlete reads about it on their phone: what this part of their program is for, and what each week is like. Most athletes aren't coaches: anyone who lifts should get it in one read.

Rules:
- Describe only what the program data shows. Never invent exercises, numbers, dates, goals, injuries or meet details.
- Never prescribe, add or change training. You explain the coach's plan; you don't edit it.
- Read the structure like an experienced strength coach (how sets, reps, effort and loads move from week to week: building up, getting heavier, a lighter week to recover, a test or heavy singles, a taper before a meet), then say it in everyday words.
- Plain words only. No numbers or percentages at all (the app shows the dates, weeks and the workouts themselves). Never use: RPE, RIR, top set, back-off, volume, intensity, intensification, accumulation, specific, specificity, SBD, deload, pivot, realization, hypertrophy, periodization, fatigue, stimulus, calibration, consolidation, benchmark, cap. Say it the way you'd tell a friend at the gym: lighter, heavier, more sets, fewer sets, easier, harder, the main lifts (or squat, bench and deadlift), build muscle, get stronger, recover, the meet.
- If the coach gave a goal, focus or week phase, keep its meaning and say it in plain words: "Accumulation 2" is "Build", "Deload" is "Lighter week", "Intensification" is "Heavier", "Realization" is "Peak".
- Second person ("you"). Short, calm and confident. No hype, no emojis, no dashes, no filler.

Pick "style" from: powerlifting, meet_prep, strength, hypertrophy, bodybuilding, general_fitness. Use meet_prep only when a competition date is given.

Reply with JSON only, no markdown:
{"style": "...", "label": "2 to 4 plain words for this part of the program, e.g. Back to the main lifts, Build a base, Build muscle, Get stronger, Peak for the meet, Taper", "purpose": "1 short sentence, at most 110 characters: what this part does for you", "weeks": [{"week": 1, "label": "1 to 3 plain words, e.g. Ease in, Build, A bit heavier, Hardest week, Lighter week, Test week, Meet week", "focus": "1 short sentence, at most 90 characters: what this week is like, compared with the week before"}]}
Include every week listed, using its week number.`;

// ---------------------------------------------------------------------------
// Plain words: what the athlete reads is checked in code, never trusted as written

/** A week's shape, read from its prescriptions: what the plain fallback says when Cleo's words don't pass. */
export type WeekShape = {
  week: number;
  phase: string | null;
  /** The block's first week: "first" opens the program, "next" opens a later block. */
  start: "first" | "next" | null;
  volume: "same" | "more" | "less" | "much_less" | null;
  heavier: boolean;
};

function weekShape(w: DigestWeek, s: WeekStats, prev: WeekStats | null, laterBlock: boolean): WeekShape {
  let volume: WeekShape["volume"] = null;
  if (prev && prev.sets > 0) {
    const change = (s.sets - prev.sets) / prev.sets;
    volume = change <= -0.3 ? "much_less" : change <= -0.08 ? "less" : change >= 0.08 ? "more" : "same";
  }
  const up = (a: number | null, b: number | null, by: number) => a != null && b != null && a >= b + by;
  const heavier = !!prev && (up(s.rpeMax, prev.rpeMax, 0.5) || up(s.pctMax, prev.pctMax, 2) || up(prev.rirMin, s.rirMin, 1));
  return { week: w.week_index, phase: clean(w.phase), start: prev ? null : laterBlock ? "next" : "first", volume, heavier };
}

/** Words an athlete shouldn't have to learn to read their own plan. */
const JARGON =
  /\b(?:rpe|rir|e?1rm|amrap|top[\s_-]?sets?|back[\s_-]?offs?|volume|intensit(?:y|ies)|intensif\w*|accumulat\w*|(?:re-?)?specific(?:ity)?|caps?|sbd|deloads?|pivot|reali[sz]ation|hypertrophy|periodi[sz]\w*|fatigue|stimulus|calibrat\w*|consolidat\w*|benchmark\w*|mesocycle|microcycle|tempo)\b/i;

/** What's wrong with one piece of athlete text, in words Cleo can act on. Empty = fine. */
export function plainProblems(text: string | null | undefined, max: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return ["it's empty"];
  const out: string[] = [];
  if (/\d/.test(t)) out.push("it has a number in it");
  const jargon = t.match(JARGON);
  if (jargon) out.push(`it uses "${jargon[0]}"`);
  if (/_/.test(t)) out.push("it has a code word in it");
  if (t.length > max) out.push(`it's longer than ${max} characters`);
  return out;
}

export const PLAIN_MAX = { label: 32, purpose: 130, weekLabel: 24, focus: 110 } as const;

/** Every problem in a reply, named by where it is ("week 2 focus: it uses \"RPE\""). */
export function replyProblems(r: RoadmapReply): string[] {
  const out: string[] = [];
  const add = (where: string, ps: string[]) => ps.forEach((p) => out.push(`${where}: ${p}`));
  add("label", plainProblems(r.label, PLAIN_MAX.label));
  add("purpose", plainProblems(r.purpose, PLAIN_MAX.purpose));
  for (const w of r.weeks) {
    add(`week ${w.week} label`, plainProblems(w.label, PLAIN_MAX.weekLabel));
    add(`week ${w.week} focus`, plainProblems(w.focus, PLAIN_MAX.focus));
  }
  return out;
}

/** What a week is, in plain words, from its phase and how it changed: never a number or a coaching term. */
export function plainWeekWords(shape: WeekShape): { label: string; focus: string } {
  const p = (shape.phase ?? "").toLowerCase();
  if (/(?:meet|competition)\s*(?:week|day)/.test(p)) return { label: "Meet week", focus: "Stay sharp and rested. It's meet week." };
  if (/taper/.test(p)) return { label: "Taper", focus: "Less work so you feel fresh for the meet." };
  if (/deload|pivot|low[\s-]?fatigue|recover|unload|lighter/.test(p) || shape.volume === "much_less")
    return { label: "Lighter week", focus: "Less work this week so you recover and come back stronger." };
  if (/peak|reali[sz]|opener|single/.test(p)) return { label: "Peak", focus: "Heavier lifts and fewer reps to get you ready." };
  if (/\btest|benchmark|\bmax\b/.test(p)) return { label: "Test week", focus: "A chance to see how strong you are right now." };
  if (shape.start === "first") return { label: "Ease in", focus: "Learn the workouts and find good weights to start with." };
  if (shape.start === "next") return { label: "New phase", focus: "A new part of your program starts this week." };
  if (shape.heavier) return { label: "A bit heavier", focus: "Same idea as last week, a little heavier." };
  if (shape.volume === "more") return { label: "Build", focus: "A few more sets than last week." };
  if (shape.volume === "less") return { label: "A bit less", focus: "Slightly less work than last week." };
  return { label: "Keep building", focus: "Same plan as last week. Keep it smooth and steady." };
}

/** What a block is, in plain words, from the coach's name and focus for it; null when nothing reads clearly. */
export function plainBlockLabel(words: string, meet: boolean): string | null {
  const t = words.toLowerCase();
  if (/taper/.test(t)) return "Taper";
  if (/peak|reali[sz]/.test(t)) return meet ? "Peak for the meet" : "Peak";
  if (/deload|recover/.test(t)) return "Lighter phase";
  if (/hypertroph|muscle|bodybuild/.test(t)) return "Build muscle";
  if (/intensif|strength|heavy/.test(t)) return "Get stronger";
  if (/accumul|volume|base|foundation|build/.test(t)) return "Build a base";
  if (/re-?intro|specific|technique|skill/.test(t)) return "Practice the main lifts";
  return null;
}

/**
 * Cleo's reply with anything that doesn't read plainly swapped for words that do: a week from its
 * own shape, the block's name from the coach's words (or nothing), its purpose left out. What the
 * athlete reads is always plain, whatever the model wrote.
 */
export function plainReply(r: RoadmapReply, digest: { shapes: WeekShape[]; blockWords: string }, meet = false): RoadmapReply {
  const label = plainProblems(r.label, PLAIN_MAX.label).length ? plainBlockLabel(digest.blockWords, meet) ?? "" : r.label;
  const purpose = plainProblems(r.purpose, PLAIN_MAX.purpose).length ? "" : r.purpose;
  const byWeek = new Map(r.weeks.map((w) => [w.week, w]));
  const weeks = digest.shapes.map((shape) => {
    const w = byWeek.get(shape.week);
    const fallback = plainWeekWords(shape);
    return {
      week: shape.week,
      label: w && !plainProblems(w.label, PLAIN_MAX.weekLabel).length ? w.label : fallback.label,
      focus: w && !plainProblems(w.focus, PLAIN_MAX.focus).length ? w.focus : fallback.focus,
    };
  });
  return { style: r.style, label, purpose, weeks };
}

// ---------------------------------------------------------------------------
// The athlete's program roadmap (client side)

export type RoadmapStatus = "completed" | "current" | "upcoming";

export type RoadmapWeekView = {
  id: string;
  index: number;
  start: string | null;
  end: string | null;
  status: RoadmapStatus;
  label: string | null;
  focus: string | null;
};

export type RoadmapBlockView = {
  id: string;
  name: string;
  status: RoadmapStatus;
  start: string | null;
  end: string | null;
  weekCount: number;
  weeks: RoadmapWeekView[];
  label: string | null;
  purpose: string | null;
  style: string | null;
  byCoach: boolean;
};

export type ProgramStatus = "active" | "upcoming" | "completed";

/** One program (a pl_preps record, or a run of blocks with no program record). */
export type ProgramSummary = {
  id: string;
  title: string | null;
  status: ProgramStatus;
  start: string | null;
  end: string | null;
  blockCount: number;
  totalWeeks: number;
};

export type ProgramRoadmap = {
  /** Every program, newest first; the selector lists these. */
  programs: ProgramSummary[];
  /** The program shown: the one asked for, else the current one. */
  program: ProgramSummary;
  /** The program today belongs to (what the selector defaults to). */
  defaultProgramId: string;
  /** Blocks of the shown program only, numbered from 1. */
  blocks: RoadmapBlockView[];
  /** Every live block's view by id, including ones from other programs (Block View's picker shows them all). */
  byBlock: Record<string, RoadmapBlockView>;
  /** The block today falls in (or the next one, between blocks). */
  currentBlockId: string | null;
  /** 1-based position of today's week across the whole program. */
  programWeek: number | null;
  totalWeeks: number;
  start: string | null;
  end: string | null;
  meet: { name: string | null; date: string; daysOut: number } | null;
};

type RBlock = {
  id: string;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  weeks?: number | null;
  week_duration_days?: number | null;
  status?: string | null;
  archived?: boolean | null;
  prep_id?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
};
type RWeek = {
  id: string;
  block_id: string;
  week_index: number;
  start_date?: string | null;
  end_date?: string | null;
  manually_completed?: boolean | null;
};
type RPrep = {
  id: string;
  title?: string | null;
  status?: string | null;
  archived?: boolean | null;
  event_name?: string | null;
  event_date?: string | null;
};

/** Blocks with no program record that are more than this many days apart are separate programs. */
const PROGRAM_GAP_DAYS = 14;

const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);

function blockEnd(b: RBlock, weekCount: number): string | null {
  if (b.end_date) return b.end_date.slice(0, 10);
  if (!b.start_date || !weekCount) return null;
  return addDaysIso(b.start_date, weekCount * (b.week_duration_days ?? 7) - 1);
}

function statusFor(start: string | null, end: string | null, today: string, fallback: RoadmapStatus): RoadmapStatus {
  if (end && end < today) return "completed";
  if (start && start > today) return "upcoming";
  if (start || end) return "current";
  return fallback;
}

/**
 * "Jared McIntyre — 28 Week Off-Season Development" → "28 Week Off-Season
 * Development": coaches prefix programs with the athlete's name, which the
 * athlete doesn't need to read on their own page.
 */
export function programTitle(title: string | null | undefined, ownerName?: string | null): string | null {
  const t = clean(title);
  if (!t) return null;
  const parts = t.split(/\s+[—–-]\s+/);
  const first = clean(ownerName)?.split(/\s+/)[0]?.toLowerCase();
  if (parts.length > 1 && first && parts[0].toLowerCase().startsWith(first)) {
    return clean(parts.slice(1).join(" — ")) ?? t;
  }
  return t;
}

/**
 * A program's name as a heading: "Apex Hypertrophy — Advanced–Elite • 3-Day •
 * Bodybuilding" → "Apex Hypertrophy". The part after the dash is only the
 * level, days and style (it holds a "•"), which the athlete already knows and
 * which cut the heading off on a phone; a name whose second part is words
 * ("2027 Canadian Nationals Prep", "Girl Pop Lower Body Build — 12 Week
 * Bodybuilding Focus") stays whole. The program list keeps the full name.
 */
export function programShortName(title: string | null | undefined): string | null {
  const t = clean(title);
  if (!t) return null;
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(t);
  if (m && /[•·]/.test(m[2]) && clean(m[1])) return clean(m[1]);
  return t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2027-01-10" → "Jan 10" (a date-only value is that calendar day). */
function shortDay(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null;
}

/** How far off a meet is, in the words the card uses. */
export function meetWords(daysOut: number): string {
  if (daysOut <= 0) return "Meet day";
  if (daysOut === 1) return "Meet tomorrow";
  if (daysOut < 14) return `Meet in ${daysOut} days`;
  return `Meet in ${Math.round(daysOut / 7)} weeks`;
}

/**
 * The program card's one progress line, under the program's name: the
 * program's own week and where it ends ("Week 5 of 12 · Ends Jan 10"), the
 * meet instead of the end when there is one ("Week 5 of 12 · Meet in 8
 * weeks"), "Starts Nov 30 · 12 weeks" before it starts, "Finished Jan 10"
 * after. It's the only week number on the card: the block below is named, not
 * counted in weeks again.
 */
export function roadmapProgressLine(r: Pick<ProgramRoadmap, "programWeek" | "totalWeeks" | "start" | "end" | "meet">, today: string): string {
  const p = roadmapProgressParts(r, today);
  return [p.where, p.until].filter(Boolean).join(" · ");
}

/** The progress line in its two parts (where in the program, and until when), so a meet can carry its flag. */
export function roadmapProgressParts(
  r: Pick<ProgramRoadmap, "programWeek" | "totalWeeks" | "start" | "end" | "meet">,
  today: string,
): { where: string | null; until: string | null; meet: boolean } {
  const weeks = r.totalWeeks ? `${r.totalWeeks} week${r.totalWeeks === 1 ? "" : "s"}` : null;
  if (r.end && r.end < today) return { where: `Finished ${shortDay(r.end) ?? ""}`.trim(), until: null, meet: false };
  if (r.start && r.start > today) return { where: `Starts ${shortDay(r.start) ?? "soon"}`, until: weeks, meet: false };
  const where = r.programWeek && r.totalWeeks ? `Week ${Math.min(r.programWeek, r.totalWeeks)} of ${r.totalWeeks}` : weeks;
  if (r.meet) return { where, until: meetWords(r.meet.daysOut), meet: true };
  return { where, until: shortDay(r.end) ? `Ends ${shortDay(r.end)}` : null, meet: false };
}

/**
 * "Block 1 — Volume 5s/7s" → { tag: "Block 1", name: "Volume 5s/7s" }: coaches
 * number their blocks in the name, which reads better as a small tag beside
 * the block's own name than as one long line. A name without that prefix is
 * all name ({ tag: null }).
 */
export function blockNameParts(blockName: string | null | undefined): { tag: string | null; name: string } | null {
  const t = clean(blockName);
  if (!t) return null;
  const m = /^(block\s*\d+)\s*[—–:-]\s*(.+)$/i.exec(t);
  if (!m) return { tag: null, name: t };
  return { tag: m[1].replace(/\s+/g, " ").replace(/^block/i, "Block"), name: m[2].trim() };
}

/**
 * One program's roadmap. A program is a pl_preps record: its blocks, and only
 * its blocks, are numbered, counted and dated together, so a finished meet
 * prep never pads the next program's "Week 3 of 28". Blocks without a program
 * record are grouped by date among themselves. `programId` picks a program
 * to look at (read-only); by default it's the one today falls in.
 * `today` is the athlete's local "YYYY-MM-DD".
 */
export function buildProgramRoadmap(input: {
  blocks: RBlock[];
  weeks: RWeek[];
  notes: RoadmapNoteRow[];
  preps?: RPrep[];
  today: string;
  programId?: string | null;
  ownerName?: string | null;
}): ProgramRoadmap | null {
  const { today } = input;
  const weeksByBlock = new Map<string, RWeek[]>();
  for (const w of input.weeks) {
    const list = weeksByBlock.get(w.block_id) ?? [];
    list.push(w);
    weeksByBlock.set(w.block_id, list);
  }
  const blockNote = new Map<string, RoadmapNoteRow>();
  const weekNote = new Map<string, RoadmapNoteRow>();
  for (const n of input.notes) {
    if (n.week_id) weekNote.set(n.week_id, n);
    else blockNote.set(n.block_id, n);
  }

  const live = input.blocks
    .filter((b) => b && !b.archived && b.status !== "Archived")
    .slice()
    .sort((a, b) => {
      const sa = a.start_date ?? "9999";
      const sb = b.start_date ?? "9999";
      if (sa !== sb) return sa < sb ? -1 : 1;
      if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });

  const views: Array<RoadmapBlockView & { prep: string | null }> = live.map((b) => {
    const ws = (weeksByBlock.get(b.id) ?? []).slice().sort((x, y) => x.week_index - y.week_index);
    const weekCount = ws.length || b.weeks || 0;
    const start = b.start_date ? b.start_date.slice(0, 10) : null;
    const end = blockEnd(b, weekCount);
    const stored = String(b.status ?? "").toLowerCase();
    const status = stored === "completed" ? "completed" : statusFor(start, end, today, stored === "active" ? "current" : "upcoming");
    const note = noteText(blockNote.get(b.id));
    const weeks: RoadmapWeekView[] = ws.map((w) => {
      const d = weekDates({ id: b.id, name: "", start_date: start, end_date: end, week_duration_days: b.week_duration_days }, w);
      const wn = noteText(weekNote.get(w.id));
      const ws2: RoadmapStatus =
        status === "completed" || w.manually_completed ? "completed" : statusFor(d?.start ?? null, d?.end ?? null, today, "upcoming");
      return { id: w.id, index: w.week_index, start: d?.start ?? null, end: d?.end ?? null, status: ws2, label: wn.label, focus: wn.summary };
    });
    const n = blockNote.get(b.id);
    return {
      id: b.id,
      name: (b.name ?? "").trim() || "Block",
      status,
      start,
      end,
      weekCount,
      weeks,
      label: note.label,
      purpose: note.summary,
      style: n && !n.hidden ? n.ai_style ?? null : null,
      byCoach: note.byCoach,
      prep: b.prep_id ?? null,
    };
  });

  // Split into programs: by program record first; blocks without one are
  // grouped by date among themselves and never join a recorded program.
  const prepById = new Map((input.preps ?? []).map((p) => [p.id, p]));
  const groups = new Map<string, typeof views>();
  let solo: typeof views | null = null;
  for (const v of views) {
    if (v.prep) {
      const key = `prep:${v.prep}`;
      groups.set(key, [...(groups.get(key) ?? []), v]);
      continue;
    }
    const prev = solo?.[solo.length - 1];
    const close = !!prev && (!v.start || !prev.end || dayNum(v.start) - dayNum(prev.end) <= PROGRAM_GAP_DAYS);
    if (solo && close) solo.push(v);
    else {
      solo = [v];
      groups.set(`blocks:${v.id}`, solo);
    }
  }
  if (!groups.size) return null;

  const summaries: ProgramSummary[] = [...groups.entries()].map(([id, bs]) => {
    const prep = id.startsWith("prep:") ? prepById.get(id.slice(5)) : undefined;
    const stored = String(prep?.status ?? "").toLowerCase();
    const allDone = bs.every((b) => b.status === "completed");
    const status: ProgramStatus =
      allDone || stored === "completed" || stored === "archived" || prep?.archived
        ? "completed"
        : bs.some((b) => b.status === "current")
          ? "active"
          : bs.every((b) => b.status === "upcoming")
            ? "upcoming"
            : "active";
    return {
      id,
      // A one-block program with no program record (a library plan or a
      // program someone built, started on its own) is called by its block.
      title:
        programTitle(prep?.title, input.ownerName) ??
        (!prep && bs.length === 1 && bs[0].name !== "Block" ? blockNameParts(bs[0].name)?.name ?? null : null),
      status,
      start: bs.find((b) => b.start)?.start ?? null,
      end: [...bs].reverse().find((b) => b.end)?.end ?? null,
      blockCount: bs.length,
      totalWeeks: bs.reduce((a, b) => a + b.weekCount, 0),
    };
  });
  const byStart = (a: ProgramSummary, b: ProgramSummary) => String(a.start ?? "9999").localeCompare(String(b.start ?? "9999"));
  const pickDefault =
    summaries.find((p) => p.status === "active" && groups.get(p.id)!.some((b) => b.status === "current")) ??
    summaries.filter((p) => p.status === "active").sort(byStart)[0] ??
    summaries.filter((p) => p.status === "upcoming").sort(byStart)[0] ??
    summaries.slice().sort(byStart)[summaries.length - 1];
  const program = summaries.find((p) => p.id === input.programId) ?? pickDefault;
  const pick = groups.get(program.id) ?? [];
  // Newest first; the current program leads.
  const programs = summaries
    .slice()
    .sort((a, b) => (a.id === pickDefault.id ? -1 : b.id === pickDefault.id ? 1 : byStart(b, a)));

  const blocks: RoadmapBlockView[] = pick.map(({ prep: _prep, ...rest }) => rest);
  const current =
    program.status === "completed"
      ? null
      : blocks.find((b) => b.status === "current") ?? blocks.find((b) => b.status === "upcoming") ?? null;

  let programWeek: number | null = null;
  let counted = 0;
  for (const b of blocks) {
    const idx = b.weeks.findIndex((w) => w.status === "current");
    if (b.status === "current" && idx >= 0) {
      programWeek = counted + idx + 1;
      break;
    }
    counted += b.weekCount;
  }
  const totalWeeks = program.totalWeeks;

  const prepId = program.id.startsWith("prep:") ? program.id.slice(5) : null;
  const m = prepId ? prepById.get(prepId) : undefined;
  const meetDate = m?.event_date && m.event_date.slice(0, 10) >= today ? m.event_date.slice(0, 10) : null;

  const byBlock: Record<string, RoadmapBlockView> = {};
  for (const { prep: _prep, ...rest } of views) byBlock[rest.id] = rest;

  return {
    programs,
    program,
    defaultProgramId: pickDefault.id,
    blocks,
    byBlock,
    currentBlockId: current?.id ?? null,
    programWeek,
    totalWeeks,
    start: program.start,
    end: program.end,
    meet: meetDate ? { name: clean(m?.event_name), date: meetDate, daysOut: dayNum(meetDate) - dayNum(today) } : null,
  };
}
