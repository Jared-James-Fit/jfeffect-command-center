/**
 * Training blocks side by side (pure, tested in analytics-redesign.test.ts):
 * each block's type (block-types.ts: the coach's pick, else read from its
 * name), its strength change, how much and how hard it trained, and how
 * closely it was followed. Compared like with like by default: the blocks of
 * the same kind as the latest one. A taper, peak or deload trains less on
 * purpose, so its lower workload is labelled planned, never regression.
 */
import {
  BUILT_IN_BLOCK_TYPES,
  findBlockType,
  inferBlockType,
  type BlockColor,
} from "@/lib/block-types";
import { COMP_LIFTS, type CompLift } from "@/lib/analytics/competition-strength";
import { envelopeAt } from "@/lib/analytics/strength-estimate";
import type { LiftStrength } from "@/lib/analytics/lift-strength";
import type { LoadSet, WeekLoad } from "@/lib/analytics/training-load";
import { liftOf } from "@/lib/analytics/training-load";

export type BlockMetric = "strength" | "volume" | "intensity" | "adherence";
export const BLOCK_METRICS: Array<{ key: BlockMetric; label: string }> = [
  { key: "strength", label: "Strength" },
  { key: "volume", label: "Sets" },
  { key: "intensity", label: "Effort" },
  { key: "adherence", label: "Done" },
];

export type BlockRow = {
  id: string;
  name: string;
  start: string;
  end: string;
  typeKey: string | null;
  typeName: string;
  color: BlockColor;
  /** deload / taper / peaking: less work on purpose */
  light: boolean;
  /** estimated strength across the block, % per lift (null: nothing to read) */
  strengthPct: Record<CompLift, number | null>;
  /** working sets a week over its finished weeks */
  setsPerWeek: number | null;
  /** average RPE of its rated competition-lift sets */
  avgRpe: number | null;
  /** planned workouts done, % */
  adherence: number | null;
  current: boolean;
};

const LIGHT = new Set(["deload", "taper", "peaking"]);
const DAY = 86_400_000;

export function cleanBlockName(name: string | null | undefined): string {
  return (name ?? "").replace(/^\s*block\s*\d+\s*[—–\-:·]\s*/i, "").trim() || (name ?? "Block");
}

export function blockRows(input: {
  blocks: Array<{
    id: string;
    name: string | null;
    start_date: string | null;
    end_date: string | null;
    training_focus?: string | null;
    block_type?: string | null;
  }>;
  strength: Record<CompLift, LiftStrength>;
  weeks: WeekLoad[];
  sets: LoadSet[];
  today: string;
}): BlockRow[] {
  const dated = input.blocks
    .filter((b) => b.start_date)
    .map((b) => ({ ...b, start: b.start_date!.slice(0, 10), end: (b.end_date ?? "").slice(0, 10) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const rows: BlockRow[] = [];
  for (let i = 0; i < dated.length; i++) {
    const b = dated[i];
    const next = dated[i + 1]?.start;
    const end =
      b.end ||
      (next
        ? new Date(Date.parse(`${next}T12:00:00Z`) - DAY).toISOString().slice(0, 10)
        : input.today);
    if (b.start > input.today) continue;
    const type =
      findBlockType(b.block_type ?? null) ??
      findBlockType(inferBlockType({ name: b.name, training_focus: b.training_focus ?? null }));
    const strengthPct = {} as BlockRow["strengthPct"];
    for (const l of COMP_LIFTS) {
      const env = input.strength[l].envelope;
      const inside = env.filter(
        (p) => p.day >= b.start && p.day <= end && (p.state === "measured" || p.state === "raised"),
      );
      const from = envelopeAt(env, b.start) ?? inside[0];
      const to = inside[inside.length - 1];
      strengthPct[l] =
        from && to && to !== from && from.value > 0
          ? Math.round(((to.value - from.value) / from.value) * 1000) / 10
          : null;
    }
    const wk = input.weeks.filter(
      (w) => !w.current && !w.future && w.key >= b.start && w.key <= end,
    );
    const setsPerWeek = wk.length
      ? Math.round((wk.reduce((a, w) => a + w.sets, 0) / wk.length) * 10) / 10
      : null;
    const planned = wk.reduce((a, w) => a + (w.plannedSessions ?? 0), 0);
    const done = wk.reduce((a, w) => a + (w.plannedSessionsDone ?? 0), 0);
    const rated = input.sets
      .filter(
        (s) => s.day >= b.start && s.day <= end && liftOf(s) && (s.rpe != null || s.rir != null),
      )
      .map((s) => (s.rpe != null ? Math.min(10, s.rpe) : 10 - (s.rir ?? 0)));
    rows.push({
      id: b.id,
      name: cleanBlockName(b.name),
      start: b.start,
      end,
      typeKey: type?.key ?? null,
      typeName: type?.name ?? "Block",
      color: type?.color ?? "stone",
      light: !!type && LIGHT.has(type.builtIn ? type.key : (type.basedOn ?? "")),
      strengthPct,
      setsPerWeek,
      avgRpe: rated.length
        ? Math.round((rated.reduce((a, x) => a + x, 0) / rated.length) * 10) / 10
        : null,
      adherence: planned > 0 ? Math.round((done / planned) * 100) : null,
      current: input.today >= b.start && input.today <= end,
    });
  }
  return rows.filter(
    (r) => r.setsPerWeek != null || COMP_LIFTS.some((l) => r.strengthPct[l] != null),
  );
}

/** The type the comparison opens on: the latest block's, when 2+ blocks share it. */
export function defaultBlockType(rows: BlockRow[]): string | null {
  const last = [...rows].reverse().find((r) => r.typeKey);
  if (!last) return null;
  return rows.filter((r) => r.typeKey === last.typeKey).length >= 2 ? last.typeKey : null;
}

export const BLOCK_TYPE_NAMES = new Map(BUILT_IN_BLOCK_TYPES.map((t) => [t.key, t.name]));
