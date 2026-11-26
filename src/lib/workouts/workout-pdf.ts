/**
 * The training PDFs (Nov 22 2026), drawn with the JF Effect PDF kit
 * (src/lib/pdf): one set of records (training-report-data.ts), two documents.
 *
 * - Program: what to do. A cover with the blocks and the maxes any % reads
 *   from, then every block, week and workout as a table (exercise with its
 *   role, sets, reps or time, load as the coach wrote it, effort, rest, tempo;
 *   a column only when the block uses it), the coach's exercise note under its
 *   row, a day's note under its table. A week with exactly the workouts of the
 *   week before says so in a line instead of printing them again.
 * - Training report: what happened. A summary (workouts done of those due,
 *   missed, sets logged, a chart of sets a week, each block), then every
 *   trained workout as exercise · prescribed · logged (identical sets in a row
 *   said once), its notes, and the workouts that weren't trained listed by
 *   status in one compact table: Missed, Upcoming, Skipped (an optional day).
 *
 * A workout's status is read against today: done → Completed, sets logged but
 * not finished → In progress (or Partly logged once its day has passed),
 * nothing logged on a day that's over → Missed (Skipped for an optional
 * workout), else Today / Upcoming. A load reads as the athlete typed it; a
 * prescription as the coach wrote it (a % with what it's of, never a weight
 * the app would work out on the day). The client's copy shows a generated
 * exercise note without the app's boilerplate (`exerciseNoteForAthlete`) and
 * only day notes marked for them (the data leaves the rest out).
 */
import { PdfDoc, PDF_COLOR, type Col, type TableSpec, type Tone } from "@/lib/pdf/kit";
import { drawBarChart, chartRow } from "@/lib/pdf/charts";
import { pdfDate, pdfDuration, pdfFileName, pdfNumber, pdfRange, pdfText, plural, isoDay } from "@/lib/pdf/text";
import { loggedSetHasInput } from "@/lib/workouts/training-report-data";
import { exerciseNoteForAthlete } from "@/lib/workouts/coach-notes";
import {
  exerciseName,
  loggedLines,
  prescribedEffort,
  prescribedLoad,
  prescribedReps,
  prescriptionLine,
  roleOf,
  type LoggedSet,
  type PrescriptionRow,
} from "@/lib/workouts/training-words";

/* ───────────────────────────── Records ───────────────────────────── */

export type { LoggedSet, PrescriptionRow } from "@/lib/workouts/training-words";
// the words live in training-words.ts (no PDF code); still exported here for the PDF's callers
export { loggedLines, loggedLoad, loggedSetText, prescribedEffort, prescribedLoad, prescribedReps, prescriptionLine } from "@/lib/workouts/training-words";

type Row = PrescriptionRow;

