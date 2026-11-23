/**
 * The program editor's "go there" (client side): a Program Check finding, a
 * completeness gap or the Program view asks the editor to open a block, week,
 * workout and exercise; the editor that shows it listens. A target asked for
 * before the right block's editor is on screen waits until it is (switching
 * blocks remounts the week editor). `here` is what the coach is looking at
 * now, so Cleo knows which workout "this day" means.
 */
export type BuilderView = "day" | "week" | "block" | "program" | "sheet";
export type BuilderTarget = { blockIndex: number; week: number; day?: number; row?: number; view?: BuilderView };
/** `week` and `day` are the numbers the coach sees (week_index, day_index). */
export type BuilderHere = { blockIndex: number; blockName: string | null; week: number | null; day: number | null; dayName: string | null; view: BuilderView };

type Sub = (t: BuilderTarget) => void;
const subs = new Set<Sub>();
let pending: BuilderTarget | null = null;
let here: BuilderHere | null = null;

export const builderNav = {
  go(t: BuilderTarget) {
    pending = t;
    subs.forEach((fn) => fn(t));
  },
  on(fn: Sub): () => void {
    subs.add(fn);
    return () => void subs.delete(fn);
  },
  /** The target waiting for a block's editor, taken once. */
  take(blockIndex: number): BuilderTarget | null {
    if (!pending || pending.blockIndex !== blockIndex) return null;
    const t = pending;
    pending = null;
    return t;
  },
  setHere(h: BuilderHere | null) {
    here = h;
  },
  here(): BuilderHere | null {
    return here;
  },
};

/** "Week 3 · Day 2 “Lower A” of “Strength”": what Cleo is told the coach is editing. */
export function hereWords(h: BuilderHere | null): string | null {
  if (!h || h.week == null) return null;
  const parts = [`Week ${h.week}`];
  if (h.day != null && (h.view === "day" || h.view === "week")) parts.push(`Day ${h.day}${h.dayName ? ` “${h.dayName}”` : ""}`);
  return `${parts.join(" · ")}${h.blockName ? ` of “${h.blockName}”` : ""}`;
}

/** Light the exercise a finding points at, for a moment. */
export function flashBuilderRow(row: number | undefined) {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const day = document.querySelector<HTMLElement>("[data-builder-focus-day]");
    if (!day) return;
    const el = row != null ? day.querySelectorAll<HTMLElement>("[data-pb-row]")[row] : null;
    (el ?? day).scrollIntoView({ behavior: "smooth", block: "center" });
    if (el) {
      el.setAttribute("data-pb-flash", "check");
      window.setTimeout(() => el.removeAttribute("data-pb-flash"), 1800);
    }
  });
}
