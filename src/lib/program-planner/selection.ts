/**
 * Tri-state selection over a normalized v2 template payload.
 *
 * Selection is stored as the canonical set of `exerciseKey` strings.
 * Block/week/day on/partial/off state is derived from that set so we never
 * have to keep multiple sources in sync.
 */
import type { PlannerSelection, PlannerSummary } from "./types";
import type { TemplatePayloadV2 } from "@/lib/pl-template-blocks";

export type TriState = "on" | "off" | "partial";

export interface TemplateNodeRef {
  blockKey: string;
  weekIndex?: number;
  dayIndex?: number;
  exerciseIndex?: number;
}

export function weekKey(blockKey: string, weekIndex: number): string {
  return `${blockKey}::w${weekIndex}`;
}
export function dayKey(blockKey: string, weekIndex: number, dayIndex: number): string {
  return `${weekKey(blockKey, weekIndex)}::d${dayIndex}`;
}
export function exerciseKey(
  blockKey: string,
  weekIndex: number,
  dayIndex: number,
  exerciseIndex: number,
): string {
  return `${dayKey(blockKey, weekIndex, dayIndex)}::e${exerciseIndex}`;
}

function dayExercises(day: any): any[] {
  if (!day || typeof day !== "object") return [];
  if (Array.isArray(day.exercises)) return day.exercises;
  if (Array.isArray(day.rows)) return day.rows;
  if (Array.isArray(day.exercise_rows)) return day.exercise_rows;
  return [];
}
function weekDays(week: any): any[] {
  if (!week || typeof week !== "object") return [];
  if (Array.isArray(week.days)) return week.days;
  if (Array.isArray(week.workout_days)) return week.workout_days;
  return [];
}

/** Iterate every exercise in the payload (active blocks only). */
export function* iterateExercises(payload: TemplatePayloadV2): Generator<{
  blockKey: string; weekIndex: number; dayIndex: number; exerciseIndex: number;
  exerciseKey: string;
  day: any; exercise: any;
}> {
  for (const block of payload.blocks ?? []) {
    if (!block || block.archived || block.deleted_at) continue;
    const weeks = Array.isArray(block.weeks) ? block.weeks : [];
    for (let w = 0; w < weeks.length; w++) {
      const days = weekDays(weeks[w]);
      for (let d = 0; d < days.length; d++) {
        const exs = dayExercises(days[d]);
        for (let e = 0; e < exs.length; e++) {
          yield {
            blockKey: block.id, weekIndex: w, dayIndex: d, exerciseIndex: e,
            exerciseKey: exerciseKey(block.id, w, d, e),
            day: days[d], exercise: exs[e],
          };
        }
      }
    }
  }
}

export function selectAll(payload: TemplatePayloadV2): PlannerSelection {
  const keys: string[] = [];
  for (const { exerciseKey: k } of iterateExercises(payload)) keys.push(k);
  return { exerciseKeys: keys };
}

export function clearAll(): PlannerSelection {
  return { exerciseKeys: [] };
}

function dayKeysForDay(payload: TemplatePayloadV2, blockKey: string, weekIndex: number, dayIndex: number): string[] {
  const out: string[] = [];
  for (const { blockKey: b, weekIndex: w, dayIndex: d, exerciseKey: k } of iterateExercises(payload)) {
    if (b === blockKey && w === weekIndex && d === dayIndex) out.push(k);
  }
  return out;
}
function exerciseKeysFor(payload: TemplatePayloadV2, ref: TemplateNodeRef): string[] {
  const out: string[] = [];
  for (const { blockKey, weekIndex, dayIndex, exerciseIndex, exerciseKey: k } of iterateExercises(payload)) {
    if (blockKey !== ref.blockKey) continue;
    if (ref.weekIndex != null && weekIndex !== ref.weekIndex) continue;
    if (ref.dayIndex != null && dayIndex !== ref.dayIndex) continue;
    if (ref.exerciseIndex != null && exerciseIndex !== ref.exerciseIndex) continue;
    out.push(k);
  }
  return out;
}

export function setNode(
  payload: TemplatePayloadV2,
  selection: PlannerSelection,
  ref: TemplateNodeRef,
  on: boolean,
): PlannerSelection {
  const targets = new Set(exerciseKeysFor(payload, ref));
  const next = new Set(selection.exerciseKeys);
  if (on) targets.forEach((k) => next.add(k));
  else    targets.forEach((k) => next.delete(k));
  return { exerciseKeys: Array.from(next) };
}

export function getNodeState(
  payload: TemplatePayloadV2,
  selection: PlannerSelection,
  ref: TemplateNodeRef,
): TriState {
  const keys = exerciseKeysFor(payload, ref);
  if (keys.length === 0) return "off";
  const set = new Set(selection.exerciseKeys);
  let hits = 0;
  for (const k of keys) if (set.has(k)) hits++;
  if (hits === 0) return "off";
  if (hits === keys.length) return "on";
  return "partial";
}

export function summarize(payload: TemplatePayloadV2, selection: PlannerSelection): PlannerSummary {
  const set = new Set(selection.exerciseKeys);
  const blocks = new Set<string>();
  const weeks = new Set<string>();
  const days = new Set<string>();
  let exercises = 0;
  for (const it of iterateExercises(payload)) {
    if (!set.has(it.exerciseKey)) continue;
    blocks.add(it.blockKey);
    weeks.add(weekKey(it.blockKey, it.weekIndex));
    days.add(dayKey(it.blockKey, it.weekIndex, it.dayIndex));
    exercises++;
  }
  return { blocks: blocks.size, weeks: weeks.size, days: days.size, exercises };
}

export interface MaterializedDay {
  blockKey: string;
  weekIndex: number;
  dayIndex: number;
  dayKey: string;
  title: string;
  /** Original day object with `exercises` filtered to selected indices. */
  day: any;
  exerciseKeys: string[];
}

/** Project the selection into the actual sequence of days to assign, in
 *  template order. Exercises that weren't selected are removed from the
 *  cloned day object so the commit RPC sees only what the coach chose. */
export function materializeSelectedDays(
  payload: TemplatePayloadV2,
  selection: PlannerSelection,
): MaterializedDay[] {
  const set = new Set(selection.exerciseKeys);
  const byDay = new Map<string, MaterializedDay>();
  const order: string[] = [];
  for (const it of iterateExercises(payload)) {
    if (!set.has(it.exerciseKey)) continue;
    const k = dayKey(it.blockKey, it.weekIndex, it.dayIndex);
    let md = byDay.get(k);
    if (!md) {
      const dayClone = JSON.parse(JSON.stringify(it.day));
      // Strip arrays of exercises — we'll rebuild from selected indices.
      delete dayClone.exercises;
      delete dayClone.rows;
      delete dayClone.exercise_rows;
      md = {
        blockKey: it.blockKey,
        weekIndex: it.weekIndex,
        dayIndex: it.dayIndex,
        dayKey: k,
        title: dayClone.title || dayClone.name || `Day ${it.dayIndex + 1}`,
        day: { ...dayClone, exercises: [] },
        exerciseKeys: [],
      };
      byDay.set(k, md);
      order.push(k);
    }
    md.day.exercises.push(JSON.parse(JSON.stringify(it.exercise)));
    md.exerciseKeys.push(it.exerciseKey);
  }
  return order.map((k) => byDay.get(k)!).filter(Boolean);
}