type Day = {
  id: string;
  day_index: number;
  title?: string | null;
  notes?: string | null;
  notes_client_visible?: boolean | null;
  scheduled_date?: string | null;
  is_optional?: boolean | null;
  started_at?: string | null;
  in_progress_at?: string | null;
  completed_at?: string | null;
  completion_note?: string | null;
  rows: Row[];
  /** The athlete's own notes on exercises that day (pl_exercise_notes). */
  client_exercise_notes?: Array<{
    row_id?: string | null;
    exercise_name?: string | null;
    content: string;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
};

type Week = {
  id: string;
  week_index: number;
  notes?: string | null;
  days: Day[];
};

export type FullTrainingReportBlock = {
  block_name?: string | null;
  block_status?: string | null;
  block_start?: string | null;
  block_end?: string | null;
  weeks: Week[];
};

/** A max a % prescription reads from (the program's cover lists them). */
export type ReportMax = {
  lift: string;
  unit: "kg" | "lb";
  one_rm: number | null;
  training_max: number | null;
  estimated_1rm: number | null;
  /** The block it's held for, by name; null for every program. */
  block: string | null;
};

export type FullTrainingReportData = {
  client_name?: string | null;
  /** The program the blocks belong to (their meet prep's title), when they all share one. */
  program_name?: string | null;
  /** The meet they build to, when there is one. */
  meet?: { name: string | null; date: string | null } | null;
  /** A library plan's own words and facts (its level, style, equipment), for the program's cover. */
  description?: string | null;
  facts?: Array<[string, string | null | undefined]>;
  generated_at?: Date;
  /** A coach's copy carries their private day notes; a client's never does (the data leaves them out). */
  audience?: "coach" | "client";
  blocks: FullTrainingReportBlock[];
  /** "YYYY-MM-DD": what counts as past (missed) and ahead (upcoming). Default: the device's today. */
  today?: string;
  /** The maxes on file, for a program whose loads are a % of one. */
  maxes?: ReportMax[];
};

type BuildOpts = { logo?: string | null; compress?: boolean };

/* ───────────────────────────── Headings ───────────────────────────── */

/** "Day 5 — Primer" from a coach who typed the number again: "Primer". */
export function dayTitleWithoutNumber(title: string | null | undefined, index: number): string {
  const cleaned = pdfText(title);
  if (!cleaned) return "";
  return cleaned.replace(new RegExp(`^(?:day|d)\\s*0*${index}\\b[\\s\\-–—:.]*`, "i"), "").trim();
}

function dayHeading(day: Day): string {
  const t = dayTitleWithoutNumber(day.title, day.day_index);
  return t ? `Day ${day.day_index} · ${t}` : `Day ${day.day_index}`;
}

/* ───────────────────────────── Status ───────────────────────────── */

export type DayStatus = { key: "completed" | "in_progress" | "partial" | "missed" | "skipped" | "today" | "upcoming" | "unscheduled"; label: string; tone: Tone; trained: boolean };

const countLogged = (day: Day) => day.rows.reduce((n, r) => n + (r.logged_sets ?? []).filter(loggedSetHasInput).length, 0);

/** Where a workout stands, against today. */
export function dayStatus(day: Day, today: string): DayStatus {
  const date = day.scheduled_date?.slice(0, 10) ?? null;
  if (day.completed_at) return { key: "completed", label: "Completed", tone: "good", trained: true };
  const logged = countLogged(day);
  if (logged > 0 || day.started_at || day.in_progress_at) {
    if (logged > 0 && date && date < today) return { key: "partial", label: "Partly logged", tone: "warn", trained: true };
    return { key: "in_progress", label: "In progress", tone: "warn", trained: logged > 0 };
  }
  if (!date) return { key: "unscheduled", label: "Not scheduled", tone: "muted", trained: false };
  if (date < today) return day.is_optional ? { key: "skipped", label: "Skipped (optional)", tone: "muted", trained: false } : { key: "missed", label: "Missed", tone: "bad", trained: false };
  if (date === today) return { key: "today", label: "Today", tone: "neutral", trained: false };
  return { key: "upcoming", label: "Upcoming", tone: "muted", trained: false };
}

const sortedRows = (d: Day) => d.rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

function weekDates(week: Week): string {
  const dates = week.days.map((d) => d.scheduled_date?.slice(0, 10)).filter(Boolean).sort() as string[];
  return dates.length ? pdfRange(dates[0], dates[dates.length - 1]) : "";
}

function blockDates(b: FullTrainingReportBlock): string {
  if (b.block_start || b.block_end) return pdfRange(b.block_start, b.block_end);
  const dates = b.weeks.flatMap((w) => w.days.map((d) => d.scheduled_date?.slice(0, 10))).filter(Boolean).sort() as string[];
  return dates.length ? pdfRange(dates[0], dates[dates.length - 1]) : "";
}

function allDates(data: FullTrainingReportData): string {
  const starts = data.blocks.map((b) => b.block_start ?? b.weeks[0]?.days[0]?.scheduled_date ?? null).filter(Boolean).sort() as string[];
  const ends = data.blocks.map((b) => b.block_end ?? null).filter(Boolean).sort() as string[];
  return starts.length || ends.length ? pdfRange(starts[0] ?? null, ends[ends.length - 1] ?? null) : "";
}

/** Workouts a week (the most common count), and how many of them are optional. */
function daysPerWeek(b: FullTrainingReportBlock): { core: number; optional: number } | null {
  if (!b.weeks.length) return null;
  const counts = new Map<string, number>();
  for (const w of b.weeks) {
    const key = `${w.days.filter((d) => !d.is_optional).length}:${w.days.filter((d) => d.is_optional).length}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [core, optional] = best.split(":").map(Number);
  return { core, optional };
}

function perWeekWords(p: { core: number; optional: number } | null): string {
  if (!p) return "";
  return `${p.core} a week${p.optional ? ` + ${p.optional} optional` : ""}`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "Jared's " (for a title), or "" without a name. */
function firstName(name: string | null | undefined): string {
  const f = pdfText(name).split(/\s+/)[0];
  if (!f) return "";
  return `${f}${/s$/i.test(f) ? "'" : "'s"} `;
}

const noteFor = (r: Row, week: number, audience: "coach" | "client") => (audience === "client" ? exerciseNoteForAthlete(r.notes, week) : pdfText(r.notes) || null);

/* ───────────────────────────── Program ───────────────────────────── */

type BlockCols = { load: number | null; effort: number | null; rest: number | null; tempo: number | null; reps: number };

function programTable(day: Day, week: Week, cols: BlockCols, audience: "coach" | "client"): TableSpec {
  const rows = sortedRows(day);
  const columns: Col[] = [
    { header: "", width: 18, muted: true },
    { header: "Exercise", width: "auto", bold: true },
    { header: "Sets", width: 34, align: "center" },
    { header: "Reps", width: cols.reps, align: "center" },
  ];
  if (cols.load) columns.push({ header: "Load", width: cols.load });
  if (cols.effort) columns.push({ header: "Effort", width: cols.effort });
  if (cols.rest) columns.push({ header: "Rest", width: cols.rest });
  if (cols.tempo) columns.push({ header: "Tempo", width: cols.tempo });
  const notes = new Map<number, string>();
  const sub = new Map<string, string>();
  const body = rows.map((r, i) => {
    const note = noteFor(r, week.week_index, audience);
    if (note) notes.set(i, note);
    const role = roleOf(r);
    if (role) sub.set(`${i}:1`, role);
    const cells: string[] = [String(i + 1), exerciseName(r), r.sets != null ? String(r.sets) : "", prescribedReps(r) ?? ""];
    if (cols.load) cells.push(prescribedLoad(r) ?? "");
    if (cols.effort) cells.push(prescribedEffort(r) ?? "");
    if (cols.rest) cells.push(r.rest_seconds ? pdfDuration(r.rest_seconds) : "");
    if (cols.tempo) cells.push(pdfText(r.tempo));
    return cells;
  });
  const dayNote = pdfText(day.notes);
  return {
    columns,
    rows: body,
    notes,
    sub,
    title: {
      text: dayHeading(day) + (day.is_optional ? " (optional)" : ""),
      atPageTop: `Week ${week.week_index} · ${dayHeading(day)}${day.is_optional ? " (optional)" : ""}`,
      right: day.scheduled_date ? pdfDate(day.scheduled_date, { weekday: true, year: "never" }) : null,
    },
    footnotes: dayNote ? [`${audience === "coach" && day.notes_client_visible !== true ? "Coach note (private)" : "Coach note"}: ${dayNote}`] : [],
  };
}

/** What a day prescribes, for spotting a week that repeats the one before. */
function daySignature(day: Day, week: number, audience: "coach" | "client"): string {
  return [
    dayHeading(day),
    day.is_optional ? "opt" : "",
    pdfText(day.notes),
    ...sortedRows(day).map((r) => [exerciseName(r), roleOf(r), prescriptionLine(r), noteFor(r, week, audience)].join("|")),
  ].join("#");
}

/** The block's columns, each as wide as its longest value anywhere in the block, so every table in it lines up. */
function blockColumns(pdf: PdfDoc, b: FullTrainingReportBlock): BlockCols {
  const rows = b.weeks.flatMap((w) => w.days.flatMap((d) => d.rows));
  const width = (header: string, values: Array<string | null>, max: number): number | null => {
    const v = values.filter((x): x is string => !!x);
    if (!v.length) return null;
    return Math.min(max, Math.ceil(Math.max(pdf.textWidth([header], 7.5, "bold"), pdf.textWidth(v, 9)) + 13));
  };
  return {
    reps: width("Reps", rows.map((r) => prescribedReps(r)), 70) ?? 40,
    load: width("Load", rows.map((r) => prescribedLoad(r)), 110),
    effort: width("Effort", rows.map((r) => prescribedEffort(r)), 72),
    rest: width("Rest", rows.map((r) => (r.rest_seconds ? pdfDuration(r.rest_seconds) : null)), 60),
    tempo: width("Tempo", rows.map((r) => pdfText(r.tempo) || null), 60),
  };
}

const MAX_BASES = new Set(["training_max", "1rm", "est_1rm", "comp_pr", "var_e1rm"]);

export function generateProgramPdf(data: FullTrainingReportData, opts: BuildOpts = {}): PdfDoc {
  const audience = data.audience ?? "client";
  const blocks = data.blocks.filter((b) => b.weeks.some((w) => w.days.length));
  const one = blocks.length === 1 ? blocks[0] : null;
  const weeks = blocks.reduce((n, b) => n + b.weeks.length, 0);
  const meetLine = data.meet?.name || data.meet?.date ? [data.meet?.name, data.meet?.date ? pdfDate(data.meet.date) : null].filter(Boolean).join(" · ") : null;
  const pdf = new PdfDoc({
    kind: "Training program",
    title: pdfText(data.program_name) || (one ? pdfText(one.block_name) || "Training program" : cap(`${firstName(data.client_name)}training program`)),
    subtitle: allDates(data) || null,
    person: data.client_name ?? null,
    generatedAt: data.generated_at,
    logo: opts.logo,
    compress: opts.compress,
    facts: [
      ["Athlete", data.client_name ?? null],
      ["Length", weeks ? `${plural(weeks, "week")}${blocks.length > 1 ? ` · ${plural(blocks.length, "block")}` : ""}` : null],
      ["Workouts", one ? perWeekWords(daysPerWeek(one)) : perWeekWords(daysPerWeek({ weeks: blocks.flatMap((b) => b.weeks) }))],
      ["Meet", meetLine],
      ...(data.facts ?? []),
    ],
  });
  if (pdfText(data.description)) pdf.paragraph(data.description, { gapAfter: 10 });

  if (!blocks.length) {
    pdf.paragraph("There are no workouts in the blocks picked.", { color: PDF_COLOR.muted });
    return pdf;
  }

  if (blocks.length > 1) {
    pdf.heading("Blocks", { keepWith: 80 });
    const dated = blocks.some((b) => blockDates(b));
    pdf.table({
      columns: [
        { header: "Block", width: "auto", bold: true },
        ...(dated ? [{ header: "Dates", width: "fit" as const, max: 170 }] : []),
        { header: "Weeks", width: 44, align: "center" },
        { header: "Workouts", width: "fit", max: 110 },
      ],
      rows: blocks.map((b) => [pdfText(b.block_name) || "Training block", ...(dated ? [blockDates(b) || "–"] : []), String(b.weeks.length), perWeekWords(daysPerWeek(b))]),
    });
  }

  const usesMax = blocks.some((b) => b.weeks.some((w) => w.days.some((d) => d.rows.some((r) => Number(r.percentage) > 0 && MAX_BASES.has(String(r.percentage_basis))))));
  const maxes = (data.maxes ?? []).filter((m) => m.one_rm != null || m.training_max != null || m.estimated_1rm != null);
  if (usesMax && maxes.length) {
    pdf.heading("Maxes the percentages use", { level: 2, keepWith: 60 });
    const f = (v: number | null, u: string) => (v != null ? `${pdfNumber(v, 2)} ${u}` : "–");
    pdf.table({
      columns: [
        { header: "Lift", width: "auto", bold: true },
        { header: "1RM", width: "fit", align: "right" },
        { header: "Training max", width: "fit", align: "right" },
        { header: "Estimated 1RM", width: "fit", align: "right" },
        { header: "Held for", width: "fit", max: 150, muted: true },
      ],
      rows: maxes.map((m) => [m.lift, f(m.one_rm, m.unit), f(m.training_max, m.unit), f(m.estimated_1rm, m.unit), m.block ?? "Every program"]),
      gapAfter: 6,
    });
  }

  pdf.heading("How to read it", { level: 3, keepWith: 30 });
  pdf.paragraph(
    "Load is a weight, or a percentage of a max (TM = training max, 1RM = one-rep max, e1RM = estimated 1RM) or of the top set you lift that day. Effort is RPE (how hard, out of 10) or RIR (reps left in reserve). Rest is between sets. The app shows each weight on the day and adjusts it to how your sets go.",
    { size: 8.5, color: PDF_COLOR.muted, gapAfter: 4 },
  );

  blocks.forEach((b, bi) => {
    const cols = blockColumns(pdf, b);
    const per = perWeekWords(daysPerWeek(b));
    // a block starts a page, except the first when the cover leaves room for it; one block is the cover's own title
    const coverRoom = bi === 0 && pdf.bottom - pdf.y > pdf.pageContentHeight * 0.4;
    if (blocks.length > 1) pdf.heading(pdfText(b.block_name) || "Training block", {
      newPage: !coverRoom,
      right: blockDates(b) || null,
      sub: [blocks.length > 1 ? `Block ${bi + 1} of ${blocks.length}` : null, plural(b.weeks.length, "week"), per || null].filter(Boolean).join(" · "),
    });
    let prev: { index: number; sig: string } | null = null;
    for (const week of b.weeks) {
      const sig = week.days.map((d) => daySignature(d, week.week_index, audience)).join("$");
      const weekNote = pdfText(week.notes);
      if (prev && sig === prev.sig && !weekNote) {
        pdf.heading(`Week ${week.week_index}`, { level: 2, right: weekDates(week) || null, keepWith: 20, sub: `Same workouts as Week ${prev.index}.${week.days.some((d) => d.scheduled_date) ? ` ${week.days.map((d) => `Day ${d.day_index} ${pdfDate(d.scheduled_date, { weekday: true, year: "never" })}`.trim()).join(" · ")}` : ""}` });
        continue;
      }
      prev = { index: week.week_index, sig };
      const tables = week.days.map((d) => programTable(d, week, cols, audience));
      const firstH = tables[0] ? Math.min(pdf.measure(tables[0]), 220) : 40;
      pdf.heading(`Week ${week.week_index}`, { level: 2, right: weekDates(week) || null, sub: weekNote || null, keepWith: firstH });
      week.days.forEach((d, i) => {
        if (!d.rows.length) {
          pdf.heading(dayHeading(d), { level: 3, right: d.scheduled_date ? pdfDate(d.scheduled_date, { weekday: true, year: "never" }) : null, sub: "Rest or nothing written yet.", keepWith: 10 });
          return;
        }
        pdf.table(tables[i]);
      });
    }
  });
  return pdf;
}

/* ───────────────────────────── Report ───────────────────────────── */

function reportTable(day: Day, week: Week, status: DayStatus, audience: "coach" | "client"): TableSpec {
  const rows = sortedRows(day);
  const you = audience === "client" ? "Your note" : "Athlete's note";
  const exNotes = (day.client_exercise_notes ?? []).filter((n) => pdfText(n.content));
  const notes = new Map<number, string>();
  const sub = new Map<string, string>();
  const used = new Set<number>();
  const body = rows.map((r, i) => {
    const role = roleOf(r);
    if (role) sub.set(`${i}:0`, role);
    const parts: string[] = [];
    const coach = noteFor(r, week.week_index, audience);
    if (coach) parts.push(`Coach: ${coach}`);
    exNotes.forEach((n, k) => {
      if (n.row_id && n.row_id === r.id) {
        parts.push(`${you}: ${pdfText(n.content)}`);
        used.add(k);
      }
    });
    for (const s of r.logged_sets ?? []) {
      const t = pdfText(s.notes);
      if (t) parts.push(`${you} (set ${s.set_index ?? "?"}): ${t}`);
    }
    if (parts.length) notes.set(i, parts.join("  ·  "));
    const lines = loggedLines(r.logged_sets ?? []);
    return [exerciseName(r), prescriptionLine(r) || "–", lines.length ? lines.join("\n") : status.key === "completed" ? "Nothing logged" : "–"];
  });
  const footnotes: string[] = [];
  exNotes.forEach((n, k) => {
    if (!used.has(k)) footnotes.push(`${you} on ${pdfText(n.exercise_name) || "an exercise"}: ${pdfText(n.content)}`);
  });
  if (pdfText(day.completion_note)) footnotes.push(`${audience === "client" ? "Your review" : "Athlete's review"}: ${pdfText(day.completion_note)}`);
  if (pdfText(day.notes)) footnotes.push(`${audience === "coach" && day.notes_client_visible !== true ? "Coach note (private)" : "Coach note"}: ${pdfText(day.notes)}`);
  const when = status.key === "completed" && day.completed_at ? pdfDate(day.completed_at, { weekday: true, year: "never" }) : day.scheduled_date ? pdfDate(day.scheduled_date, { weekday: true, year: "never" }) : "";
  return {
    columns: [
      { header: "Exercise", width: 150, bold: true },
      { header: "Prescribed", width: 150, muted: true },
      { header: "Logged", width: "auto" },
    ],
    rows: body,
    notes,
    sub,
    footnotes,
    title: {
      text: dayHeading(day) + (day.is_optional ? " (optional)" : ""),
      atPageTop: `Week ${week.week_index} · ${dayHeading(day)}${day.is_optional ? " (optional)" : ""}`,
      right: [status.label, when].filter(Boolean).join(" · "),
      rightTone: status.tone,
    },
  };
}

type Counts = { planned: number; due: number; done: number; missed: number; inProgress: number; sets: number };

function countDays(blocks: FullTrainingReportBlock[], today: string): Counts {
  const c: Counts = { planned: 0, due: 0, done: 0, missed: 0, inProgress: 0, sets: 0 };
  for (const b of blocks)
    for (const w of b.weeks)
      for (const d of w.days) {
        const s = dayStatus(d, today);
        c.planned++;
        c.sets += countLogged(d);
        if (s.key === "completed") c.done++;
        if (s.key === "missed") c.missed++;
        if (s.key === "in_progress" || s.key === "partial") c.inProgress++;
        // due: its day has come (or it was trained anyway); an optional workout only counts when trained
        const date = d.scheduled_date?.slice(0, 10);
        if (s.trained || s.key === "completed" || (date && date <= today && !d.is_optional)) c.due++;
      }
  return c;
}

/** Sets logged per week (Monday weeks), for the summary chart. */
function setsByWeek(blocks: FullTrainingReportBlock[]): Array<{ label: string; value: number }> {
  const byWeek = new Map<string, number>();
  for (const b of blocks)
    for (const w of b.weeks)
      for (const d of w.days) {
        const n = countLogged(d);
        const when = (d.completed_at ?? d.scheduled_date)?.slice(0, 10);
        if (!n || !when) continue;
        const [y, m, dd] = when.split("-").map(Number);
        const dt = new Date(y, m - 1, dd);
        dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
        const key = isoDay(dt);
        byWeek.set(key, (byWeek.get(key) ?? 0) + n);
      }
  const keys = [...byWeek.keys()].sort();
  if (!keys.length) return [];
  // every week between the first and the last, a week with nothing as 0
  const out: Array<{ label: string; value: number }> = [];
  const [y, m, d] = keys[0].split("-").map(Number);
  const cur = new Date(y, m - 1, d);
  const last = keys[keys.length - 1];
  while (isoDay(cur) <= last && out.length < 80) {
    const k = isoDay(cur);
    out.push({ label: pdfDate(k, { year: "never" }), value: byWeek.get(k) ?? 0 });
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

export function buildTrainingReportDoc(data: FullTrainingReportData, opts: BuildOpts = {}): PdfDoc {
  const audience = data.audience ?? "coach";
  const today = data.today ?? isoDay(new Date());
  const blocks = data.blocks;
  const one = blocks.length === 1 ? blocks[0] : null;
  const all = countDays(blocks, today);
  const pdf = new PdfDoc({
    kind: "Training report",
    title: pdfText(data.program_name) || (one ? pdfText(one.block_name) || "Training report" : cap(`${firstName(data.client_name)}training report`)),
    subtitle: allDates(data) || null,
    person: data.client_name ?? null,
    generatedAt: data.generated_at,
    logo: opts.logo,
    compress: opts.compress,
    facts: [
      ["Athlete", data.client_name ?? null],
      ["Blocks", blocks.length ? plural(blocks.length, "block") : null],
      ["Workouts done", all.due ? `${all.done} of ${all.due} due` : null],
      ["Sets logged", all.sets ? all.sets.toLocaleString("en-US") : null],
    ],
  });

  if (!blocks.length) {
    pdf.paragraph("No training blocks were picked.", { color: PDF_COLOR.muted });
    return pdf;
  }

  pdf.heading("Summary", { keepWith: 90 });
  const pct = all.due ? Math.round((all.done / all.due) * 100) : null;
  pdf.tiles([
    { label: "Workouts completed", value: `${all.done}`, sub: all.due ? `of ${all.due} due so far` : null },
    { label: "Completion", value: pct != null ? `${pct}%` : "–", sub: "of workouts due", tone: pct == null ? "neutral" : pct >= 85 ? "good" : pct >= 60 ? "neutral" : "warn" },
    { label: "Missed", value: `${all.missed}`, sub: all.inProgress ? `${all.inProgress} partly logged` : null, tone: all.missed ? "bad" : "neutral" },
    { label: "Sets logged", value: all.sets.toLocaleString("en-US") },
  ]);
  const weekly = setsByWeek(blocks);
  if (weekly.length >= 2) {
    chartRow(pdf, 150, [(doc, box) => drawBarChart(doc, box, { title: "Sets logged each week", bars: weekly.map((w) => ({ label: w.label, value: w.value })), valueLabels: weekly.length <= 14 })]);
  }
  if (blocks.length > 1) {
    pdf.table({
      columns: [
        { header: "Block", width: "auto", bold: true },
        { header: "Dates", width: "fit", max: 160, muted: true },
        { header: "Done", width: "fit", align: "center" },
        { header: "Missed", width: "fit", align: "center" },
        { header: "Sets logged", width: "fit", align: "right" },
      ],
      rows: blocks.map((b) => {
        const c = countDays([b], today);
        return [pdfText(b.block_name) || "Training block", blockDates(b) || "–", c.due ? `${c.done} of ${c.due}` : `${c.done}`, String(c.missed), c.sets.toLocaleString("en-US")];
      }),
    });
  }
  pdf.paragraph(
    `Prescribed is what the program asked for; Logged is what was entered in the app, as typed (sets with the same numbers in a row are written once: "2–4" is sets 2 to 4). Workouts that weren't trained are listed at the end of each week.${audience === "coach" ? " Private coach notes are marked." : ""}`,
    { size: 8.5, color: PDF_COLOR.muted },
  );

  blocks.forEach((b, bi) => {
    const c = countDays([b], today);
    pdf.heading(pdfText(b.block_name) || "Training block", {
      newPage: true,
      right: blockDates(b) || null,
      sub: [blocks.length > 1 ? `Block ${bi + 1} of ${blocks.length}` : null, pdfText(b.block_status) || null, c.due ? `${c.done} of ${c.due} workouts done` : null, c.missed ? `${c.missed} missed` : null].filter(Boolean).join(" · "),
    });
    if (!b.weeks.length) {
      pdf.paragraph("Nothing trained in this block yet.", { color: PDF_COLOR.muted });
      return;
    }
    for (const week of b.weeks) {
      const statuses = week.days.map((d) => dayStatus(d, today));
      const trained = week.days.filter((_, i) => statuses[i].trained || statuses[i].key === "completed");
      const rest = week.days.filter((_, i) => !(statuses[i].trained || statuses[i].key === "completed"));
      const tables = trained.map((d) => reportTable(d, week, dayStatus(d, today), audience));
      const weekNote = pdfText(week.notes);
      const core = week.days.filter((d) => !d.is_optional).length;
      const doneCore = week.days.filter((d, i) => !d.is_optional && statuses[i].key === "completed").length;
      const doneOptional = week.days.filter((d, i) => d.is_optional && statuses[i].key === "completed").length;
      const firstH = tables[0] ? Math.min(pdf.measure(tables[0]), 220) : 50;
      pdf.heading(`Week ${week.week_index}`, {
        level: 2,
        right: weekDates(week) || null,
        sub: [core ? `${doneCore} of ${core} done` : null, doneOptional ? `${doneOptional} optional done` : null, weekNote || null].filter(Boolean).join(" · "),
        keepWith: firstH,
      });
      tables.forEach((t) => pdf.table(t));
      if (rest.length) {
        pdf.table({
          dense: true,
          columns: [
            { header: "Not trained", width: "auto" },
            { header: "Date", width: "fit", muted: true },
            { header: "Status", width: "fit", max: 120 },
          ],
          rows: rest.map((d) => [dayHeading(d) + (d.is_optional ? " (optional)" : ""), d.scheduled_date ? pdfDate(d.scheduled_date, { weekday: true, year: "never" }) : "–", dayStatus(d, today).label]),
          cellTone: (r, col) => (col === 2 ? dayStatus(rest[r], today).tone : null),
        });
      }
    }
  });
  return pdf;
}

/* ───────────────────────────── Files ───────────────────────────── */

/** The training report as jsPDF (kept for callers and tests that read the document). */
export function generateFullTrainingReportPdf(data: FullTrainingReportData, opts: BuildOpts = {}) {
  return buildTrainingReportDoc(data, opts).finish();
}

/** The report as a PDF file, for the share sheet or a download (see training-report-sheet). */
export function trainingReportPdfFile(data: FullTrainingReportData, fileName: string, logo?: string | null): File {
  return buildTrainingReportDoc(data, { logo }).toFile(fileName);
}

/** The program as a PDF file. */
export function programPdfFile(data: FullTrainingReportData, fileName: string, logo?: string | null): File {
  return generateProgramPdf(data, { logo }).toFile(fileName);
}

/** "jared-mcintyre-training-program-block-2-volume-2026-11-22.pdf". */
export function trainingPdfFileName(kind: "program" | "report", clientName: string | null | undefined, blockNames: string[], date = new Date()): string {
  return pdfFileName({ person: clientName, document: kind === "program" ? "training program" : "training report", detail: blockNames.length === 1 ? blockNames[0] : null, date });
}
