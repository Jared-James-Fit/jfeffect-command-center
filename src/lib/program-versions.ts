import {
  fmtWeight,
  loadText,
  totalWeeks,
  type PlanBlock,
  type PlanDay,
  type PlanExercise,
  type PlanWeek,
  type ProgramPlan,
} from "@/lib/program-plan";

/**
 * Program version history, the pure half (Nov 24 2026): what changed between
 * two saved states of a program, said the way a coach would say it ("Week 3 ·
 * Lower A — Competition Squat 3 × 5 → 4 × 4"), and putting any part of an
 * older version back into the program as it is now (the whole program, a
 * block, a week, a day or one exercise). Blocks, weeks, days and exercises are
 * matched by their keys, which every save keeps, so a renamed day or a moved
 * exercise is still the same thing. Restoring never removes later history: it
 * edits the builder's draft, and saving it is a new version.
 */

export type VersionSource = "create" | "save" | "import" | "restore" | "copy" | "cleo" | "baseline";

export type ProgramVersion = {
  id: string;
  version_no: number;
  title: string;
  description: string | null;
  plan: ProgramPlan | null;
  source: VersionSource;
  restored_from: number | null;
  label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Where a week sits, by key (indices move when weeks are added or removed). */
export type WeekKeyRef = { blockKey: string; weekKey: string };

export type RestoreTarget =
  | { kind: "program" }
  | { kind: "block"; blockKey: string }
  | { kind: "week"; blockKey: string; weekKey: string }
  | { kind: "day"; weeks: WeekKeyRef[]; dayKey: string }
  | { kind: "exercise"; weeks: WeekKeyRef[]; dayKey: string; exKey: string };

export type PlanChange = {
  id: string;
  /** "Week 3 · Lower A", "Weeks 1–12 · Upper B", "Block 2", "Program" */
  where: string;
  /** "Competition Squat 3 × 5 → 4 × 4" */
  text: string;
  /** What putting the older side of this change back means (null: can't be done alone). */
  restore: RestoreTarget | null;
  /** sorts: program, then blocks, then the first week it touches, then the day's place */
  order: number;
};

/** Names an exercise without its library name on the saved plan. */
export type NameOf = (exerciseId: string) => string | null | undefined;

const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function weekNumbers(plan: ProgramPlan): Map<string, number> {
  const out = new Map<string, number>();
  let g = 0;
  for (const b of plan.blocks) for (const w of b.weeks) out.set(`${b.key}:${w.key}`, ++g);
  return out;
}

/** "Week 3" · "Weeks 1–4" · "Weeks 2, 5 and 9" from program week numbers. */
export function weeksLabel(numbers: number[]): string {
  const g = [...new Set(numbers)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!g.length) return "";
  if (g.length === 1) return `Week ${g[0]}`;
  const runs: string[] = [];
  let lo = g[0];
  let prev = g[0];
  for (const n of [...g.slice(1), Infinity]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(lo === prev ? String(lo) : `${lo}–${prev}`);
    lo = prev = n;
  }
  return `Weeks ${runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`}`;
}

const restText = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
};

/** The parts of a prescription that can change, each said on its own. */
function facets(e: PlanExercise): Record<string, string> {
  return {
    volume: `${e.sets} × ${e.reps || "—"}`,
    effort: e.rpe ? `RPE ${e.rpe}` : e.rir ? `RIR ${e.rir}` : "no effort target",
    load: loadText(e) ?? "no load",
    rest: e.rest_seconds ? `${restText(e.rest_seconds)} rest` : "no rest set",
    tempo: e.tempo ? `tempo ${e.tempo}` : "no tempo",
    role:
      e.role === "top"
        ? "top set"
        : e.role === "backoff"
          ? "back-off"
          : e.role === "warmup"
            ? "warm-up"
            : e.label
              ? e.label
              : "working sets",
    round: e.round === "fine" ? "fine rounding" : "standard rounding",
  };
}

/** "3 × 5 · RPE 7 → 4 × 4 · RPE 8": only the parts that differ, before and after. */
export function prescriptionChange(a: PlanExercise, b: PlanExercise): string | null {
  const fa = facets(a);
  const fb = facets(b);
  const keys = Object.keys(fa).filter((k) => fa[k] !== fb[k]);
  const notes = (a.notes ?? "").trim() !== (b.notes ?? "").trim();
  if (!keys.length && !notes) return null;
  const parts: string[] = [];
  if (keys.length)
    parts.push(`${keys.map((k) => fa[k]).join(" · ")} → ${keys.map((k) => fb[k]).join(" · ")}`);
  if (notes)
    parts.push(
      !(b.notes ?? "").trim()
        ? "note removed"
        : !(a.notes ?? "").trim()
          ? "note added"
          : "note changed",
    );
  return parts.join("; ");
}

function exName(e: PlanExercise, nameOf: NameOf): string {
  return (e.name || nameOf(e.exercise_id) || e.source_name || "Exercise").trim();
}

function shortPrescription(e: PlanExercise): string {
  const parts = [`${e.sets} × ${e.reps || "—"}`];
  if (e.rpe) parts.push(`RPE ${e.rpe}`);
  else if (e.rir) parts.push(`RIR ${e.rir}`);
  if (e.pct != null) parts.push(`${fmtWeight(e.pct)}%`);
  else if (e.load != null) parts.push(`${fmtWeight(e.load)} ${e.unit ?? "lb"}`);
  return parts.join(" ");
}

type Agg = {
  id: string;
  dayTitle: string;
  text: string;
  weeks: WeekKeyRef[];
  numbers: number[];
  restore: (weeks: WeekKeyRef[]) => RestoreTarget;
  dayIndex: number;
};

/**
 * What changed from `before` to `after`, as a short list a person can read.
 * The same change in several weeks is said once with its weeks. `limit` keeps
 * the list short; what's left is counted in `more`.
 */
export function planChanges(
  before: { title: string; plan: ProgramPlan | null } | null,
  after: { title: string; plan: ProgramPlan | null },
  nameOf: NameOf = () => null,
): PlanChange[] {
  const out: PlanChange[] = [];
  if (!after.plan) return out;
  if (!before || !before.plan) return out;
  const a = before.plan;
  const b = after.plan;

  if (before.title.trim() !== after.title.trim()) {
    out.push({
      id: "title",
      where: "Program",
      text: `Renamed to "${after.title.trim()}"`,
      restore: null,
      order: 0,
    });
  }
  const ta = totalWeeks(a);
  const tb = totalWeeks(b);
  if (ta !== tb) {
    out.push({
      id: "length",
      where: "Program",
      text: `Length ${ta} → ${tb} weeks`,
      restore: null,
      order: 1,
    });
  }

  const aBlocks = new Map(a.blocks.map((x, i) => [x.key, { block: x, i }]));
  const bBlocks = new Map(b.blocks.map((x, i) => [x.key, { block: x, i }]));
  const numA = weekNumbers(a);
  const numB = weekNumbers(b);

  for (const [key, { block, i }] of bBlocks) {
    const old = aBlocks.get(key);
    if (!old) {
      out.push({
        id: `block+${key}`,
        where: `Block ${i + 1}`,
        text: `Added "${block.name}" (${block.weeks.length} ${block.weeks.length === 1 ? "week" : "weeks"})`,
        restore: { kind: "block", blockKey: key },
        order: 10 + i,
      });
      continue;
    }
    if (old.block.name.trim() !== block.name.trim()) {
      out.push({
        id: `block~${key}`,
        where: `Block ${i + 1}`,
        text: `Renamed "${old.block.name}" to "${block.name}"`,
        restore: null,
        order: 10 + i,
      });
    }
    if (old.block.weeks.length !== block.weeks.length && b.blocks.length > 1) {
      out.push({
        id: `blocklen${key}`,
        where: `Block ${i + 1}`,
        text: `"${block.name}" ${old.block.weeks.length} → ${block.weeks.length} weeks`,
        restore: { kind: "block", blockKey: key },
        order: 10 + i,
      });
    }
  }
  for (const [key, { block, i }] of aBlocks) {
    if (bBlocks.has(key)) continue;
    out.push({
      id: `block-${key}`,
      where: `Block ${i + 1}`,
      text: `Removed "${block.name}"`,
      restore: { kind: "block", blockKey: key },
      order: 10 + i,
    });
  }

  // day- and exercise-level changes, the same change across weeks said once
  const aggs = new Map<string, Agg>();
  const add = (
    k: string,
    base: Omit<Agg, "weeks" | "numbers" | "id">,
    ref: WeekKeyRef,
    n: number,
  ) => {
    const hit = aggs.get(k);
    if (hit) {
      hit.weeks.push(ref);
      hit.numbers.push(n);
      return;
    }
    aggs.set(k, { ...base, id: k, weeks: [ref], numbers: [n] });
  };

  for (const blockB of b.blocks) {
    const blockA = aBlocks.get(blockB.key)?.block;
    if (!blockA) continue;
    const aWeeks = new Map(blockA.weeks.map((w) => [w.key, w]));
    for (const weekB of blockB.weeks) {
      const weekA = aWeeks.get(weekB.key);
      if (!weekA) continue;
      const ref = { blockKey: blockB.key, weekKey: weekB.key };
      const n =
        numB.get(`${blockB.key}:${weekB.key}`) ?? numA.get(`${blockA.key}:${weekA.key}`) ?? 0;
      compareWeek(weekA, weekB, ref, n, nameOf, add);
    }
  }

  for (const g of aggs.values()) {
    const weeksText = weeksLabel(g.numbers);
    out.push({
      id: g.id,
      where: [weeksText, g.dayTitle].filter(Boolean).join(" · "),
      text: g.text,
      restore: g.restore(g.weeks),
      order: 100 + Math.min(...g.numbers) * 10 + g.dayIndex,
    });
  }
  return out.sort((x, y) => x.order - y.order);
}

function compareWeek(
  weekA: PlanWeek,
  weekB: PlanWeek,
  ref: WeekKeyRef,
  n: number,
  nameOf: NameOf,
  add: (k: string, base: Omit<Agg, "weeks" | "numbers" | "id">, ref: WeekKeyRef, n: number) => void,
) {
  const aDays = new Map(weekA.days.map((d, i) => [d.key, { d, i }]));
  const bDays = new Map(weekB.days.map((d, i) => [d.key, { d, i }]));
  for (const [key, { d, i }] of bDays) {
    const old = aDays.get(key);
    if (!old) {
      add(
        `day+${key}`,
        {
          dayTitle: d.title,
          text: `Added ${d.title} (${d.exercises.length} exercises)`,
          restore: (weeks) => ({ kind: "day", weeks, dayKey: key }),
          dayIndex: i,
        },
        ref,
        n,
      );
      continue;
    }
    if (old.d.title.trim() !== d.title.trim()) {
      add(
        `day~${key}:${d.title}`,
        {
          dayTitle: d.title,
          text: `Renamed ${old.d.title} to ${d.title}`,
          restore: (weeks) => ({ kind: "day", weeks, dayKey: key }),
          dayIndex: i,
        },
        ref,
        n,
      );
    }
    compareDay(old.d, d, i, ref, n, nameOf, add);
  }
  for (const [key, { d, i }] of aDays) {
    if (bDays.has(key)) continue;
    add(
      `day-${key}`,
      {
        dayTitle: d.title,
        text: `Removed ${d.title}`,
        restore: (weeks) => ({ kind: "day", weeks, dayKey: key }),
        dayIndex: i,
      },
      ref,
      n,
    );
  }
}

function compareDay(
  dayA: PlanDay,
  dayB: PlanDay,
  dayIndex: number,
  ref: WeekKeyRef,
  n: number,
  nameOf: NameOf,
  add: (k: string, base: Omit<Agg, "weeks" | "numbers" | "id">, ref: WeekKeyRef, n: number) => void,
) {
  const aEx = new Map(dayA.exercises.map((e) => [e.key, e]));
  const bEx = new Map(dayB.exercises.map((e) => [e.key, e]));
  const title = dayB.title;
  const exTarget =
    (exKey: string) =>
    (weeks: WeekKeyRef[]): RestoreTarget => ({ kind: "exercise", weeks, dayKey: dayB.key, exKey });
  for (const e of dayB.exercises) {
    const old = aEx.get(e.key);
    if (!old) {
      const text = `Added ${exName(e, nameOf)} (${shortPrescription(e)})`;
      add(
        `ex+${dayB.key}:${e.key}:${text}`,
        { dayTitle: title, text, restore: exTarget(e.key), dayIndex },
        ref,
        n,
      );
      continue;
    }
    if (old.exercise_id !== e.exercise_id) {
      const text = `${exName(old, nameOf)} swapped for ${exName(e, nameOf)}`;
      add(
        `exswap${dayB.key}:${e.key}:${text}`,
        { dayTitle: title, text, restore: exTarget(e.key), dayIndex },
        ref,
        n,
      );
    }
    const change = prescriptionChange(old, e);
    if (change) {
      const text = `${exName(e, nameOf)} ${change}`;
      add(
        `ex~${dayB.key}:${e.key}:${text}`,
        { dayTitle: title, text, restore: exTarget(e.key), dayIndex },
        ref,
        n,
      );
    }
  }
  for (const e of dayA.exercises) {
    if (bEx.has(e.key)) continue;
    const text = `Removed ${exName(e, nameOf)}`;
    add(
      `ex-${dayB.key}:${e.key}:${text}`,
      { dayTitle: title, text, restore: exTarget(e.key), dayIndex },
      ref,
      n,
    );
  }
  // the same exercises in another order
  const kept = dayB.exercises.filter((e) => aEx.has(e.key)).map((e) => e.key);
  const keptBefore = dayA.exercises.filter((e) => bEx.has(e.key)).map((e) => e.key);
  if (kept.join("|") !== keptBefore.join("|")) {
    add(
      `order${dayB.key}`,
      {
        dayTitle: title,
        text: "Exercise order changed",
        restore: (weeks) => ({ kind: "day", weeks, dayKey: dayB.key }),
        dayIndex,
      },
      ref,
      n,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Restoring part of an older version into the program as it is now   */
/* ------------------------------------------------------------------ */

function findBlock(plan: ProgramPlan, key: string): { block: PlanBlock; i: number } | null {
  const i = plan.blocks.findIndex((b) => b.key === key);
  return i >= 0 ? { block: plan.blocks[i], i } : null;
}

function findWeek(
  plan: ProgramPlan,
  ref: WeekKeyRef,
): { week: PlanWeek; b: number; w: number } | null {
  const hit = findBlock(plan, ref.blockKey);
  if (!hit) return null;
  const w = hit.block.weeks.findIndex((x) => x.key === ref.weekKey);
  return w >= 0 ? { week: hit.block.weeks[w], b: hit.i, w } : null;
}

function insertAt<T>(list: T[], i: number, item: T): T[] {
  const at = Math.max(0, Math.min(list.length, i));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

function withWeek(plan: ProgramPlan, b: number, w: number, week: PlanWeek): ProgramPlan {
  return {
    ...plan,
    blocks: plan.blocks.map((bl, bi) =>
      bi === b ? { ...bl, weeks: bl.weeks.map((x, wi) => (wi === w ? week : x)) } : bl,
    ),
  };
}

/** The day of `dayKey` in a week made what the older week had (added back, put back, or taken out). */
function restoreDayInWeek(cur: PlanWeek, old: PlanWeek, dayKey: string): PlanWeek {
  const oldIdx = old.days.findIndex((d) => d.key === dayKey);
  const curIdx = cur.days.findIndex((d) => d.key === dayKey);
  if (oldIdx >= 0 && curIdx >= 0)
    return { ...cur, days: cur.days.map((d, i) => (i === curIdx ? old.days[oldIdx] : d)) };
  if (oldIdx >= 0) return { ...cur, days: insertAt(cur.days, oldIdx, old.days[oldIdx]) };
  if (curIdx >= 0 && cur.days.length > 1)
    return { ...cur, days: cur.days.filter((_, i) => i !== curIdx) };
  return cur;
}

/** One exercise of a day made what the older day had. A set group comes back whole. */
function restoreExerciseInDay(cur: PlanDay, old: PlanDay, exKey: string): PlanDay {
  const oldEx = old.exercises.find((e) => e.key === exKey);
  const curEx = cur.exercises.find((e) => e.key === exKey);
  const group = oldEx?.group ?? curEx?.group ?? null;
  const keys = new Set(
    group
      ? [...old.exercises, ...cur.exercises].filter((e) => e.group === group).map((e) => e.key)
      : [exKey],
  );
  const oldEntries = old.exercises.filter((e) => keys.has(e.key));
  const firstCur = cur.exercises.findIndex((e) => keys.has(e.key));
  const firstOld = old.exercises.findIndex((e) => keys.has(e.key));
  const rest = cur.exercises.filter((e) => !keys.has(e.key));
  if (!oldEntries.length) return { ...cur, exercises: rest };
  const at = firstCur >= 0 ? firstCur : firstOld >= 0 ? firstOld : rest.length;
  const exercises = [
    ...rest.slice(0, Math.min(at, rest.length)),
    ...oldEntries,
    ...rest.slice(Math.min(at, rest.length)),
  ];
  return { ...cur, exercises: exercises.slice(0, 20) };
}

/**
 * The program as it is now with one part of `old` put back. Nothing outside
 * the target changes. Weeks the older version doesn't have (added since) are
 * left as they are; a block or day the older version didn't have is taken out.
 */
export function restoreFrom(
  current: ProgramPlan,
  old: ProgramPlan,
  target: RestoreTarget,
): ProgramPlan {
  if (target.kind === "program") return old;

  if (target.kind === "block") {
    const o = findBlock(old, target.blockKey);
    const c = findBlock(current, target.blockKey);
    if (o && c)
      return { ...current, blocks: current.blocks.map((b, i) => (i === c.i ? o.block : b)) };
    if (o) return { ...current, blocks: insertAt(current.blocks, o.i, o.block).slice(0, 8) };
    if (c && current.blocks.length > 1)
      return { ...current, blocks: current.blocks.filter((_, i) => i !== c.i) };
    return current;
  }

  if (target.kind === "week") {
    const o = findWeek(old, target);
    const c = findWeek(current, target);
    if (o && c) return withWeek(current, c.b, c.w, o.week);
    const cb = findBlock(current, target.blockKey);
    if (o && cb) {
      return {
        ...current,
        blocks: current.blocks.map((b, i) =>
          i === cb.i ? { ...b, weeks: insertAt(b.weeks, o.w, o.week) } : b,
        ),
      };
    }
    if (c && current.blocks[c.b].weeks.length > 1) {
      return {
        ...current,
        blocks: current.blocks.map((b, i) =>
          i === c.b ? { ...b, weeks: b.weeks.filter((_, wi) => wi !== c.w) } : b,
        ),
      };
    }
    return current;
  }

  let plan = current;
  for (const ref of target.weeks) {
    const o = findWeek(old, ref);
    const c = findWeek(plan, ref);
    if (!o || !c) continue;
    if (target.kind === "day") {
      plan = withWeek(plan, c.b, c.w, restoreDayInWeek(c.week, o.week, target.dayKey));
    } else {
      const oDay = o.week.days.find((d) => d.key === target.dayKey);
      const cDay = c.week.days.find((d) => d.key === target.dayKey);
      if (!oDay || !cDay) continue;
      const day = restoreExerciseInDay(cDay, oDay, target.exKey);
      plan = withWeek(plan, c.b, c.w, {
        ...c.week,
        days: c.week.days.map((d) => (d.key === cDay.key ? day : d)),
      });
    }
  }
  return plan;
}

/** Every week of a plan, by key (to restore a day across the whole program). */
export function allWeekRefs(plan: ProgramPlan): WeekKeyRef[] {
  return plan.blocks.flatMap((b) => b.weeks.map((w) => ({ blockKey: b.key, weekKey: w.key })));
}

/* ------------------------------------------------------------------ */
/*  Words for the list                                                 */
/* ------------------------------------------------------------------ */

export const SOURCE_WORD: Record<VersionSource, string> = {
  create: "Created",
  save: "Saved",
  import: "Imported",
  restore: "Restored",
  copy: "Copied",
  cleo: "Changed by Cleo",
  baseline: "Saved",
};

/** "Restored version 3", "Imported", "Saved": what made a version. */
export function versionHeadline(
  v: Pick<ProgramVersion, "source" | "restored_from" | "label">,
): string {
  if (v.source === "restore" && v.restored_from) return `Restored version ${v.restored_from}`;
  return SOURCE_WORD[v.source] ?? "Saved";
}

/** "Today 3:42 PM" · "Yesterday 9:10 AM" · "Nov 12, 9:10 AM" · "Nov 12, 2025" */
export function versionWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (d.getFullYear() === now.getFullYear())
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** What a restore target is, in words. */
export function restoreWords(target: RestoreTarget, plan: ProgramPlan): string {
  if (target.kind === "program") return "the whole program";
  if (target.kind === "block") {
    const b = findBlock(plan, target.blockKey);
    return b ? `"${b.block.name}"` : "that block";
  }
  if (target.kind === "week") {
    const n = weekNumbers(plan).get(`${target.blockKey}:${target.weekKey}`);
    return n ? `week ${n}` : "that week";
  }
  const nums = weekNumbers(plan);
  const weeks = weeksLabel(
    target.weeks.map((r) => nums.get(`${r.blockKey}:${r.weekKey}`) ?? NaN),
  ).toLowerCase();
  if (target.kind === "day") return weeks ? `that day in ${weeks}` : "that day";
  return weeks ? `that exercise in ${weeks}` : "that exercise";
}

export { cap as capitalize };
