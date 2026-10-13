/**
 * Where a client is in their program, for the AI that reads their weekly
 * check-ins and nutrition updates: the week they just trained, the week
 * coming up (label + focus from the roadmap notes, the coach's wording first),
 * what the block is for, and how far out a meet is. Built on the same
 * roadmap the athlete sees (buildProgramRoadmap), so the AI and the app never
 * disagree about "week 3 of 5". Pure; the loader is program-context.server.ts.
 */
import { buildProgramRoadmap, type RoadmapNoteRow } from "@/lib/training-roadmap";
import { isReservedAtHomeBackupBlock } from "@/lib/at-home-backup";

export type ProgramWeek = {
  week_id: string;
  block_id: string;
  block: string;
  block_number: number;
  blocks_total: number;
  week: number;
  weeks_in_block: number;
  program_week: number;
  program_weeks: number;
  start: string | null;
  end: string | null;
  /** Roadmap label, e.g. "Intensification", "Deload", "Meet week". */
  label: string | null;
  /** Roadmap focus sentence for the week. */
  focus: string | null;
  /** The coach's own week note (pl_weeks.notes). */
  notes: string | null;
  /** Not published to the client yet. */
  draft: boolean;
  /** Session titles that week, in order. */
  sessions?: string[];
};

export type ProgramBlockInfo = {
  name: string;
  /** Phase label, e.g. "Hypertrophy", "Peak". */
  label: string | null;
  purpose: string | null;
  training_focus: string | null;
  goal: string | null;
  /** Coach-only; kept out of anything the client can read (see publicProgramContext). */
  coach_notes: string | null;
  draft: boolean;
};

export type ProgramContext = {
  program: string | null;
  status: "active" | "upcoming" | "completed";
  goal: string | null;
  meet: { name: string | null; date: string; days_out: number } | null;
  /** The block of the week just trained (else the block coming up). */
  block: ProgramBlockInfo | null;
  /** Set when next week starts a different block. */
  next_block: ProgramBlockInfo | null;
  this_week: ProgramWeek | null;
  next_week: ProgramWeek | null;
};

const clean = (s: unknown) => {
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : null;
};
const same = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * `ref` is a "YYYY-MM-DD" inside the week being reviewed (for a weekly
 * check-in, the middle of its check-in period; for anything else, today).
 * The week containing it is "this week", the one after is "next week". Between
 * blocks, this week is the last one finished and next week the next to start.
 */
export function programContextFor(input: {
  blocks: any[];
  weeks: any[];
  notes: RoadmapNoteRow[];
  preps?: any[];
  ref: string;
  ownerName?: string | null;
}): ProgramContext | null {
  const weeks = (input.weeks ?? []).filter((w) => !w.archived && !w.deleted_at);
  // A block with no weeks has no plan to read, and an undated one would pass
  // for "current" and pull the wrong program in.
  const withWeeks = new Set(weeks.map((w) => w.block_id));
  const blocks = (input.blocks ?? []).filter((b) => b?.id && !isReservedAtHomeBackupBlock(b) && withWeeks.has(b.id));
  if (!blocks.length) return null;
  const rm = buildProgramRoadmap({
    blocks,
    weeks,
    notes: input.notes ?? [],
    preps: input.preps ?? [],
    today: input.ref,
    ownerName: input.ownerName,
  });
  if (!rm) return null;

  const rawBlock = new Map<string, any>(blocks.map((b) => [b.id, b]));
  const rawWeek = new Map<string, any>(weeks.map((w) => [w.id, w]));
  const isDraft = (id: string) => String(rawBlock.get(id)?.status ?? "").toLowerCase() === "draft";

  const flat: ProgramWeek[] = [];
  rm.blocks.forEach((b, bi) => {
    b.weeks.forEach((w, wi) => {
      flat.push({
        week_id: w.id,
        block_id: b.id,
        block: b.name,
        block_number: bi + 1,
        blocks_total: rm.blocks.length,
        week: wi + 1,
        weeks_in_block: b.weekCount || b.weeks.length,
        program_week: flat.length + 1,
        program_weeks: rm.totalWeeks,
        start: w.start,
        end: w.end,
        label: w.label ?? clean(rawWeek.get(w.id)?.phase),
        focus: w.focus,
        notes: clean(rawWeek.get(w.id)?.notes),
        draft: isDraft(b.id),
      });
    });
  });

  if (!flat.length) return null;

  const ref = input.ref;
  const containing = flat.find((w) => w.start && w.end && w.start <= ref && ref <= w.end) ?? null;
  let thisWeek: ProgramWeek | null;
  let nextWeek: ProgramWeek | null;
  if (containing) {
    thisWeek = containing;
    nextWeek = flat[flat.indexOf(containing) + 1] ?? null;
  } else {
    thisWeek = [...flat].reverse().find((w) => w.end && w.end < ref) ?? null;
    nextWeek = flat.find((w) => w.start && w.start > ref) ?? null;
  }

  const info = (id: string | undefined): ProgramBlockInfo | null => {
    if (!id) return null;
    const v = rm.byBlock[id];
    const raw = rawBlock.get(id);
    if (!v) return null;
    const focus = clean(raw?.training_focus);
    return {
      name: v.name,
      label: v.label,
      purpose: v.purpose,
      training_focus: same(focus, v.label) || same(focus, v.name) ? null : focus,
      goal: clean(raw?.goal),
      coach_notes: clean(raw?.coach_notes),
      draft: isDraft(id),
    };
  };

  const prepId = rm.program.id.startsWith("prep:") ? rm.program.id.slice(5) : null;
  const prep = prepId ? (input.preps ?? []).find((p) => p.id === prepId) : null;
  const blockId = thisWeek?.block_id ?? nextWeek?.block_id;

  return {
    program: rm.program.title,
    status: rm.program.status,
    // Program type ("Off-Season", "Meet Prep"); current_focus is usually a stale copy of a block name.
    goal: clean(prep?.goal_type) && !same(clean(prep?.goal_type), "custom") ? clean(prep?.goal_type) : null,
    meet: rm.meet ? { name: rm.meet.name, date: rm.meet.date, days_out: rm.meet.daysOut } : null,
    block: info(blockId),
    next_block: nextWeek && thisWeek && nextWeek.block_id !== thisWeek.block_id ? info(nextWeek.block_id) : null,
    this_week: thisWeek,
    next_week: nextWeek,
  };
}

