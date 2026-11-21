/**
 * A week a program writes once for a range of weeks ("Weeks 1-4: …") is that
 * many weeks, each the same as written (the program says so; nothing is
 * worked out), and the review says it was repeated. Pure.
 */
import type { ImportedProgram, ImportedWeek } from "./types";

const clone = (w: ImportedWeek): ImportedWeek => ({
  ...w,
  repeat: null,
  days: w.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })),
});

export function expandWeekRanges(p: ImportedProgram): ImportedProgram {
  let changed = false;
  const issues = [...p.issues];
  const blocks = p.blocks.map((b) => ({
    ...b,
    weeks: b.weeks.flatMap((w) => {
      const n = Math.min(24, Math.max(1, Math.round(w.repeat ?? 1)));
      if (n <= 1) return w.repeat != null ? [{ ...w, repeat: null }] : [w];
      changed = true;
      const range = w.label ?? `${n} weeks`;
      const start = Number(/(\d{1,2})\s*(?:-|–|to|through|thru)/i.exec(range)?.[1] ?? NaN);
      issues.push({
        where: range,
        text: `Written once for ${n} weeks, so it came in as ${n} weeks the same. Change any of them in the builder.`,
      });
      return Array.from({ length: n }, (_, i) => ({
        ...clone(w),
        label: Number.isFinite(start) ? `Week ${start + i}` : `${range} (${i + 1} of ${n})`.slice(0, 40),
      }));
    }),
  }));
  return changed ? { ...p, blocks, issues } : p;
}
