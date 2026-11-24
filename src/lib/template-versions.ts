import { normalizeTemplatePayload, type TemplatePayloadV2 } from "@/lib/pl-template-blocks";
import { weeksLabel } from "@/lib/program-versions";

/**
 * Version history for the coach's program templates (Nov 24 2026), the pure
 * half: what changed between two saved payloads, in a coach's words, and
 * putting a block or a week of an older one back. Blocks are matched by id,
 * weeks by their number, days by their number, and exercises by place and
 * exercise (rows have no keys of their own), so a change reads as "Week 3 ·
 * Day 1 — Back Squat 3 × 5 → 4 × 4", and an exercise added or removed as such.
 */

export type TemplateChange = { id: string; where: string; text: string; order: number };

export type TemplateRestoreTarget =
  | { kind: "program" }
  | { kind: "block"; blockId: string }
  | { kind: "week"; blockId: string; weekIndex: number };

type Row = Record<string, any>;
type NameOf = (exerciseId: string) => string | null | undefined;

const rowName = (r: Row, nameOf: NameOf) =>
  (r?.exercise_id ? nameOf(r.exercise_id) : null) || r?.exercise_name_override || "Exercise";

function rx(r: Row): string {
  const reps = r?.measurement_type === "time" && r?.duration_seconds ? `${Math.round(Number(r.duration_seconds) / 60)} min` : String(r?.reps_text ?? "").trim() || "—";
  const parts = [`${r?.sets ?? "—"} × ${reps}`];
  if (r?.rpe != null && String(r.rpe).trim() !== "") parts.push(`RPE ${r.rpe}`);
  else if (r?.rir != null && String(r.rir).trim() !== "") parts.push(`RIR ${r.rir}`);
  if (r?.percentage != null && String(r.percentage).trim() !== "") parts.push(`${r.percentage}%`);
  else if (r?.load_lb != null && r.load_lb !== "") parts.push(`${r.load_lb} lb`);
  else if (r?.load_kg != null && r.load_kg !== "") parts.push(`${r.load_kg} kg`);
  return parts.join(" ");
}

const restOf = (r: Row) => r?.rest_seconds ?? null;

function activeBlocks(v2: TemplatePayloadV2) {
  return v2.blocks.filter((b) => !b.archived && !b.deleted_at).sort((a, b) => a.order_index - b.order_index);
}

const weekNo = (w: any, i: number) => Number(w?.week_index ?? i + 1);
const dayNo = (d: any, i: number) => Number(d?.day_index ?? i + 1);

/** A payload as v2 (any template type), or null when it can't be read. */
export function readPayload(raw: unknown): TemplatePayloadV2 | null {
  try {
    return normalizeTemplatePayload(raw);
  } catch {
    return null;
  }
}

