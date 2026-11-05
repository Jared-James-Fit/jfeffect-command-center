import type { ProgramDay } from "@/lib/athlete-programs";

/** The builder's pure helpers (tested). */

export const REST_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "—", seconds: null },
  { label: "0:45", seconds: 45 },
  { label: "1:00", seconds: 60 },
  { label: "1:30", seconds: 90 },
  { label: "2:00", seconds: 120 },
  { label: "3:00", seconds: 180 },
  { label: "4:00", seconds: 240 },
  { label: "5:00", seconds: 300 },
];

export function newDay(index: number): ProgramDay {
  return { title: `Day ${index + 1}`, focus: null, exercises: [] };
}

/** The list with item i moved one step (-1 up, 1 down); unchanged at either end. */
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
