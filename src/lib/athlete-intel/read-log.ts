/**
 * Reading uploaded athlete information without AI (pure, tested): training
 * logs and programs in the layouts coaches use (a row per set or exercise
 * with Date / Exercise / Sets / Reps / Load / RPE columns, prescribed and
 * actual columns side by side, "Week 3" / "Day 2" headings, "180x3@8"
 * shorthand), meet-result tables, and notes typed line by line ("Openers:
 * squat 170, bench 105", "BW 74.2", "Squat rack 9"). It says what it couldn't
 * place (`narrative`) so AI reads only that, and it never marks a prescribed
 * set completed: completion is read from an actual / done column, a file
 * that says it's a log, or what the person said it is; otherwise it's
 * prescribed, or unknown for dated rows with no other sign.
 */
import { classifyExercise, norm, parseDate, parseSetText, unitOf } from "./classify";
import type { Completion, Confidence, Lift, MeetData, Purpose, RawFact, TrainingData, Unit } from "./types";
import { toKg } from "./types";

export type SourceSheet = { name: string; rows: string[][] };
export type ReadInput = {
  kind: string;
  name: string | null;
  text: string;
  sheets?: SourceSheet[];
};
export type ReadOptions = {
  today: string;
  /** what the person said the file is (an empty list or ["other"]: let the reader decide) */
  declared: Purpose[];
  /** the athlete's unit when it's known (their confirmed preference) */
  preferredUnit?: Unit | null;
  /** their best meet lifts (kg), to tell kg from lb when a file doesn't say */
  meetBestKg?: Partial<Record<Lift, number>>;
  bodyweightKg?: number | null;
};

export type ReadResult = {
  facts: RawFact[];
  unit: Unit | null;
  unitWhy: string | null;
  rows: number;
  understood: number;
  /** text the reader couldn't place (paragraphs of notes): what AI reads */
  narrative: string;
  completionWhy: string | null;
  /** loads whose unit couldn't be told (kept out of the strength line until it is) */
  unitUnknown: boolean;
};

const cellNorm = (c: string) => norm(String(c ?? ""));
const truthy = (c: string) => /^(x|✓|✔|yes|y|done|completed?|true|1|hit|made)$/i.test(String(c ?? "").trim());

type Col =
  | "date"
  | "week"
  | "day"
  | "exercise"
  | "set"
  | "sets"
  | "reps"
  | "load"
  | "rpe"
  | "rir"
  | "pct"
  | "notes"
  | "done"
  | "combo"
  | "bodyweight"
  | "squat"
  | "bench"
  | "deadlift"
  | "total"
  | "place"
  | "meet"
  | "federation"
  | "class";
type Header = { col: Col; when: "planned" | "actual" | "plain"; unit: Unit | null };

const PLANNED = /\b(prescribed|planned|plan|target|programmed|goal|rx|prescription|intended|suggested)\b/;
const ACTUAL = /\b(actual|completed|done|result|results|achieved|performed|used|logged|hit|recorded|did)\b/;

