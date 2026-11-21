/**
 * Reading a program's structure without AI (Nov 21 2026): blocks, weeks, days
 * and exercises from the layouts people actually use, a heading per week or
 * day with a line per exercise ("Week 3 – Deload", "Day 2: Lower",
 * "Back Squat 3x5 @ RPE 8"), a spreadsheet with column headers (Exercise,
 * Sets, Reps, Load, RPE, Rest…; Week / Day columns or a sheet per week), and
 * the powerlifting sheet with the weeks across (an exercise per row, a column
 * or group of columns per week). It says how much of the file it understood
 * (`coverage`) and only claims the program (`confident`) when it read nearly
 * all of it, every exercise has its sets and reps and nothing looks out of
 * shape; otherwise the AI reads it (program-import-ai.ts). Pure.
 */
import {
  effortRange,
  parsePrescription,
  repsText,
  restSeconds,
  splitPrescriptions,
  unitWord,
  type Rx,
} from "./prescription";
import { expandWeekRanges } from "./weeks";
import type {
  ImportedDay,
  ImportedExercise,
  ImportedProgram,
  ImportedWeek,
  SourceDoc,
  SourceSheet,
  WeightUnit,
} from "./types";

export type ParseOutcome = {
  program: ImportedProgram;
  exercises: number;
  /** Lines / rows with something on them, and how many of those were understood. */
  lines: number;
  understood: number;
  coverage: number;
  /** What it couldn't read, as written (the first few). */
  unread: string[];
  confident: boolean;
  /** Why it isn't confident, when it isn't (for the logs and tests). */
  why: string | null;
};

/* ------------------------------------------------------------------ */
/*  Headings                                                           */
/* ------------------------------------------------------------------ */

const SEP = String.raw`\s*[:.\-–—)]?\s*`;
const WEEK_RANGE_RE = /^(?:weeks?|wks?)\s*#?\s*(\d{1,2})\s*(?:-|–|—|to|through|thru|&|and)\s*(\d{1,2})\b\s*[:.\-–—)]?\s*(.*)$/i;
const WEEK_RE = new RegExp(String.raw`^(?:week|wk|w)\s*#?\s*(\d{1,2})\b${SEP}(.*)$`, "i");
const DELOAD_RE = /^(?:deload|recovery|unload)(?:\s+week)?\b\s*[:.\-–—]?\s*(.*)$/i;
const DAY_RE = new RegExp(String.raw`^(?:day|session|workout|training\s+day)\s*#?\s*(\d{1,2}|[a-g])\b${SEP}(.*)$`, "i");
const WEEKDAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri|sat|sun)\b\s*[:.\-–—]?\s*(.*)$/i;
/** A split's day name: "Upper A", "Push", "Chest & Triceps", "Full Body (B)". Never a lift's name ("Back Squat", "Leg Press"). */
const SPLIT_RE =
  /^(?:(?:upper|lower|push|pull|legs?|full|total|body|arms|chest|back|shoulders|glutes|conditioning|core|biceps|triceps|hamstrings|quads|calves|abs|delts)\b\s*(?:[&/+,]|and)?\s*){1,4}(?:day|session|workout|focus)?\s*(?:[a-d1-4])?\s*(?:\([^)]*\))?\s*:?$/i;
/** "Squat Day", "Heavy Bench Day", "Deadlift Focus": a lift's name only counts with day / focus / session after it. */
const LIFT_DAY_RE =
  /^(?:heavy|light|volume|intensity|max effort|dynamic effort|speed|technique|primary|secondary)?\s*(?:squat|bench|deadlift|press|overhead press|ohp|pull|lower|upper)\s+(?:day|focus|session)\b.{0,30}$/i;
const BLOCK_RE = new RegExp(String.raw`^(?:block|phase|mesocycle|meso|cycle)\s*#?\s*(\w{1,3})?\b${SEP}(.*)$`, "i");
const SHEET_MARK = /^===\s*(.+?)\s*===$/;