/** Session titles for this / next week, from that week's pl_days. */
export function attachSessions(
  ctx: ProgramContext,
  days: Array<{ week_id: string; day_index?: number | null; title?: string | null; focus?: string | null }>,
): ProgramContext {
  const forWeek = (w: ProgramWeek | null) => {
    if (!w) return w;
    const sessions = days
      .filter((d) => d.week_id === w.week_id)
      .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0))
      .map((d) => clean(d.title) ?? clean(d.focus))
      .filter((s): s is string => !!s)
      .slice(0, 8);
    return sessions.length ? { ...w, sessions } : w;
  };
  return { ...ctx, this_week: forWeek(ctx.this_week), next_week: forWeek(ctx.next_week) };
}

/** What may be stored where the client can read it: no coach notes, no ids. */
export function publicProgramContext(ctx: ProgramContext | null) {
  if (!ctx) return null;
  const block = (b: ProgramBlockInfo | null) => (b ? { ...b, coach_notes: undefined } : null);
  const week = (w: ProgramWeek | null) => (w ? { ...w, week_id: undefined, block_id: undefined, notes: undefined } : null);
  return { ...ctx, block: block(ctx.block), next_block: block(ctx.next_block), this_week: week(ctx.this_week), next_week: week(ctx.next_week) };
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

function weekLine(title: string, w: ProgramWeek): string {
  const dates = w.start && w.end ? `, ${fmtDay(w.start)}–${fmtDay(w.end)}` : "";
  const parts = [
    `${title}: week ${w.week} of ${w.weeks_in_block} in ${w.block} (program week ${w.program_week} of ${w.program_weeks}${dates})`,
    w.label && `label: ${w.label}`,
    w.focus && `focus: ${w.focus}`,
    w.notes && `coach's week note: ${w.notes}`,
    w.sessions?.length && `sessions: ${w.sessions.join(" | ")}`,
    w.week === w.weeks_in_block && "last week of this block",
    w.draft && "block is still a draft (not published to the client yet, may change)",
  ];
  return parts.filter(Boolean).join(" · ");
}

function blockLines(title: string, b: ProgramBlockInfo): string[] {
  return [
    `${title}: ${b.name}${b.label && !same(b.label, b.name) ? ` (phase: ${b.label})` : ""}${b.draft ? " (draft)" : ""}`,
    b.purpose && `  purpose: ${b.purpose}`,
    b.training_focus && `  coach's training focus: ${b.training_focus}`,
    b.goal && `  block goal: ${b.goal}`,
    b.coach_notes && `  coach notes: ${b.coach_notes}`,
  ].filter((l): l is string => !!l);
}

/** The program as plain lines for a prompt. Empty string when there's nothing. */
export function programContextText(ctx: ProgramContext | null): string {
  if (!ctx || (!ctx.this_week && !ctx.next_week && !ctx.block)) return "";
  const head = [
    `PROGRAM: ${ctx.program ?? "current training program"}`,
    ctx.goal && `goal: ${ctx.goal}`,
    ctx.meet && `meet: ${ctx.meet.name ?? "competition"} on ${fmtDay(ctx.meet.date)} (${ctx.meet.days_out} days out)`,
    ctx.status === "completed" && "this program has finished",
  ].filter(Boolean).join(" · ");
  const lines = [head];
  if (ctx.block) lines.push(...blockLines("CURRENT BLOCK", ctx.block));
  if (ctx.this_week) lines.push(weekLine("WEEK JUST TRAINED", ctx.this_week));
  if (ctx.next_week) lines.push(weekLine("UPCOMING WEEK", ctx.next_week));
  else lines.push("UPCOMING WEEK: nothing programmed yet");
  if (ctx.next_block) lines.push(...blockLines("NEW BLOCK STARTS NEXT WEEK", ctx.next_block));
  return lines.join("\n");
}

/** How the AI should use it (check-in replies and form reviews). */
export const PROGRAM_CONTEXT_RULES = [
  "PROGRAM CONTEXT is the coach's real plan: the week they just trained and the week coming up.",
  "Use it so the reply knows where they are. Tie the goals for the new week to the UPCOMING WEEK's focus (more volume, heavier top sets, higher RPE, deload, taper, meet week, a new block starting).",
  "Mention where they are only when it helps (\"last week of the volume block\", \"intensity goes up next week\"), never recite the whole plan.",
  "Only use what's written there. Never invent sets, reps, RPEs, percentages or exercises.",
  "If the check-in shows a problem (pain, poor sleep, missed sessions), say how to handle next week's focus with it, but don't rewrite the program.",
  "If there is no program context, don't guess where they are.",
].join("\n");

/** "Week 4 of 5 · Intensification" for the coach's recap card. */
export function weekChip(w: { week: number; weeks_in_block: number; label?: string | null } | null | undefined): string | null {
  if (!w) return null;
  return `Week ${w.week} of ${w.weeks_in_block}${w.label ? ` · ${w.label}` : ""}`;
}