/** What a header cell names. */
export function headerOf(raw: string): Header | null {
  const s = cellNorm(raw);
  if (!s || s.length > 40) return null;
  const when: Header["when"] = PLANNED.test(s) ? "planned" : ACTUAL.test(s) ? "actual" : "plain";
  const unit = unitOf(raw);
  const base = s.replace(PLANNED, " ").replace(ACTUAL, " ").replace(/\b(kgs?|lbs?)\b/g, " ").replace(/\s+/g, " ").trim();
  const h = (col: Col): Header => ({ col, when, unit });
  if (/^(date|session date|training date|when|day date)$/.test(base)) return h("date");
  if (/^(week|wk|w|week #|week no)$/.test(base)) return h("week");
  if (/^(day|session|workout|day #|session #)$/.test(base)) return h("day");
  if (/^(exercise|exercises|lift|movement|exercise name|name|variation)$/.test(base)) return h("exercise");
  if (/^(set|set #|set no|set number)$/.test(base)) return h("set");
  if (/^(sets|# sets|no sets)$/.test(base)) return h("sets");
  if (/^(reps|rep|# reps|repetitions)$/.test(base)) return h("reps");
  if (/^(load|weight|wt|kg|lbs|lb|weight used|load used|top set weight|bar weight)$/.test(base) || (base === "" && unit)) return h("load");
  if (/^(rpe|@|effort|rpe @)$/.test(base)) return h("rpe");
  if (/^(rir|reps in reserve)$/.test(base)) return h("rir");
  if (/^(%|percent|percentage|% 1rm|%1rm|intensity|% of 1rm)$/.test(base)) return h("pct");
  if (/^(notes?|comments?|feedback|athlete notes|coach notes|how it felt)$/.test(base)) return h("notes");
  if (/^(done|complete|completed|check|tick|did it)$/.test(s)) return { col: "done", when: "actual", unit: null };
  if (/^(sets x reps|set x rep|scheme|prescription|top set|sets reps|sets reps load|work|result|actual|performed)$/.test(s) || (when !== "plain" && base === "")) return { col: "combo", when, unit };
  if (/^(bodyweight|bw|body weight|weigh in|weighed)$/.test(base)) return h("bodyweight");
  if (/^(squat|sq|best squat)$/.test(base)) return h("squat");
  if (/^(bench|bench press|bp|best bench)$/.test(base)) return h("bench");
  if (/^(deadlift|dl|best deadlift)$/.test(base)) return h("deadlift");
  if (/^(total|tot)$/.test(base)) return h("total");
  if (/^(place|placing|rank)$/.test(base)) return h("place");
  if (/^(meet|competition|event|meet name)$/.test(base)) return h("meet");
  if (/^(federation|fed)$/.test(base)) return h("federation");
  if (/^(class|weight class|division class)$/.test(base)) return h("class");
  return null;
}

const WEEK_HEAD = /^(?:week|wk|w)\s*#?\s*(\d{1,2})\b/i;
const DAY_HEAD = /^(?:day|session|workout)\s*#?\s*(\d{1,2})\b/i;
const num = (c: string | undefined) => {
  const s = String(c ?? "").trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

type Row = {
  exercise: string;
  date: string | null;
  week: number | null;
  day: number | null;
  sets: number;
  reps: number;
  load: number | null;
  unit: Unit | null;
  pct: number | null;
  rpe: number | null;
  rir: number | null;
  completion: Completion;
  planned: TrainingData["planned"];
  quote: string;
  location: string;
  order: number;
  confidence: Confidence;
};

/** Values a cell or a group of cells give: a set written as text, or numbers by column. */
function valuesOf(cells: Partial<Record<Col, string>>, unit: Unit | null) {
  const out = {
    sets: num(cells.sets),
    reps: num(cells.reps),
    load: null as number | null,
    unit: null as Unit | null,
    pct: num(String(cells.pct ?? "").replace("%", "")),
    rpe: num(String(cells.rpe ?? "").replace(/^@/, "")),
    rir: num(cells.rir),
  };
  const loadText = String(cells.load ?? "").trim();
  const combo = String(cells.combo ?? "").trim();
  for (const text of [loadText, combo]) {
    if (!text) continue;
    const p = parseSetText(text, unit);
    if (p && (p.load != null || p.pct != null) && !/^\d+(\.\d+)?\s*(kg|kgs|lb|lbs)?$/i.test(text)) {
      out.sets = out.sets ?? p.sets;
      out.reps = out.reps ?? p.reps;
      out.load = out.load ?? p.load;
      out.unit = out.unit ?? p.unit;
      out.pct = out.pct ?? p.pct;
      out.rpe = out.rpe ?? p.rpe;
      out.rir = out.rir ?? p.rir;
      continue;
    }
    const m = /^(\d{2,4}(?:[.,]\d{1,2})?)\s*(kg|kgs|lb|lbs)?$/i.exec(text);
    if (m && out.load == null) {
      out.load = Number(m[1].replace(",", "."));
      out.unit = unitOf(m[2] ?? "") ?? null;
    }
  }
  if (out.pct != null && !(out.pct >= 30 && out.pct <= 110)) out.pct = out.pct > 0 && out.pct <= 1.1 ? Math.round(out.pct * 1000) / 10 : null;
  if (out.rpe != null && !(out.rpe >= 5 && out.rpe <= 10)) out.rpe = null;
  if (out.rir != null && !(out.rir >= 0 && out.rir <= 5)) out.rir = null;
  if (out.load != null && !(out.load >= 10 && out.load <= 700)) out.load = null;
  if (out.sets != null && !(out.sets >= 1 && out.sets <= 12)) out.sets = null;
  if (out.reps != null && !(out.reps >= 1 && out.reps <= 30)) out.reps = null;
  return out;
}

const LOG_NAME = /\b(log|logs|logged|actual|actuals|completed|results|diary|journal|history|done|tracker)\b/;
const PROGRAM_NAME = /\b(program|programme|plan|block|template|meso|prescription|week \d|cycle)\b/;

/** One sheet with a header row: its training rows and meets. */
function readTable(
  sheet: SourceSheet,
  headerAt: number,
  headers: Array<Header | null>,
  ctx: { fileName: string; today: string; declared: Purpose[]; unit: Unit | null; baseOrder: number },
): { rows: Row[]; meets: RawFact[]; bodyweights: RawFact[]; seen: number; used: number } {
  const rows: Row[] = [];
  const meets: RawFact[] = [];
  const bodyweights: RawFact[] = [];
  const cols = (c: Col, when?: Header["when"]) => headers.map((h, i) => (h && h.col === c && (!when || h.when === when) ? i : -1)).filter((i) => i >= 0);
  const hasActual = headers.some((h) => h && h.when === "actual" && h.col !== "notes");
  const hasPlanned = headers.some((h) => h && (h.when === "planned" || h.col === "pct"));
  const headerUnit = headers.find((h) => h?.unit)?.unit ?? null;
  const unit = headerUnit ?? ctx.unit;
  const isMeetTable = cols("squat").length > 0 && cols("bench").length > 0 && cols("deadlift").length > 0;
  const nameSays = norm(`${ctx.fileName} ${sheet.name}`);
  const logLike = LOG_NAME.test(nameSays) || ctx.declared.includes("logs");
  const programLike = !logLike && (PROGRAM_NAME.test(nameSays) || ctx.declared.includes("program") || hasPlanned);
  let week: number | null = null;
  let day: number | null = null;
  let date: string | null = null;
  let exercise = "";
  let seen = 0;
  let used = 0;
  const pick = (r: string[], c: Col, when?: Header["when"]) => {
    for (const i of cols(c, when)) if (String(r[i] ?? "").trim()) return String(r[i]).trim();
    return undefined;
  };
  for (let ri = headerAt + 1; ri < sheet.rows.length; ri++) {
    const r = sheet.rows[ri];
    const filled = r.filter((c) => String(c ?? "").trim());
    if (!filled.length) continue;
    seen++;
    const loc = `${sheet.name ? `${sheet.name}, ` : ""}row ${ri + 1}`;
    // a heading row: "Week 3", "Day 2", a lone date
    if (filled.length === 1) {
      const only = String(filled[0]).trim();
      const w = WEEK_HEAD.exec(only);
      const d = DAY_HEAD.exec(only);
      const dt = parseDate(only, ctx.today);
      if (w) week = Number(w[1]);
      if (d) day = Number(d[1]);
      if (dt) date = dt;
      if (w || d || dt) {
        used++;
        continue;
      }
    }
    if (isMeetTable) {
      const s = num(pick(r, "squat"));
      const b = num(pick(r, "bench"));
      const dl = num(pick(r, "deadlift"));
      const dt = parseDate(pick(r, "date") ?? "", ctx.today);
      if (s && b && dl && dt) {
        const k = (x: number) => (unit ? toKg(x, unit) : x);
        const total = num(pick(r, "total"));
        meets.push({
          kind: "meet",
          lift: null,
          date: dt,
          data: {
            name: pick(r, "meet") ?? null,
            federation: pick(r, "federation") ?? null,
            weightClass: pick(r, "class") ?? null,
            bodyweightKg: num(pick(r, "bodyweight")) != null ? k(num(pick(r, "bodyweight"))!) : null,
            squat: k(s),
            bench: k(b),
            deadlift: k(dl),
            total: total != null ? k(total) : k(s + b + dl),
            place: pick(r, "place") ?? null,
            attempts: null,
          } satisfies MeetData,
          quote: filled.join(" | ").slice(0, 300),
          location: loc,
          confidence: unit ? "high" : "medium",
          scope: "athlete",
        });
        used++;
      }
      continue;
    }
    const dCell = pick(r, "date");
    if (dCell) {
      const dt = parseDate(dCell, ctx.today);
      if (dt) date = dt;
    }
    const wCell = num(pick(r, "week"));
    if (wCell != null) week = wCell;
    const dayCell = pick(r, "day");
    if (dayCell) {
      const dn = num(dayCell) ?? (DAY_HEAD.exec(dayCell) ? Number(DAY_HEAD.exec(dayCell)![1]) : null);
      if (dn != null) day = dn;
      else {
        const dt = parseDate(dayCell, ctx.today);
        if (dt) date = dt;
      }
    }
    const bwCell = num(pick(r, "bodyweight"));
    if (bwCell != null && date && bwCell > 30 && bwCell < 400) {
      bodyweights.push({
        kind: "bodyweight",
        lift: null,
        date,
        data: { kg: unit ? toKg(bwCell, unit) : bwCell },
        quote: filled.join(" | ").slice(0, 300),
        location: loc,
        confidence: unit ? "high" : "medium",
        scope: "athlete",
      });
    }
    const exCell = pick(r, "exercise");
    if (exCell && !/^\d+(\.\d+)?$/.test(exCell)) exercise = exCell;
    if (!exercise) continue;
    // planned and actual values; plain columns are the plan when actual columns exist, else the only values
    const grab = (when: Header["when"]) => {
      const out: Partial<Record<Col, string>> = {};
      for (const c of ["sets", "reps", "load", "rpe", "rir", "pct", "combo"] as Col[]) {
        const v = pick(r, c, when);
        if (v) out[c] = v;
      }
      return out;
    };
    const planCells = { ...grab("plain"), ...grab("planned") };
    const actualCells = grab("actual");
    const plan = valuesOf(planCells, unit);
    const actual = valuesOf(actualCells, unit);
    const doneCell = pick(r, "done", "actual");
    const actualHas = actual.load != null || actual.reps != null || actual.rpe != null;
    let completion: Completion;
    let v = plan;
    let confidence: Confidence = "high";
    if (hasActual) {
      if (actualHas) {
        completion = "completed";
        v = {
          sets: actual.sets ?? plan.sets,
          reps: actual.reps ?? plan.reps,
          load: actual.load ?? plan.load,
          unit: actual.unit ?? plan.unit,
          pct: actual.load != null ? null : plan.pct,
          rpe: actual.rpe,
          rir: actual.rir,
        };
        if (actual.reps == null || actual.load == null) confidence = "medium";
      } else if (doneCell && truthy(doneCell)) {
        completion = "completed";
        confidence = "high";
      } else completion = "prescribed";
    } else if (logLike) completion = "completed";
    else if (programLike) completion = "prescribed";
    else completion = date && date <= ctx.today ? "unknown" : "prescribed";
    if (v.reps == null || (v.load == null && v.pct == null && v.rpe == null)) continue;
    used++;
    rows.push({
      exercise,
      date,
      week,
      day,
      sets: v.sets ?? (cols("set").length ? 1 : 1),
      reps: v.reps,
      load: v.load,
      unit: v.unit ?? unit,
      pct: v.pct,
      rpe: v.rpe,
      rir: v.rir,
      completion,
      planned:
        completion === "completed" && hasActual
          ? { sets: plan.sets, reps: plan.reps, loadKg: plan.load != null && (plan.unit ?? unit) ? toKg(plan.load, (plan.unit ?? unit)!) : null, rpe: plan.rpe }
          : null,
      quote: filled.join(" | ").slice(0, 300),
      location: loc,
      order: ctx.baseOrder + ri,
      confidence,
    });
  }
  return { rows, meets, bodyweights, seen, used };
}

/** The header row of a sheet: the first of its first 15 rows that names two or more columns. */
function findHeader(sheet: SourceSheet): { at: number; headers: Array<Header | null> } | null {
  for (let i = 0; i < Math.min(sheet.rows.length, 15); i++) {
    const hs = sheet.rows[i].map((c) => headerOf(String(c ?? "")));
    const named = hs.filter(Boolean) as Header[];
    const meet = ["squat", "bench", "deadlift"].every((c) => named.some((h) => h.col === c));
    const training = named.some((h) => h.col === "exercise") && named.some((h) => ["reps", "load", "combo", "sets", "rpe"].includes(h.col));
    if (named.length >= 2 && (meet || training)) return { at: i, headers: hs };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lines of text                                                      */

const LIFT_WORD: Array<[RegExp, Lift]> = [
  [/\b(squats?|sq)\b/i, "squat"],
  [/\b(bench|bp)\b/i, "bench"],
  [/\b(dead ?lifts?|dl|deads?|pull)\b/i, "deadlift"],
];
const liftIn = (s: string): Lift | null => LIFT_WORD.find(([re]) => re.test(s))?.[1] ?? null;

const RISK = /\b(pain|painful|hurts?|hurting|tweak(ed)?|strain(ed)?|sprain(ed)?|injur(y|ed|ies)|aggravat(ed|ing)|niggle|irritat(ed|ion)|tendin|sore(ness)?|flare|discomfort|impingement|pinch(ing)?)\b/i;
const RESOLVED = /\b(resolved|gone|no longer|better now|healed|cleared|all good now|fine now|recovered)\b/i;
const PLACE = /\b(left|right|lower back|upper back|back|hip|hips|knee|knees|shoulder|shoulders|elbow|elbows|wrist|wrists|pec|adductor|groin|hamstring|quad|glute|si joint|neck|ankle|bicep|tricep)s?\b/gi;

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4000);
}

/**
 * Notes typed or pasted line by line: dated sessions ("Nov 18: squat 180x3
 * @8, 190x1 @9"), openers and attempts, bodyweight, rack heights, warm-up
 * ladders, cues, pain. What it can't place is handed back as narrative.
 */
export function readLines(text: string, opts: ReadOptions & { unit: Unit | null; completion: Completion }): { facts: RawFact[]; narrative: string[]; used: number; seen: number } {
  const facts: RawFact[] = [];
  const narrative: string[] = [];
  let date: string | null = null;
  let lift: Lift | null = null;
  let used = 0;
  let seen = 0;
  for (const [i, line] of linesOf(text).entries()) {
    seen++;
    const loc = `line ${i + 1}`;
    const quote = line.slice(0, 300);
    // a date at the start of the line sets the session's day
    const head = /^([^:–—-]{3,24})\s*[:–—-]\s*(.*)$/.exec(line);
    let rest = line;
    if (head) {
      const dt = parseDate(head[1], opts.today);
      if (dt) {
        date = dt;
        rest = head[2];
        if (!rest.trim()) {
          used++;
          continue;
        }
      }
    } else {
      const dt = parseDate(line, opts.today);
      if (dt && line.length <= 24) {
        date = dt;
        used++;
        continue;
      }
    }
    const l = liftIn(rest);
    if (l && /^(squats?|bench|dead ?lifts?|sq|bp|dl)\b\s*:?\s*$/i.test(rest)) {
      lift = l;
      used++;
      continue;
    }
    const lower = rest.toLowerCase();
    // openers / attempts: "Openers: squat 170, bench 105, deadlift 200", "Squat attempts 170/180/187.5"
    if (/\b(openers?|attempts?|1st|first attempt)\b/.test(lower)) {
      let any = false;
      const parts = rest.split(/[,;]|\band\b/);
      for (const p of parts) {
        const pl = liftIn(p) ?? (parts.length === 1 ? lift : null);
        if (!pl) continue;
        const ns = [...p.matchAll(/(\d{2,3}(?:[.,]\d{1,2})?)/g)].map((m) => Number(m[1].replace(",", "."))).filter((x) => x >= 20 && x <= 600);
        if (!ns.length) continue;
        const u = unitOf(p) ?? unitOf(rest) ?? opts.unit;
        const k = (x: number | undefined) => (x == null ? null : u ? toKg(x, u) : x);
        facts.push({
          kind: "attempt_plan",
          lift: pl,
          date,
          data: { opener: k(ns[0]), second: /\bopeners?\b/.test(lower) && ns.length === 1 ? null : k(ns[1]), third: /\bopeners?\b/.test(lower) && ns.length === 1 ? null : k(ns[2]) },
          quote,
          location: loc,
          confidence: u ? "high" : "medium",
          scope: "meet",
        });
        any = true;
      }
      if (any) {
        used++;
        continue;
      }
    }
    // a date written inside the line ("pain since Nov 10") beats the session's day for a note
    const inline = (() => {
      for (const m of rest.matchAll(/\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi)) {
        const d = parseDate(m[1], opts.today);
        if (d) return d;
      }
      return null;
    })();
    // bodyweight
    const bw = /\b(?:bw|body ?weight|weighed(?: in)?|weigh[- ]?in)\b[^0-9]{0,12}(\d{2,3}(?:[.,]\d{1,2})?)\s*(kg|kgs|lb|lbs)?/i.exec(rest);
    if (bw) {
      const u = unitOf(bw[2] ?? "") ?? opts.unit;
      const v = Number(bw[1].replace(",", "."));
      if (v > 30 && v < 400) {
        facts.push({ kind: "bodyweight", lift: null, date: inline ?? date, data: { kg: u ? toKg(v, u) : v }, quote, location: loc, confidence: u ? "high" : "medium", scope: "athlete" });
        used++;
        continue;
      }
    }
    // rack heights
    const rack = /\b(rack|hooks?|j-?hooks?|safet(y|ies)|pins?|foot ?blocks?|blocks?)\b[^0-9]{0,10}(\d{1,2})/i.exec(rest);
    if (rack && /\b(rack|hook|safet|pin|block)/i.test(rest) && !/\b(pull|press)\b.*\bx\b/i.test(rest)) {
      const rl = liftIn(rest) ?? lift;
      const height = /\b(rack|hooks?|j-?hooks?)\b[^0-9]{0,10}(\d{1,2})/i.exec(rest)?.[2] ?? null;
      const safety = /\b(safet(?:y|ies)|pins?)\b[^0-9]{0,10}(\d{1,2})/i.exec(rest)?.[2] ?? null;
      const blocks = /\b(foot ?blocks?|blocks?)\b[^0-9]{0,10}(\d{1,2})/i.exec(rest)?.[2] ?? null;
      if (rl && (height || safety || blocks)) {
        facts.push({ kind: "equipment", lift: rl, date, data: { rackHeight: height, safety, footBlocks: blocks }, quote, location: loc, confidence: "high", scope: "athlete" });
        used++;
        continue;
      }
    }
    // warm-ups: "Squat warm-ups: bar x5, 60x3, 100x2, 140x1"
    if (/\bwarm ?-?ups?\b/i.test(rest)) {
      const wl = liftIn(rest) ?? lift;
      const after = rest.split(/warm ?-?ups?\s*:?/i)[1] ?? "";
      const rows: Array<{ kg: number | null; pct: number | null; reps: number }> = [];
      for (const part of after.split(/[,;→>]+/)) {
        const t = part.trim();
        if (!t) continue;
        if (/^(bar|empty bar)\s*x\s*(\d{1,2})/i.test(t)) {
          rows.push({ kg: 20, pct: null, reps: Number(/x\s*(\d{1,2})/i.exec(t)![1]) });
          continue;
        }
        const pct = /(\d{2,3})\s*%\s*x\s*(\d{1,2})/i.exec(t);
        if (pct) {
          rows.push({ kg: null, pct: Number(pct[1]), reps: Number(pct[2]) });
          continue;
        }
        const p = parseSetText(t, opts.unit);
        if (p?.load != null) rows.push({ kg: p.unit ? toKg(p.load, p.unit) : p.load, pct: null, reps: p.reps });
      }
      if (wl && rows.length >= 2) {
        facts.push({ kind: "warmup", lift: wl, date, data: { rows }, quote, location: loc, confidence: "high", scope: "athlete" });
        used++;
        continue;
      }
    }
    // cues: "Cue: knees out", "Bench cues - leg drive, tuck elbows"
    const cue = /\bcues?\b\s*[:–—-]\s*(.+)$/i.exec(rest);
    if (cue) {
      const cl = liftIn(rest.split(/cues?/i)[0]) ?? lift;
      for (const c of cue[1].split(/[;,]|\s\/\s/).map((x) => x.trim()).filter((x) => x.length >= 3).slice(0, 6))
        facts.push({ kind: "cue", lift: cl, date, data: { text: c.slice(0, 160) }, quote, location: loc, confidence: "high", scope: "athlete" });
      used++;
      continue;
    }
    // sets on a line: "squat 180x3 @8, 190x1 @9", "180x3@8" under a lift heading
    const sl = liftIn(rest) ?? lift;
    const chunks = rest.split(/[,;]|\bthen\b/i).map((x) => x.trim()).filter(Boolean);
    const sets: RawFact[] = [];
    let exName = "";
    for (const c of chunks) {
      const m = /^([a-z][a-z .'/()-]{2,40}?)\s*:?\s*(\d.*)$/i.exec(c);
      const name = m ? m[1].trim() : exName;
      if (m) exName = m[1].trim();
      const p = parseSetText(m ? m[2] : c, opts.unit);
      if (!p || p.load == null) continue;
      const exercise = name || (sl ? sl[0].toUpperCase() + sl.slice(1) : "");
      if (!exercise) continue;
      const cls = classifyExercise(exercise);
      sets.push({
        kind: "training",
        lift: cls.lift ?? (name ? null : sl),
        date,
        data: {
          exercise,
          standard: cls.lift ? cls.standard : name ? "unclear" : "competition",
          sets: p.sets,
          reps: p.reps,
          load: p.load,
          unit: p.unit,
          loadKg: p.unit ? toKg(p.load, p.unit) : null,
          pct: p.pct,
          rpe: p.rpe,
          rir: p.rir,
          completion: date && date <= opts.today ? opts.completion : "prescribed",
        } satisfies TrainingData,
        quote,
        location: loc,
        confidence: p.unit ? "high" : "medium",
        scope: "athlete",
      });
    }
    if (sets.length) {
      facts.push(...sets);
      used++;
      continue;
    }
    // pain / injury notes
    if (RISK.test(rest)) {
      const places = [...new Set((rest.match(PLACE) ?? []).map((p) => p.toLowerCase()))];
      facts.push({
        kind: "risk",
        lift: liftIn(rest),
        date: inline ?? date,
        data: { text: rest.slice(0, 280), place: places.length ? places.join(" ") : null, status: RESOLVED.test(rest) ? "resolved" : "unknown" },
        quote,
        location: loc,
        confidence: "medium",
        scope: "athlete",
      });
      used++;
      continue;
    }
    narrative.push(line);
  }
  return { facts, narrative, used, seen };
}

/* ------------------------------------------------------------------ */
/* Units                                                              */

/** The plausible kg range of a competition lift by bodyweight (very wide: novices to elite). */
const RATIO_MAX: Record<Lift, number> = { squat: 4, bench: 2.8, deadlift: 4.3 };

/**
 * The unit a file's loads are in when it doesn't say: from its own words,
 * then the athlete's meets (a value that reads as a meet-sized lift in one
 * unit and an impossible one in the other), then their bodyweight, then
 * their confirmed preference. Null when nothing settles it.
 */
export function inferUnit(
  loads: Array<{ lift: Lift; value: number }>,
  ctx: { text: string; meetBestKg?: Partial<Record<Lift, number>>; bodyweightKg?: number | null; preferred?: Unit | null },
): { unit: Unit | null; why: string | null } {
  const t = ctx.text.toLowerCase();
  const kgWords = (t.match(/\b\d+(?:[.,]\d+)?\s*kgs?\b|\bkgs?\b|\bkilo/g) ?? []).length;
  const lbWords = (t.match(/\b\d+(?:[.,]\d+)?\s*lbs?\b|\blbs?\b|\bpounds?\b/g) ?? []).length;
  if (kgWords > lbWords * 2 && kgWords >= 1) return { unit: "kg", why: "The file says kg" };
  if (lbWords > kgWords * 2 && lbWords >= 1) return { unit: "lb", why: "The file says lb" };
  if (!loads.length) return { unit: ctx.preferred ?? null, why: ctx.preferred ? "Their usual unit" : null };
  const top: Partial<Record<Lift, number>> = {};
  for (const l of loads) top[l.lift] = Math.max(top[l.lift] ?? 0, l.value);
  let kgVotes = 0;
  let lbVotes = 0;
  for (const [lift, v] of Object.entries(top) as Array<[Lift, number]>) {
    const best = ctx.meetBestKg?.[lift];
    if (best) {
      const asKg = v / best;
      const asLb = (v * 0.45359237) / best;
      const fits = (r: number) => r >= 0.55 && r <= 1.15;
      if (fits(asKg) && !fits(asLb)) kgVotes++;
      else if (fits(asLb) && !fits(asKg)) lbVotes++;
      continue;
    }
    const bw = ctx.bodyweightKg;
    if (bw) {
      if (v / bw > RATIO_MAX[lift]) lbVotes++;
      continue;
    }
    if (v > (lift === "bench" ? 260 : 360)) lbVotes++;
  }
  if (kgVotes && !lbVotes) return { unit: "kg", why: "The loads match their meet lifts in kg" };
  if (lbVotes && !kgVotes) return { unit: "lb", why: "The loads only make sense in lb" };
  return { unit: ctx.preferred ?? null, why: ctx.preferred ? "Their usual unit" : null };
}

/* ------------------------------------------------------------------ */
/* The file                                                           */

function rowsToFacts(rows: Row[]): RawFact[] {
  // the same set written on several rows (set 1, set 2…) is one group
  const groups = new Map<string, Row & { n: number }>();
  for (const r of rows) {
    const key = [r.date, r.week, r.day, norm(r.exercise), r.load, r.unit, r.reps, r.rpe, r.rir, r.pct, r.completion].join("|");
    const g = groups.get(key);
    if (g) {
      g.n += r.sets;
      continue;
    }
    groups.set(key, { ...r, n: r.sets });
  }
  return [...groups.values()].map((g) => {
    const cls = classifyExercise(g.exercise);
    return {
      kind: "training" as const,
      lift: cls.lift,
      date: g.date,
      data: {
        exercise: g.exercise.slice(0, 80),
        standard: cls.standard,
        sets: Math.min(12, g.n),
        reps: g.reps,
        load: g.load,
        unit: g.unit,
        loadKg: g.load != null && g.unit ? toKg(g.load, g.unit) : null,
        pct: g.pct,
        rpe: g.rpe,
        rir: g.rir,
        completion: g.completion,
        planned: g.planned ?? null,
        week: g.week,
        day: g.day,
        order: g.order,
      } satisfies TrainingData,
      quote: g.quote,
      location: g.location,
      confidence: g.unit ? g.confidence : "medium",
      scope: "athlete" as const,
    };
  });
}

/** Everything the reader can take from a file or text without AI. */
export function readSource(input: ReadInput, opts: ReadOptions): ReadResult {
  const sheets = input.sheets ?? [];
  const facts: RawFact[] = [];
  let rows = 0;
  let understood = 0;
  const narrative: string[] = [];
  let completionWhy: string | null = null;
  const fileName = input.name ?? "";
  const tableRows: Row[] = [];
  let baseOrder = 0;
  for (const sh of sheets) {
    const h = findHeader(sh);
    if (!h) {
      // no header: the sheet's text is read line by line below
      continue;
    }
    const t = readTable(sh, h.at, h.headers, { fileName, today: opts.today, declared: opts.declared, unit: null, baseOrder });
    baseOrder += sh.rows.length;
    tableRows.push(...t.rows);
    facts.push(...t.meets, ...t.bodyweights);
    rows += t.seen;
    understood += t.used;
    const actualCols = h.headers.some((x) => x && x.when === "actual");
    completionWhy = actualCols
      ? "Completed sets are read from the file's actual / done columns"
      : LOG_NAME.test(norm(`${fileName} ${sh.name}`)) || opts.declared.includes("logs")
        ? "The file is a training log"
        : completionWhy;
  }
  const tableSheets = new Set(sheets.filter((s) => findHeader(s)).map((s) => s.name));
  const lineText = sheets.length
    ? sheets
        .filter((s) => !tableSheets.has(s.name))
        .map((s) => s.rows.map((r) => r.filter((c) => String(c ?? "").trim()).join(" ")).join("\n"))
        .join("\n")
    : input.text;
  // lines: the reader's completion for dated sets follows what the person said, else unknown
  const lineCompletion: Completion = opts.declared.includes("logs") ? "completed" : opts.declared.includes("program") ? "prescribed" : "unknown";
  const lines = readLines(lineText, { ...opts, unit: null, completion: lineCompletion });
  rows += lines.seen;
  understood += lines.used;
  narrative.push(...lines.narrative);
  facts.push(...rowsToFacts(tableRows), ...lines.facts);

  // one unit for the file's loads that didn't say
  const loads = facts
    .filter((f) => f.kind === "training" && f.lift && (f.data as TrainingData).load != null && !(f.data as TrainingData).unit)
    .map((f) => ({ lift: f.lift as Lift, value: (f.data as TrainingData).load as number }));
  const inferred = inferUnit(loads, {
    text: input.text,
    meetBestKg: opts.meetBestKg,
    bodyweightKg: opts.bodyweightKg,
    preferred: opts.preferredUnit,
  });
  const unknownUnit = !inferred.unit && loads.length > 0;
  if (inferred.unit) {
    for (const f of facts) {
      if (f.kind === "training") {
        const d = f.data as TrainingData;
        if (d.load != null && !d.unit) {
          d.unit = inferred.unit;
          d.loadKg = toKg(d.load, inferred.unit);
          if (f.confidence === "high") f.confidence = "medium";
        }
      }
    }
  }
  return {
    facts,
    unit: inferred.unit,
    unitWhy: inferred.why,
    rows,
    understood,
    narrative: narrative.join("\n").slice(0, 60_000),
    completionWhy:
      completionWhy ??
      (lineCompletion === "completed" ? "You said it's completed training" : lineCompletion === "prescribed" ? "You said it's a program" : null),
    unitUnknown: unknownUnit,
  };
}

const DIRECTIVE = /\b(remind|make sure|don'?t|do not|never|always|keep (her|him|them|it)|tell (her|him|them)|take (her|his|their) time|on meet day|on the platform|at the meet|between attempts|before (the )?(opener|attempts?|lifting)|should|needs? to)\b/i;
const MEET_WORDS = /\b(meet day|platform|opener|attempts?|weigh[- ]?in|flight|warm[- ]?up room|at the meet|comp day)\b/i;

/**
 * Lines the reader couldn't place, kept in the source's own words when no AI
 * read is going to look at them (short notes, or AI not allowed): a direction
 * ("remind her to take her time on meet day") is an instruction, anything else
 * a note. Copied, never rephrased, so nothing has to be checked against the file.
 */
export function notesFromNarrative(narrative: string): RawFact[] {
  const out: RawFact[] = [];
  const seen = new Set<string>();
  for (const raw of narrative.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 15 || line.length > 400 || !/[a-z]{3}/i.test(line)) continue;
    const k = norm(line);
    if (seen.has(k)) continue;
    seen.add(k);
    const kind = DIRECTIVE.test(line) ? "instruction" : "note";
    out.push({ kind, lift: liftIn(line), date: null, data: { text: line }, quote: line.slice(0, 300), location: null, confidence: "high", scope: MEET_WORDS.test(line) ? "meet" : "athlete" });
    if (out.length >= 12) break;
  }
  return out;
}

/** Whether what's left after the reader is worth an AI read (notes, cues, instructions in paragraphs). */
export function needsAiRead(kind: string, r: Pick<ReadResult, "narrative" | "rows" | "understood">): boolean {
  if (kind === "pdf" || kind === "image") return true;
  if (kind === "video") return false;
  const left = r.narrative.replace(/\s+/g, " ").trim();
  if (left.length >= 120) return true;
  if (r.rows >= 6 && r.understood / Math.max(1, r.rows) < 0.6) return true;
  return false;
}