type Heading =
  | { kind: "block"; name: string }
  | { kind: "week"; label: string; deload: boolean; n: number | null; repeat?: number }
  | { kind: "day"; title: string };

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() : s);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A line (or a sheet's name) as a heading, when it's one. */
export function headingOf(raw: string): Heading | null {
  const s = raw.replace(/^[#*\s]+|[*\s]+$/g, "").trim();
  if (!s || s.length > 70) return null;
  const range = WEEK_RANGE_RE.exec(s);
  if (range && !/\d\s*(x|×)\s*\d/i.test(range[3])) {
    const a = Number(range[1]);
    const z = Number(range[2]);
    // "Weeks 1 & 2" is two weeks, "Weeks 1-4" four
    const count = /&|and/i.test(s.slice(0, s.indexOf(range[2]))) ? 2 : z - a + 1;
    if (count >= 2 && count <= 24) return { kind: "week", label: cap(s, 40), deload: /deload|unload/i.test(s), n: a, repeat: count };
  }
  let m = WEEK_RE.exec(s);
  if (m && !/\d\s*(x|×)\s*\d/i.test(m[2])) {
    const rest = m[2].trim();
    return { kind: "week", label: cap(s, 40), deload: /deload|unload/i.test(s), n: Number(m[1]) };
  }
  m = DELOAD_RE.exec(s);
  if (m && words(s) <= 6 && !/\d\s*(x|×)\s*\d/i.test(s)) return { kind: "week", label: cap(s, 40), deload: true, n: null };
  m = BLOCK_RE.exec(s);
  if (m && words(s) <= 8 && !/\d\s*(x|×)\s*\d/i.test(s)) return { kind: "block", name: cap(s, 40) };
  m = DAY_RE.exec(s);
  if (m && !/\d\s*(x|×)\s*\d/i.test(m[2])) return { kind: "day", title: cap(s, 40) };
  m = WEEKDAY_RE.exec(s);
  if (m && words(s) <= 6 && !/\d\s*(x|×)\s*\d|%|@/i.test(s)) return { kind: "day", title: cap(s, 40) };
  if (words(s) <= 6 && (SPLIT_RE.test(s) || LIFT_DAY_RE.test(s)) && !/\d\s*(x|×)\s*\d|%|@/.test(s)) return { kind: "day", title: cap(s, 40) };
  return null;
}

/* ------------------------------------------------------------------ */
/*  Building the program                                               */
/* ------------------------------------------------------------------ */

const PROGRESSION_WORDS =
  /\b(add|increase|progress|progression|each week|every week|per week|week to week|week over week|bump|go up|jump|linear|double progression|until you|when you hit|once you)\b/i;

class ProgramBuilder {
  program: ImportedProgram;
  private week: ImportedWeek | null = null;
  private day: ImportedDay | null = null;
  constructor(title: string | null) {
    this.program = { title, notes: null, unit: null, blocks: [], progression: [], issues: [] };
  }
  private curBlock() {
    if (!this.program.blocks.length) this.program.blocks.push({ name: null, weeks: [] });
    return this.program.blocks[this.program.blocks.length - 1];
  }
  block(name: string) {
    // a block heading before anything was added names the first block
    const b = this.program.blocks[this.program.blocks.length - 1];
    if (b && !b.weeks.some((w) => w.days.some((d) => d.exercises.length))) {
      b.name = name;
      b.weeks = [];
    } else this.program.blocks.push({ name, weeks: [] });
    this.week = null;
    this.day = null;
  }
  newWeek(label: string | null, deload: boolean, repeat: number | null = null) {
    const b = this.curBlock();
    // an empty week just named (a sheet called "Week 1" then a "Week 1" line) is reused
    if (this.week && !this.week.days.some((d) => d.exercises.length) && b.weeks[b.weeks.length - 1] === this.week) {
      this.week.label = label ?? this.week.label;
      this.week.deload = this.week.deload || deload;
      this.week.repeat = repeat ?? this.week.repeat ?? null;
      this.week.days = [];
    } else {
      this.week = { label, deload, notes: null, days: [], repeat };
      b.weeks.push(this.week);
    }
    this.day = null;
  }
  newDay(title: string | null) {
    if (!this.week) this.newWeek(null, false);
    if (this.day && !this.day.exercises.length && this.week!.days[this.week!.days.length - 1] === this.day) {
      this.day.title = title ?? this.day.title;
      return;
    }
    this.day = { title, notes: null, exercises: [] };
    this.week!.days.push(this.day);
  }
  /** The day an exercise goes in, made when there's none yet. */
  dayFor(title?: string | null) {
    if (!this.day) this.newDay(title ?? null);
    return this.day!;
  }
  exercise(e: ImportedExercise) {
    this.dayFor().exercises.push(e);
  }
  note(text: string) {
    const t = text.trim();
    if (!t) return;
    if (PROGRESSION_WORDS.test(t)) this.program.progression.push(t);
    else if (this.day) this.day.notes = join(this.day.notes, t);
    else if (this.week) this.week.notes = join(this.week.notes, t);
    else this.program.notes = join(this.program.notes, t);
  }
  get currentDay() {
    return this.day;
  }
}

const join = (a: string | null, b: string) => (a ? `${a}\n${b}` : b);

export function blankExercise(name: string): ImportedExercise {
  return {
    name,
    sets: null,
    reps: null,
    load: null,
    unit: null,
    pct: null,
    pct_of: null,
    rpe: null,
    rir: null,
    tempo: null,
    rest_seconds: null,
    group: null,
    velocity: null,
    notes: null,
    src: null,
    unsure: null,
  };
}

function withRx(e: ImportedExercise, rx: Rx): ImportedExercise {
  const out = { ...e };
  for (const k of ["sets", "reps", "load", "unit", "pct", "pct_of", "rpe", "rir", "tempo", "rest_seconds", "velocity"] as const) {
    if (rx[k] != null && (out as any)[k] == null) (out as any)[k] = rx[k];
  }
  if (rx.basisNote) out.notes = out.notes ? `${rx.basisNote}. ${out.notes}` : rx.basisNote;
  return out;
}

const SENTENCE_START = /^(add|increase|decrease|rest|warm|perform|do|use|keep|take|try|aim|work|start|finish|repeat|go|if|when|after|before|each|every|on|for|the|your|this|note|all)\b/i;
const NAME_OK = (s: string) => /[a-z]{2}/i.test(s) && s.length <= 80;
const LIST_MARK = /^\s*(?:[-•*·▪●–]\s+|\(?(\d{1,2})[.)]\s+|\(?([a-h]\d{1,2})[.):]?\s+|([a-h]\d{1,2})\s*[-–:]\s*)/i;
const RX_START =
  /\b\d{1,2}\s*(?:x|×|\*)\s*(?:\d|amrap|max)|\b\d{1,2}\s*sets?\b|@|\brpe\b|\brir\b|\b\d{1,3}(?:[.,]\d+)?\s*%|\b\d{1,4}(?:[.,]\d+)?\s*(?:kg|kgs|lbs?)\b|\btempo\b|\brest\b/i;

/** One line as exercises (more than one when it holds a top set and its back-offs), or null. */
export function exercisesFromLine(raw: string, unitHint: WeightUnit | null): { list: ImportedExercise[]; leftover: string } | null {
  let line = raw.replace(/ /g, " ").trim();
  let group: string | null = null;
  const mark = LIST_MARK.exec(line);
  if (mark) {
    group = (mark[2] ?? mark[3] ?? null)?.toUpperCase() ?? null;
    line = line.slice(mark[0].length).trim();
  }
  let name = "";
  let rxText = "";
  if (line.includes(" | ")) {
    const cells = line.split(" | ").map((c) => c.trim());
    const ni = cells.findIndex((c) => NAME_OK(c) && !RX_START.test(c) && !/^\d+([.,]\d+)?$/.test(c));
    if (ni < 0) return null;
    name = cells[ni];
    rxText = cells.filter((_, i) => i !== ni).join(" ");
    // bare numbers in a headerless row ("Squat | 3 | 5") read as sets then reps
    const nums = cells.filter((c, i) => i !== ni && /^\d{1,3}$/.test(c));
    if (!/\d\s*(x|×)\s*\d/i.test(rxText) && nums.length >= 2) {
      rxText = `${nums[0]}x${nums[1]} ${cells.filter((c, i) => i !== ni && !nums.slice(0, 2).includes(c)).join(" ")}`;
    }
  } else {
    const m = RX_START.exec(line);
    if (!m || m.index === 0) return null;
    name = line.slice(0, m.index);
    rxText = line.slice(m.index);
  }
  name = name.replace(/[\s:,\-–—(]+$/g, "").replace(/^[\s:,\-–—]+/g, "").trim();
  if (!NAME_OK(name) || words(name) > 7) return null;
  // a sentence that happens to have a number in it ("Add 5 lb to your squat each week") is a note
  if (SENTENCE_START.test(name) || (PROGRESSION_WORDS.test(line) && !/\d\s*(x|×)\s*\d|sets?\b/i.test(line))) return null;
  const parts = splitPrescriptions(rxText);
  const list: ImportedExercise[] = [];
  let leftover = "";
  parts.forEach((p, i) => {
    const { rx, leftover: left } = parsePrescription(p, unitHint);
    let e = withRx(blankExercise(name), rx);
    e.group = group;
    e.src = raw.trim().slice(0, 200);
    if (left && /[a-z]{3}/i.test(left)) e.notes = e.notes ? `${e.notes}. ${left}` : left;
    if (left && /\d/.test(left)) {
      leftover = leftover ? `${leftover}; ${left}` : left;
      e.unsure = `Couldn't read "${cap(left, 60)}"`;
    }
    if (i > 0 && e.pct == null && list[0]) e.notes = e.notes ?? "Back-off sets";
    list.push(e);
  });
  // an exercise says how much: sets and reps, or an effort or intensity with a short name before it
  if (!list.some((e) => e.sets != null || e.reps != null || ((e.rpe != null || e.rir != null || e.pct != null) && words(name) <= 5))) return null;
  return { list, leftover };
}

/* ------------------------------------------------------------------ */
/*  Text                                                               */
/* ------------------------------------------------------------------ */

function unitOf(text: string): WeightUnit | null {
  const kg = (text.match(/\d\s*kgs?\b/gi) ?? []).length;
  const lb = (text.match(/\d\s*(lbs?|pounds)\b/gi) ?? []).length;
  if (kg > lb) return "kg";
  if (lb > kg) return "lb";
  return null;
}

function parseLines(lines: string[], b: ProgramBuilder, unit: WeightUnit | null, acc: Acc) {
  let titleTaken = !!b.program.title;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sheet = SHEET_MARK.exec(line);
    if (sheet) {
      const h = headingOf(sheet[1]);
      if (h) applyHeading(b, h);
      continue;
    }
    acc.lines++;
    const h = headingOf(line);
    if (h) {
      applyHeading(b, h);
      acc.understood++;
      continue;
    }
    const ex = exercisesFromLine(line, unit);
    if (ex) {
      for (const e of ex.list) b.exercise(e);
      acc.exercises += ex.list.length;
      if (ex.leftover) acc.unread.push(line);
      else acc.understood++;
      continue;
    }
    // the first short line before anything else is the program's name
    if (!titleTaken && !b.program.blocks.length && line.length <= 70 && !/\d\s*(x|×)\s*\d/i.test(line)) {
      b.program.title = line.replace(/^[#*\s]+|[*\s]+$/g, "");
      titleTaken = true;
      acc.understood++;
      continue;
    }
    if (PROGRESSION_WORDS.test(line) && !/\d\s*(x|×)\s*\d/i.test(line)) {
      b.note(line);
      acc.understood++;
      continue;
    }
    // a bare name inside a day ("Leg Press") is an exercise with nothing written for it:
    // brought in for its numbers to be filled in, never dropped as a note
    const bare = bareExercise(line);
    if (bare && b.currentDay) {
      const e = blankExercise(bare.name);
      e.group = bare.group;
      e.src = line.slice(0, 200);
      e.unsure = "No sets or reps written for it";
      b.exercise(e);
      acc.exercises++;
      acc.understood++;
      continue;
    }
    if (/\d/.test(line) && looksLikeWork(line)) {
      acc.unread.push(line);
      b.note(line);
      continue;
    }
    b.note(line);
    acc.understood++;
  }
}

const NOTE_START =
  /^(superset|circuit|optional|focus|notes?|tip|cue|remember|make sure|don'?t|no\b|not\b|then|and|or|with|rest|warm|cool|stretch|finish|total|time|duration|goal|week|day)\b/i;

/** A line that's only an exercise's name (short, no prescription, not a sentence), or null. */
function bareExercise(line: string): { name: string; group: string | null } | null {
  let t = line.trim();
  let group: string | null = null;
  const mark = LIST_MARK.exec(t);
  if (mark) {
    group = (mark[2] ?? mark[3] ?? null)?.toUpperCase() ?? null;
    t = t.slice(mark[0].length).trim();
  }
  t = t.replace(/[:\-–—]+$/, "").trim();
  if (!t || t.length > 50 || words(t) > 6 || !NAME_OK(t)) return null;
  if (/[.!?;]$/.test(t) || /[,;]/.test(t) || RX_START.test(t) || SENTENCE_START.test(t) || NOTE_START.test(t)) return null;
  if (!/^[A-Z0-9(]/.test(t)) return null;
  return { name: t, group };
}

/** A line with numbers that reads like training rather than a note (it should have been an exercise). */
function looksLikeWork(line: string): boolean {
  if (RX_START.test(line)) return true;
  return /\b\d{1,3}\s*(reps?|sets?)\b/i.test(line);
}

function applyHeading(b: ProgramBuilder, h: Heading) {
  if (h.kind === "block") b.block(h.name);
  else if (h.kind === "week") b.newWeek(h.label, h.deload, h.repeat ?? null);
  else b.newDay(h.title);
}

/* ------------------------------------------------------------------ */
/*  Tables                                                             */
/* ------------------------------------------------------------------ */

type Field =
  | "exercise"
  | "sets"
  | "reps"
  | "setsreps"
  | "load"
  | "pct"
  | "rpe"
  | "rir"
  | "rest"
  | "tempo"
  | "velocity"
  | "notes"
  | "week"
  | "day"
  | "group";
type Col = { field: Field; unit?: WeightUnit | null; restUnit?: "s" | "m" | null; week?: number | null };

/** What a header cell names. */
export function headerField(cell: string): Col | null {
  const raw = cell.trim().toLowerCase();
  if (!raw) return null;
  const inner = /\(([^)]*)\)/.exec(raw)?.[1] ?? "";
  const s = raw.replace(/\([^)]*\)/g, "").replace(/[*:]/g, "").trim();
  const unit = unitWord(inner) ?? (/\bkg\b/.test(raw) ? "kg" : /\blbs?\b/.test(raw) ? "lb" : null);
  if (/^(exercise|exercises|movement|movements|lift|lifts|exercise name|name|drill|exercise\/movement)$/.test(s)) return { field: "exercise" };
  if (/^(sets?\s*(x|×|\/|and|&)\s*reps?|prescription|scheme|sets\/reps|set x rep|sets x reps)$/.test(s)) return { field: "setsreps" };
  if (/^(sets?|# ?sets|no\.? ?of sets|working sets|set count)$/.test(s)) return { field: "sets" };
  if (/^(reps?|repetitions|rep range|# ?reps|target reps|reps per set)$/.test(s)) return { field: "reps" };
  if (/^(%|% ?1 ?rm|%1rm|percent(age)?|% of max|%max|% ?tm|% of 1rm|intensity ?%|% intensity)$/.test(s)) return { field: "pct" };
  if (/^(load|weight|wt|kg|kgs|lbs?|target load|target weight|weight used|working weight|load\/intensity|intensity)$/.test(s)) return { field: "load", unit };
  if (/^(rpe|@ ?rpe|target rpe|rpe target|effort)$/.test(s)) return { field: "rpe" };
  if (/^(rir|reps in reserve|target rir)$/.test(s)) return { field: "rir" };
  if (/^(rest|rest period|rest time|recovery|rest between sets)$/.test(s))
    return { field: "rest", restUnit: /sec|^s$/.test(inner) ? "s" : /min|^m$/.test(inner) ? "m" : null };
  if (/^tempo$/.test(s)) return { field: "tempo" };
  if (/^(velocity|speed|bar speed|m\/s|target velocity|mcv)$/.test(s)) return { field: "velocity" };
  if (/^(notes?|comments?|cues?|coaching cues|coach notes|instructions|details|description|coaching notes)$/.test(s)) return { field: "notes" };
  if (/^(week|wk|weeks?)$/.test(s)) return { field: "week" };
  if (/^(day|session|workout day|training day|workout)$/.test(s)) return { field: "day" };
  if (/^(order|#|superset|ss|group|circuit|pair)$/.test(s)) return { field: "group" };
  const wk = /^(?:week|wk|w)\s*#?\s*(\d{1,2})\b/.exec(s);
  if (wk) return { field: "setsreps", week: Number(wk[1]) };
  return null;
}

type Layout = { headerRow: number; cols: Map<number, Col>; rowsUsed: number };

/** The sheet's header (one row, or a week row over a field row), when it has one. */
function findLayout(rows: string[][]): Layout | null {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const cols = new Map<number, Col>();
    row.forEach((c, i) => {
      const f = headerField(c);
      if (f) cols.set(i, f);
    });
    const fields = [...cols.values()];
    const weekCols = fields.filter((f) => f.week != null).length;
    // a week row over a row of field names: "Week 1" (merged) over Sets | Reps | Load
    if (weekCols >= 1 && rows[r + 1]) {
      const sub = new Map<number, Col>();
      (rows[r + 1] ?? []).forEach((c, i) => {
        const f = headerField(c);
        if (f) sub.set(i, f);
      });
      const subFields = [...sub.values()].filter((f) => f.field !== "exercise" && f.week == null);
      if (subFields.length >= 2) {
        const merged = new Map<number, Col>();
        for (const [i, f] of sub) {
          const wkCell = headerField(row[i] ?? "");
          merged.set(i, wkCell?.week != null && f.field !== "exercise" ? { ...f, week: wkCell.week } : f);
        }
        if (![...merged.values()].some((f) => f.field === "exercise")) {
          // the exercise names are the first column with text under the header
          const first = firstTextCol(rows, r + 2);
          if (first != null && !merged.has(first)) merged.set(first, { field: "exercise" });
        }
        if ([...merged.values()].some((f) => f.field === "exercise")) return { headerRow: r + 1, cols: merged, rowsUsed: 2 };
      }
    }
    const hasEx = fields.some((f) => f.field === "exercise");
    if (weekCols >= 2) {
      if (!hasEx) {
        const first = firstTextCol(rows, r + 1);
        if (first != null && !cols.has(first)) cols.set(first, { field: "exercise" });
      }
      if ([...cols.values()].some((f) => f.field === "exercise")) return { headerRow: r, cols, rowsUsed: 1 };
    }
    const work = fields.filter((f) => ["sets", "reps", "setsreps", "load", "pct", "rpe", "rir"].includes(f.field)).length;
    if (hasEx && work >= 1) return { headerRow: r, cols, rowsUsed: 1 };
    if (!hasEx && work >= 2 && fields.length >= 3) {
      const first = firstTextCol(rows, r + 1);
      if (first != null && !cols.has(first)) {
        cols.set(first, { field: "exercise" });
        return { headerRow: r, cols, rowsUsed: 1 };
      }
    }
  }
  return null;
}

function firstTextCol(rows: string[][], from: number): number | null {
  const counts = new Map<number, number>();
  for (let r = from; r < Math.min(rows.length, from + 30); r++) {
    const row = rows[r] ?? [];
    const i = row.findIndex((c) => /[a-z]{3}/i.test(c ?? ""));
    if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  let best: number | null = null;
  let n = 0;
  for (const [i, c] of counts) if (c > n) {
    best = i;
    n = c;
  }
  return best;
}

type Acc = { lines: number; understood: number; exercises: number; unread: string[] };

/** A cell read as its column says. */
function readCell(col: Col, cell: string, unitHint: WeightUnit | null, e: ImportedExercise): { ok: boolean; note?: string } {
  const v = cell.trim();
  if (!v || v === "-" || v === "–" || /^n\/?a$/i.test(v)) return { ok: true };
  const plain = /^\d+(?:[.,]\d+)?$/.test(v);
  const n = Number(v.replace(",", "."));
  switch (col.field) {
    case "sets": {
      if (plain && Number.isInteger(n) && n >= 1 && n <= 50) {
        e.sets = n;
        return { ok: true };
      }
      const r = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(v);
      if (r) {
        e.sets = Number(r[1]);
        e.unsure = `Sets were "${v}": ${r[1]} is set, change it if you want more`;
        return { ok: true };
      }
      const rx = parsePrescription(v, unitHint).rx;
      if (rx.sets != null) {
        Object.assign(e, { sets: rx.sets, reps: e.reps ?? rx.reps });
        return { ok: true };
      }
      return { ok: false };
    }
    case "reps": {
      const r = repsText(v);
      if (r) {
        e.reps = r;
        return { ok: true };
      }
      const rx = parsePrescription(v, unitHint).rx;
      if (rx.reps) {
        e.reps = rx.reps;
        if (rx.sets != null && e.sets == null) e.sets = rx.sets;
        return { ok: true };
      }
      return { ok: false };
    }
    case "setsreps":
    case "load":
    case "pct":
    case "rpe":
    case "rir":
    case "velocity": {
      if (plain) {
        if (col.field === "pct") {
          // 0.75 in a % column is 75%
          e.pct = n > 0 && n <= 1.5 ? Math.round(n * 1000) / 10 : n;
          e.pct_of = "1rm";
          return { ok: e.pct > 0 && e.pct <= 150 };
        }
        if (col.field === "rpe") {
          const r = effortRange(v, "rpe");
          if (r) e.rpe = r;
          return { ok: !!r };
        }
        if (col.field === "rir") {
          const r = effortRange(v, "rir");
          if (r) e.rir = r;
          return { ok: !!r };
        }
        if (col.field === "load") {
          if (!(n > 0 && n <= 1500)) return { ok: false };
          e.load = n;
          e.unit = col.unit ?? unitHint;
          if (!e.unit) e.unsure = e.unsure ?? "The file doesn't say if weights are kg or lb";
          return { ok: true };
        }
        if (col.field === "velocity") {
          e.velocity = `${v} m/s`;
          return { ok: true };
        }
      }
      if (col.field === "rpe" || col.field === "rir") {
        const r = effortRange(v.replace(/^@?\s*(rpe|rir)?\s*/i, ""), col.field);
        if (r) {
          e[col.field] = r;
          return { ok: true };
        }
      }
      if (col.field === "velocity" && /m\s*\/\s*s/i.test(v)) {
        e.velocity = v;
        return { ok: true };
      }
      const parts = splitPrescriptions(v);
      const { rx, leftover } = parsePrescription(parts[0], col.unit ?? unitHint);
      if (rx.load != null && rx.unit == null) rx.unit = col.unit ?? unitHint;
      const merged = withRx(e, rx);
      Object.assign(e, merged);
      const extra = parts.length > 1 ? parts.slice(1).join("; ") : "";
      const note = [leftover && /[a-z]{3}/i.test(leftover) ? leftover : "", extra ? `Then ${extra}` : ""].filter(Boolean).join(". ");
      if (note) e.notes = e.notes ? `${e.notes}. ${note}` : note;
      return { ok: rx.sets != null || rx.reps != null || rx.load != null || rx.pct != null || rx.rpe != null || rx.rir != null || !!rx.velocity, note };
    }
    case "rest": {
      const r = restSeconds(col.restUnit === "s" && plain ? `${v}s` : col.restUnit === "m" && plain ? `${v} min` : v);
      if (r.seconds == null) return { ok: false };
      e.rest_seconds = r.seconds;
      if (r.rangeNote) e.notes = e.notes ? `${e.notes}. ${r.rangeNote}` : r.rangeNote;
      return { ok: true };
    }
    case "tempo": {
      e.tempo = v.replace(/\s+/g, "-").toUpperCase().slice(0, 12);
      return { ok: true };
    }
    case "notes": {
      e.notes = e.notes ? `${e.notes}. ${v}` : v;
      return { ok: true };
    }
    case "group": {
      if (/^[a-h]\d{0,2}$/i.test(v)) e.group = v.toUpperCase();
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

function parseTable(sheet: SourceSheet, layout: Layout, b: ProgramBuilder, unitHint: WeightUnit | null, acc: Acc) {
  const { cols } = layout;
  const exCol = [...cols].find(([, c]) => c.field === "exercise")?.[0] ?? 0;
  const weekCol = [...cols].find(([, c]) => c.field === "week")?.[0];
  const dayCol = [...cols].find(([, c]) => c.field === "day")?.[0];
  const weekNums = [...new Set([...cols.values()].map((c) => c.week).filter((w): w is number => w != null))].sort((x, y) => x - y);

  // the weeks across: every row is an exercise in each week's column(s), days from the section rows
  if (weekNums.length >= 2) {
    type DayRows = { title: string | null; rows: Array<{ row: string[]; src: string }> };
    const days: DayRows[] = [];
    let cur: DayRows | null = null;
    for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (!row.some((c) => c?.trim())) continue;
      acc.lines++;
      const filled = row.map((c, i) => [i, (c ?? "").trim()] as const).filter(([, c]) => c);
      const name = (row[exCol] ?? "").trim();
      const onlyName = filled.length === 1 && filled[0][0] === exCol;
      const h = headingOf(filled.length === 1 ? filled[0][1] : name);
      if (h && h.kind === "day" && (onlyName || filled.length === 1)) {
        cur = { title: h.title, rows: [] };
        days.push(cur);
        acc.understood++;
        continue;
      }
      if (filled.length === 1 && !NAME_OK(filled[0][1])) continue;
      if (!name || !NAME_OK(name)) {
        acc.unread.push(row.filter(Boolean).join(" | "));
        continue;
      }
      if (!cur) {
        cur = { title: null, rows: [] };
        days.push(cur);
      }
      cur.rows.push({ row, src: row.filter(Boolean).join(" | ").slice(0, 200) });
    }
    for (const wk of weekNums) {
      b.newWeek(`Week ${wk}`, false);
      for (const d of days) {
        b.newDay(d.title);
        for (const { row, src } of d.rows) {
          const e = blankExercise((row[exCol] ?? "").trim());
          e.src = src;
          let any = false;
          let bad = false;
          for (const [i, c] of cols) {
            if (c.field === "exercise") continue;
            if (c.week != null && c.week !== wk) continue;
            const res = readCell(c, row[i] ?? "", unitHint, e);
            if ((row[i] ?? "").trim()) any = true;
            if (!res.ok) bad = true;
          }
          if (!any) continue; // nothing for this exercise this week
          if (bad) e.unsure = e.unsure ?? "Part of this wasn't clear";
          b.exercise(e);
          acc.exercises++;
        }
      }
    }
    // every row counted once, whatever the weeks
    acc.understood += days.reduce((n, d) => n + d.rows.length, 0);
    return;
  }

  let lastWeek: string | null = null;
  let lastDay: string | null = null;
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (!row.some((c) => c?.trim())) continue;
    acc.lines++;
    const filled = row.map((c, i) => [i, (c ?? "").trim()] as const).filter(([, c]) => c);
    // a section row: one cell with a heading in it ("Week 2", "Day 3 – Lower")
    if (filled.length === 1 || (filled.length <= 2 && filled.every(([i]) => i === exCol || i === weekCol || i === dayCol))) {
      const h = headingOf(filled.map(([, c]) => c).join(" "));
      if (h) {
        applyHeading(b, h);
        acc.understood++;
        continue;
      }
    }
    if (weekCol != null) {
      const w = (row[weekCol] ?? "").trim();
      if (w && w !== lastWeek) {
        const h = headingOf(/^\d+$/.test(w) ? `Week ${w}` : w);
        b.newWeek(h?.kind === "week" ? h.label : `Week ${w}`, /deload/i.test(w));
        lastWeek = w;
        lastDay = null;
      }
    }
    if (dayCol != null) {
      const d = (row[dayCol] ?? "").trim();
      if (d && d !== lastDay) {
        b.newDay(/^\d+$/.test(d) ? `Day ${d}` : cap(d, 40));
        lastDay = d;
      }
    }
    const name = (row[exCol] ?? "").trim();
    if (!name || !NAME_OK(name)) {
      const text = filled.map(([, c]) => c).join(" | ");
      if (/[a-z]{3}/i.test(text) && !/\d/.test(text)) {
        b.note(text);
        acc.understood++;
      } else acc.unread.push(text);
      continue;
    }
    const e = blankExercise(name);
    e.src = filled.map(([, c]) => c).join(" | ").slice(0, 200);
    let bad = false;
    for (const [i, c] of cols) {
      if (c.field === "exercise" || c.field === "week" || c.field === "day") continue;
      const res = readCell(c, row[i] ?? "", unitHint, e);
      if (!res.ok) bad = true;
    }
    // a number in a column with no header the parser knows: never dropped silently
    const stray = filled.filter(([i, c]) => !cols.has(i) && /\d/.test(c)).map(([, c]) => c);
    if (stray.length) {
      bad = true;
      e.unsure = `Couldn't place "${cap(stray.join(", "), 60)}"`;
    }
    if (bad) {
      e.unsure = e.unsure ?? "Part of this row wasn't clear";
      acc.unread.push(e.src);
    } else acc.understood++;
    b.exercise(e);
    acc.exercises++;
  }
}

/* ------------------------------------------------------------------ */
/*  One entry point                                                    */
/* ------------------------------------------------------------------ */

const NOTE_SHEET = /^(notes?|instructions?|read ?me|how to|info|guide|about|intro(duction)?|faq)$/i;

/** A file's program as far as the parser can read it, and how sure it is. */
export function parseSource(doc: SourceDoc): ParseOutcome {
  const title = doc.name ? doc.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 80) || null : null;
  const b = new ProgramBuilder(null);
  const acc: Acc = { lines: 0, understood: 0, exercises: 0, unread: [] };
  const unit = unitOf(doc.text);
  b.program.unit = unit;

  const sheets = doc.sheets ?? [];
  const tabular = sheets.map((s) => ({ s, layout: findLayout(s.rows) }));
  if (doc.kind !== "text" && tabular.some((t) => t.layout)) {
    for (const { s, layout } of tabular) {
      if (doc.kind === "docx") {
        // a Word table's name is the paragraphs above it (headings, notes, a day written out)
        if (s.name.trim()) parseLines(s.name.split("\n"), b, unit, acc);
      } else {
        const h = headingOf(s.name);
        if (h) applyHeading(b, h);
      }
      if (layout) {
        // text above the header (a title, instructions) is read as lines
        parseLines(s.rows.slice(0, layout.headerRow + 1 - layout.rowsUsed).map((r) => r.filter(Boolean).join(" | ")), b, unit, acc);
        parseTable(s, layout, b, unit, acc);
      } else if (NOTE_SHEET.test(s.name.trim())) {
        for (const r of s.rows) {
          const t = r.filter(Boolean).join(" ");
          if (t) {
            b.program.notes = join(b.program.notes, t);
            acc.lines++;
            acc.understood++;
          }
        }
      } else parseLines(s.rows.map((r) => r.filter(Boolean).join(" | ")), b, unit, acc);
    }
  } else {
    parseLines(doc.text.split("\n"), b, unit, acc);
  }

  const program = b.program;
  program.title = program.title ?? title;
  // drop empty shells (a heading with nothing under it)
  for (const bl of program.blocks) {
    for (const w of bl.weeks) w.days = w.days.filter((d) => d.exercises.length);
    bl.weeks = bl.weeks.filter((w) => w.days.length);
  }
  program.blocks = program.blocks.filter((bl) => bl.weeks.length);
  for (const u of acc.unread.slice(0, 20)) program.issues.push({ where: "Not read", text: cap(u, 160) });
  Object.assign(program, expandWeekRanges(program));

  const coverage = acc.lines ? acc.understood / acc.lines : 0;
  const all = program.blocks.flatMap((bl) => bl.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises)));
  const missing = all.filter((e) => e.sets == null || !e.reps).length;
  const crowded = program.blocks.some((bl) => bl.weeks.some((w) => w.days.some((d) => d.exercises.length > 20)));
  const weeks = program.blocks.reduce((n, bl) => n + bl.weeks.length, 0);
  let why: string | null = null;
  if (!all.length) why = "no exercises found";
  else if (coverage < 0.9) why = `read ${Math.round(coverage * 100)}% of the lines`;
  else if (missing > Math.max(1, all.length * 0.2)) why = `${missing} exercises without sets and reps`;
  else if (crowded) why = "a day with more than 20 exercises (the layout may be misread)";
  else if (weeks > 24) why = "more than 24 weeks";
  else if (all.filter((e) => e.unsure).length > Math.max(2, all.length * 0.1)) why = "too many unclear rows";
  return {
    program,
    exercises: all.length,
    lines: acc.lines,
    understood: acc.understood,
    coverage,
    unread: acc.unread.slice(0, 20),
    confident: why == null,
    why,
  };
}
