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
  rpeMax: number | null;
  rpeAvg: number | null;
  pctMin: number | null;
  pctMax: number | null;
  repsMin: number | null;
  repsMax: number | null;
};

function nums(text: string | null | undefined): number[] {
  return (String(text ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function weekStats(days: DigestDay[], rows: DigestRow[]): WeekStats {
  const dayIds = new Set(days.map((d) => d.id));
  const mine = rows.filter((r) => dayIds.has(r.day_id));
  let sets = 0;
  let compSets = 0;
  const rpes: number[] = [];
  const pcts: number[] = [];
  const reps: number[] = [];
  for (const r of mine) {
    const s = r.sets && r.sets > 0 ? r.sets : 1;
    sets += s;
    if (r.exercise?.is_competition_lift) compSets += s;
    const rpe = nums(r.rpe).filter((n) => n >= 4 && n <= 10);
    if (rpe.length) rpes.push(Math.max(...rpe));
    else {
      const rir = nums(r.rir).filter((n) => n >= 0 && n <= 6);
      if (rir.length) rpes.push(10 - Math.min(...rir));
    }
    if (r.percentage != null && r.percentage > 0) pcts.push(r.percentage);
    const rp = nums(r.reps_text).filter((n) => n >= 1 && n <= 100);
    reps.push(...rp);
  }
  return {
    days: days.length,
    exercises: mine.length,
    sets,
    compSets,
    rpeMax: rpes.length ? Math.max(...rpes) : null,
    rpeAvg: rpes.length ? round1(rpes.reduce((a, b) => a + b, 0) / rpes.length) : null,
    pctMin: pcts.length ? Math.min(...pcts) : null,
    pctMax: pcts.length ? Math.max(...pcts) : null,
    repsMin: reps.length ? Math.min(...reps) : null,
    repsMax: reps.length ? Math.max(...reps) : null,
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

function statsLine(s: WeekStats): string {
  const parts = [
    `${s.days} training day${s.days === 1 ? "" : "s"}`,
    `${s.exercises} exercises`,
    `${s.sets} working sets`,
    s.compSets ? `${s.compSets} on competition lifts` : "",
    s.rpeMax != null ? `RPE avg ${s.rpeAvg}, top ${s.rpeMax}` : "",
    s.pctMin != null ? `${s.pctMin === s.pctMax ? s.pctMax : `${s.pctMin}-${s.pctMax}`}% loads` : "",
    s.repsMin != null ? `reps ${s.repsMin === s.repsMax ? s.repsMax : `${s.repsMin}-${s.repsMax}`}` : "",
  ];
  return parts.filter(Boolean).join(", ");
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
export const ROADMAP_PROMPT_VERSION = 2;

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
}): { text: string; hash: string; hasTraining: boolean; weekIndexes: number[] } {
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
  for (const w of weeks) {
    const days = (daysByWeek.get(w.id) ?? []).slice().sort((a, b) => a.day_index - b.day_index);
    const wRows = days.flatMap((d) => rowsByDay.get(d.id) ?? []);
    if (wRows.length) hasTraining = true;
    const s = weekStats(days, wRows);
    const dates = weekDates(block, w);
    const lines = [`Week ${w.week_index}${dates ? ` (${dates.start} to ${dates.end})` : ""}${w.phase ? ` [coach's phase: ${w.phase}]` : ""}: ${statsLine(s)}`];
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
  };
}

// ---------------------------------------------------------------------------
// Cleo's reply

export const ROADMAP_STYLES = ["powerlifting", "meet_prep", "strength", "hypertrophy", "bodybuilding", "general_fitness"] as const;

const short = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").replace(/\s*[—–]\s*/g, ", ").trim())
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1).replace(/[\s,.;:]+\S*$/, "")}…` : s));

const replySchema = z.object({
  style: z.string().transform((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_")),
  label: short(40),
  purpose: short(260),
  weeks: z
    .array(z.object({ week: z.coerce.number().int(), label: short(32), focus: short(170) }))
    .default([]),
});

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

export const ROADMAP_SYSTEM_PROMPT = `You are Cleo, the assistant to the strength coaches at JF Effect. A coach has already written this training block. You write the short explanations the athlete reads on their phone: what this block is for, and what each week focuses on.

Rules:
- Describe only what the program data shows. Never invent exercises, numbers, dates, goals, injuries or meet details. If something isn't in the data, leave it out.
- Never prescribe, add or change training. You explain the coach's plan; you don't edit it.
- Read the structure like an experienced strength coach: how sets, reps, RPE/RIR and percentages move from week to week (volume building, intensity rising, a deload, a heavy single/test week, a taper before a meet), how much is competition squat/bench/deadlift versus accessories, and rep ranges.
- If the coach gave a goal, focus or week phase, follow it and use their wording.
- Style: plain, specific, confident. Second person ("you"). No hype, no emojis, no em dashes, no filler like "this is a great week".
- Numbers you mention must appear in the data, and only as prescriptions the athlete will see on their workouts: "top sets at RPE 8", "1 to 2 RIR", "sets of 8 to 12", "around 80%". Never quote the week's totals or averages (total working sets, exercise counts, "average RPE"); the stats are for your reading only. Say how the week changes in plain words instead: "same volume as last week", "about a third fewer sets", "sets taken to 0 to 1 RIR".

Pick "style" from: powerlifting, meet_prep, strength, hypertrophy, bodybuilding, general_fitness. Use meet_prep only when a competition date is given.

Reply with JSON only, no markdown:
{"style": "...", "label": "1 to 3 word phase name, e.g. Hypertrophy, Strength Base, Intensification, Peak, Taper, Deload", "purpose": "1 to 2 sentences, at most 240 characters: what this block builds and why it sits here in the program", "weeks": [{"week": 1, "label": "2 to 4 words, e.g. Intro week, Volume build, Heaviest week, Deload, Meet week", "focus": "1 sentence, at most 160 characters: what this week asks of you and how it differs from the week before"}]}
Include every week listed, using its week number.`;

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

export type ProgramRoadmap = {
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
type RPrep = { id: string; event_name?: string | null; event_date?: string | null };

/** Blocks more than this many days apart are separate programs. */
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
 * The program around today: the run of blocks with no more than two weeks
 * between them (a prep's blocks always stay together), each with its weeks,
 * statuses and words. `today` is the athlete's local "YYYY-MM-DD".
 */
export function buildProgramRoadmap(input: {
  blocks: RBlock[];
  weeks: RWeek[];
  notes: RoadmapNoteRow[];
  preps?: RPrep[];
  today: string;
}): ProgramRoadmap {
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

  // Split into programs.
  const groups: Array<typeof views> = [];
  for (const v of views) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const samePrep = !!prev && !!v.prep && prev.prep === v.prep;
    const close =
      !!prev && (!v.start || !prev.end || dayNum(v.start) - dayNum(prev.end) <= PROGRAM_GAP_DAYS);
    if (g && (samePrep || close)) g.push(v);
    else groups.push([v]);
  }

  const pick =
    groups.find((g) => g.some((b) => b.status === "current")) ??
    groups.find((g) => g.some((b) => b.status === "upcoming")) ??
    groups[groups.length - 1] ??
    [];

  const blocks: RoadmapBlockView[] = pick.map(({ prep: _prep, ...rest }) => rest);
  const current = blocks.find((b) => b.status === "current") ?? blocks.find((b) => b.status === "upcoming") ?? null;

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
  const totalWeeks = blocks.reduce((a, b) => a + b.weekCount, 0);

  const preps = new Map((input.preps ?? []).map((p) => [p.id, p]));
  const meets = pick
    .map((b) => (b.prep ? preps.get(b.prep) : undefined))
    .filter((p): p is RPrep => !!p?.event_date && p.event_date.slice(0, 10) >= today)
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const m = meets[0];

  const byBlock: Record<string, RoadmapBlockView> = {};
  for (const { prep: _prep, ...rest } of views) byBlock[rest.id] = rest;

  return {
    blocks,
    byBlock,
    currentBlockId: current?.id ?? null,
    programWeek,
    totalWeeks,
    start: blocks.find((b) => b.start)?.start ?? null,
    end: [...blocks].reverse().find((b) => b.end)?.end ?? null,
    meet: m?.event_date
      ? { name: clean(m.event_name), date: m.event_date.slice(0, 10), daysOut: dayNum(m.event_date) - dayNum(today) }
      : null,
  };
}