/** What changed from `before` to `after`, the same change across weeks said once. */
export function templateChanges(beforeRaw: unknown, afterRaw: unknown, nameOf: NameOf = () => null): TemplateChange[] {
  const a = readPayload(beforeRaw);
  const b = readPayload(afterRaw);
  if (!a || !b) return [];
  const out: TemplateChange[] = [];
  const aBlocks = new Map(activeBlocks(a).map((x) => [x.id, x]));
  const bList = activeBlocks(b);
  const multi = bList.length > 1;
  const agg = new Map<string, { where: (weeks: string) => string; text: string; weeks: number[]; order: number }>();
  const add = (key: string, text: string, week: number, where: (weeks: string) => string, order: number) => {
    const hit = agg.get(key);
    if (hit) hit.weeks.push(week);
    else agg.set(key, { where, text, weeks: [week], order });
  };

  bList.forEach((blk, bi) => {
    const old = aBlocks.get(blk.id);
    const blockWord = multi ? `${blk.name} · ` : "";
    if (!old) {
      out.push({ id: `block+${blk.id}`, where: `Block ${bi + 1}`, text: `Added "${blk.name}" (${blk.weeks.length} weeks)`, order: 10 + bi });
      return;
    }
    if (old.name !== blk.name) out.push({ id: `block~${blk.id}`, where: `Block ${bi + 1}`, text: `Renamed "${old.name}" to "${blk.name}"`, order: 10 + bi });
    if (old.weeks.length !== blk.weeks.length)
      out.push({ id: `blocklen${blk.id}`, where: multi ? `Block ${bi + 1}` : "Program", text: `${multi ? `"${blk.name}" ` : "Length "}${old.weeks.length} → ${blk.weeks.length} weeks`, order: 10 + bi });
    if ((old.block_type ?? null) !== (blk.block_type ?? null))
      out.push({ id: `blocktype${blk.id}`, where: `Block ${bi + 1}`, text: "Block type changed", order: 10 + bi });
    const oldWeeks = new Map((old.weeks ?? []).map((w: any, i: number) => [weekNo(w, i), w]));
    (blk.weeks ?? []).forEach((w: any, wi: number) => {
      const n = weekNo(w, wi);
      const ow = oldWeeks.get(n);
      if (!ow) return;
      const oldDays = new Map<number, any>((ow.days ?? []).map((d: any, i: number) => [dayNo(d, i), d]));
      (w.days ?? []).forEach((d: any, di: number) => {
        const dn = dayNo(d, di);
        const title = d?.title || d?.subtitle ? `Day ${dn} ${String(d.subtitle || d.title).replace(/^Day\s*\d+\s*[—-]?\s*/i, "")}`.trim() : `Day ${dn}`;
        const where = (weeks: string) => `${blockWord}${weeks} · ${title}`;
        const od = oldDays.get(dn);
        if (!od) {
          add(`day+${blk.id}:${dn}`, `Added ${title}`, n, where, 100 + bi * 1000 + dn);
          return;
        }
        const oldRows: Row[] = od.rows ?? [];
        const rows: Row[] = d.rows ?? [];
        const max = Math.max(oldRows.length, rows.length);
        for (let i = 0; i < max; i++) {
          const or = oldRows[i];
          const nr = rows[i];
          if (or && nr && or.exercise_id === nr.exercise_id && (or.exercise_name_override ?? null) === (nr.exercise_name_override ?? null)) {
            const before = rx(or);
            const after = rx(nr);
            if (before !== after) add(`row~${blk.id}:${dn}:${i}:${before}>${after}`, `${rowName(nr, nameOf)} ${before} → ${after}`, n, where, 100 + bi * 1000 + dn);
            else if (restOf(or) !== restOf(nr)) add(`rest~${blk.id}:${dn}:${i}`, `${rowName(nr, nameOf)} rest changed`, n, where, 100 + bi * 1000 + dn);
            else if ((or.notes ?? "") !== (nr.notes ?? "")) add(`note~${blk.id}:${dn}:${i}`, `${rowName(nr, nameOf)} note changed`, n, where, 100 + bi * 1000 + dn);
          } else if (or && nr) {
            add(`swap${blk.id}:${dn}:${i}:${or.exercise_id}>${nr.exercise_id}`, `${rowName(or, nameOf)} → ${rowName(nr, nameOf)}`, n, where, 100 + bi * 1000 + dn);
          } else if (nr) {
            add(`row+${blk.id}:${dn}:${nr.exercise_id}`, `Added ${rowName(nr, nameOf)} (${rx(nr)})`, n, where, 100 + bi * 1000 + dn);
          } else if (or) {
            add(`row-${blk.id}:${dn}:${or.exercise_id}`, `Removed ${rowName(or, nameOf)}`, n, where, 100 + bi * 1000 + dn);
          }
        }
      });
      for (const [dn, od] of oldDays) {
        if ((w.days ?? []).some((d: any, i: number) => dayNo(d, i) === dn)) continue;
        add(`day-${blk.id}:${dn}`, `Removed day ${dn}`, n, (weeks) => `${blockWord}${weeks}`, 100 + bi * 1000 + dn);
        void od;
      }
    });
  });
  for (const [id, old] of aBlocks) {
    if (bList.some((x) => x.id === id)) continue;
    out.push({ id: `block-${id}`, where: "Program", text: `Removed "${old.name}"`, order: 5 });
  }
  for (const [id, g] of agg) out.push({ id, where: g.where(weeksLabel(g.weeks)), text: g.text, order: g.order + Math.min(...g.weeks) * 10 });
  return out.sort((x, y) => x.order - y.order);
}

/** The current payload with a block or a week of `old` put back (blocks by id, weeks by number). */
export function restoreTemplatePart(currentRaw: unknown, oldRaw: unknown, target: TemplateRestoreTarget): TemplatePayloadV2 | null {
  const cur = readPayload(currentRaw);
  const old = readPayload(oldRaw);
  if (!cur || !old) return null;
  if (target.kind === "program") return old;
  const ob = old.blocks.find((b) => b.id === target.blockId);
  const ci = cur.blocks.findIndex((b) => b.id === target.blockId);
  if (target.kind === "block") {
    if (!ob) return ci >= 0 ? { ...cur, blocks: cur.blocks.filter((_, i) => i !== ci) } : cur;
    if (ci < 0) return { ...cur, blocks: [...cur.blocks, ob] };
    return { ...cur, blocks: cur.blocks.map((b, i) => (i === ci ? ob : b)) };
  }
  if (!ob || ci < 0) return cur;
  const ow = (ob.weeks ?? []).find((w: any, i: number) => weekNo(w, i) === target.weekIndex);
  const cb = cur.blocks[ci];
  const wi = (cb.weeks ?? []).findIndex((w: any, i: number) => weekNo(w, i) === target.weekIndex);
  if (!ow) return cur;
  const weeks = wi >= 0 ? cb.weeks.map((w: any, i: number) => (i === wi ? ow : w)) : [...cb.weeks, ow];
  return { ...cur, blocks: cur.blocks.map((b, i) => (i === ci ? { ...cb, weeks } : b)) };
}
