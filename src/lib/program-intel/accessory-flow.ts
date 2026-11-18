/**
 * Accessory flow (Nov 18 2026): how a session moves around the gym. The main
 * lifts keep the order performance needs, always; after them, accessories are
 * grouped by station (dumbbells together, then cables, then machines) so the
 * athlete finishes one station before the next and never walks back to one the
 * session already left. Pure and deterministic.
 *
 * The reorder is conservative, a safety net under the prompts' own rules:
 *   - only accessories after the last main lift move (a main lift, or anything
 *     placed between main lifts, never does);
 *   - an exercise moves ahead of another only when it doesn't train a muscle the
 *     other one works (no pushdowns before close-grip bench, no curls before
 *     rows), an isolation never ahead of a compound, nothing past a priority
 *     muscle's work, and nothing past or with something it can't read (a
 *     stretch, a carry, a name it doesn't know);
 *   - a superset moves as one;
 *   - a compound accessory may follow straight on from the main lift's station
 *     (an RDL after deadlifts, a hip thrust after squats); an isolation never
 *     jumps to it;
 *   - the new order is kept only when it has fewer station changes than the
 *     model's, so it never makes a session worse.
 */
import { classifyExercise, type MuscleKey } from "@/lib/exercise-classifier";
import { stationOf } from "./equipment";
import { supersetGroup } from "./session-time";
import type { EquipmentItem } from "./types";

/** The rule in one line, for tools that pick or place a single exercise (Cleo's library lookup). */
export const ACCESSORY_FLOW_HINT = "Session flow: the main lifts keep their order. Pick each accessory for quality first; only when two train the target equally well, pick the one at a station the workout already uses (same equipment, less setup), and never trade down (a floor version, a shorter range, a less stable exercise) to save a station or keep a superset together. Place it with the other work at that station, after the main lifts, never ahead of a compound that trains the same muscle.";

export type FlowExercise = { exercise_name: string; role?: string | null; superset?: string | null; exercise_id?: string | null };
export type FlowOptions = {
  /** what the coach or strategy prioritized ("Quads", "Upper back"): their work is never pushed back */
  priorities?: readonly string[];
  /** the athlete's equipment; a home gym's leg attachment is its own station */
  items?: readonly EquipmentItem[];
  home?: boolean;
};

/** Where an exercise is done, by area; null = anywhere (bodyweight, bands): it never counts as a move. */
export function flowStation(name: string, equipment: string | null | undefined, opts: Pick<FlowOptions, "items" | "home"> = {}): string | null {
  const s = stationOf({ name, equipment });
  if (s === "bodyweight" || s === "bands") return null;
  if (s === "leg attachment") return opts.home && !(opts.items ?? []).includes("machines") ? "leg attachment" : "machine";
  return s;
}

const MAIN_ROLE = /\b(primary|secondary|tertiary|quaternary|main|top ?set|back-?offs?|backoffs?|competition|comp)\b/i;
const COMP_NAME = /\bcompetition (squat|bench|deadlift)\b/i;

/** A main lift: the session's first exercise, or one labelled as main work (Primary / Secondary / top set / back-off). */
export function isMainLift(e: Pick<FlowExercise, "exercise_name" | "role">, index: number): boolean {
  if (index === 0) return true;
  const role = String(e.role ?? "").trim();
  if (role) return MAIN_ROLE.test(role) && !/\baccessor/i.test(role);
  return COMP_NAME.test(e.exercise_name);
}

const COMPOUND = new Set(["squat", "hinge", "lunge", "hip_thrust", "back_extension", "horizontal_press", "incline_press", "vertical_press", "dip", "horizontal_pull", "vertical_pull"]);
/** Never moved and never moved past: work the classifier can't read as a muscle's accessory. */
const BARRIER = new Set(["olympic", "plyometric", "conditioning", "mobility", "carry", "other"]);

const PRIORITY_WORDS: Array<[RegExp, MuscleKey[]]> = [
  [/quad/i, ["quads"]],
  [/glute/i, ["glutes"]],
  [/hamstring|\bhams\b/i, ["hamstrings"]],
  [/adductor/i, ["adductors"]],
  [/\bcal(f|ves)\b/i, ["calves"]],
  [/chest|\bpecs?\b/i, ["chest"]],
  [/\blats?\b/i, ["lats"]],
  [/upper back|mid[- ]back|rhomboid/i, ["upper_back"]],
  [/^back$|\bback (width|thickness|size)\b/i, ["lats", "upper_back"]],
  [/(side|lateral|medial) delt/i, ["side_delts"]],
  [/rear delt/i, ["rear_delts"]],
  [/front delt/i, ["front_delts"]],
  [/bicep/i, ["biceps"]],
  [/tricep/i, ["triceps"]],
  [/^arms?$/i, ["biceps", "triceps"]],
  [/\btraps?\b/i, ["traps"]],
  [/\bcore\b|\babs\b/i, ["core"]],
];

/** The muscles a list of priorities names (lifts like "Bench" name none: the main lifts don't move anyway). */
export function priorityMuscles(priorities: readonly string[] | undefined): Set<MuscleKey> {
  const out = new Set<MuscleKey>();
  for (const p of priorities ?? []) {
    const t = String(p).trim();
    let specificDelt = false;
    for (const [re, ms] of PRIORITY_WORDS) {
      if (!re.test(t)) continue;
      if (ms.some((m) => m.endsWith("_delts"))) specificDelt = true;
      ms.forEach((m) => out.add(m));
    }
    if (!specificDelt && /\bshoulders?\b|\bdelts?\b/i.test(t)) (["front_delts", "side_delts", "rear_delts"] as MuscleKey[]).forEach((m) => out.add(m));
  }
  return out;
}

type Unit<T> = {
  items: T[];
  stations: Set<string>;
  primary: Set<MuscleKey>;
  worked: Set<MuscleKey>;
  compound: boolean;
  barrier: boolean;
  priority: boolean;
};

function unitsOf<T extends FlowExercise>(exs: T[], equipmentOf: (e: T) => string | null | undefined, opts: FlowOptions): Unit<T>[] {
  const prio = priorityMuscles(opts.priorities);
  const out: Unit<T>[] = [];
  for (const e of exs) {
    const g = supersetGroup(e.superset);
    const last = out[out.length - 1];
    const u: Unit<T> = last && g && supersetGroup(last.items[0].superset) === g ? last : { items: [], stations: new Set(), primary: new Set(), worked: new Set(), compound: false, barrier: false, priority: false };
    if (u !== last) out.push(u);
    u.items.push(e);
    const st = flowStation(e.exercise_name, equipmentOf(e), opts);
    if (st) u.stations.add(st);
    const c = classifyExercise(e.exercise_name);
    if (!c.matched || BARRIER.has(c.pattern)) u.barrier = true;
    if (COMPOUND.has(c.pattern)) u.compound = true;
    for (const m of c.primary) {
      if (m === "other") continue;
      u.primary.add(m);
      u.worked.add(m);
      if (prio.has(m)) u.priority = true;
    }
    for (const m of c.secondary) if (m !== "other") u.worked.add(m);
  }
  return out;
}

/** May `x` be done before `y` (which the model put first)? */
function canJump<T>(x: Unit<T>, y: Unit<T>): boolean {
  if (x.barrier || y.barrier) return false;
  if (y.priority && !x.priority) return false;
  // compounds before isolation work: an isolation never jumps a compound, whatever it trains
  if (!x.compound && y.compound) return false;
  // x first would tire a muscle y works (pushdowns before close-grip bench, curls before rows, two quad exercises)
  for (const m of x.primary) if (y.worked.has(m)) return false;
  return true;
}

const meets = (a: Set<string>, b: Set<string>) => [...a].some((s) => b.has(s));

/** Station changes along a sequence of station sets, starting from `from` (anywhere-work never counts). */
function changesAlong(seq: Array<Set<string>>, from: Set<string>): number {
  let cur = from;
  let n = 0;
  for (const s of seq) {
    if (!s.size) continue;
    if (cur.size && !meets(s, cur)) n++;
    cur = s;
  }
  return n;
}

function split<T extends FlowExercise>(exs: T[]): { main: T[]; rest: T[] } {
  let last = 0;
  exs.forEach((e, i) => {
    if (isMainLift(e, i)) last = i;
  });
  return { main: exs.slice(0, last + 1), rest: exs.slice(last + 1) };
}

/** How many times a session moves station (a superset counts as one place). */
export function stationChanges<T extends FlowExercise>(exs: T[], equipmentOf: (e: T) => string | null | undefined, opts: FlowOptions = {}): number {
  const units = unitsOf(exs, equipmentOf, opts);
  return changesAlong(units.map((u) => u.stations), new Set());
}

/**
 * The accessories that go back to a station the session already left (the main
 * lifts' stations included): "Cable Fly" after cables → dumbbells → cables.
 */
export function stationReturns<T extends FlowExercise>(exs: T[], equipmentOf: (e: T) => string | null | undefined, opts: FlowOptions = {}): Array<{ name: string; station: string }> {
  const { main, rest } = split(exs);
  const seen = new Set<string>();
  let cur = new Set<string>();
  for (const u of unitsOf(main, equipmentOf, opts))
    if (u.stations.size) {
      u.stations.forEach((s) => seen.add(s));
      cur = u.stations;
    }
  const out: Array<{ name: string; station: string }> = [];
  for (const u of unitsOf(rest, equipmentOf, opts)) {
    if (!u.stations.size) continue;
    if (cur.size && !meets(u.stations, cur)) {
      const back = [...u.stations].find((s) => seen.has(s));
      if (back) out.push({ name: u.items.map((e) => e.exercise_name).join(" + "), station: back });
    }
    u.stations.forEach((s) => seen.add(s));
    cur = u.stations;
  }
  return out;
}

/** `moved`: what came forward, and whether it now follows straight on from the main lift's setup. */
export type FlowResult<T> = { exercises: T[]; moved: Array<{ name: string; toMain: boolean }>; before: number; after: number };

/**
 * One session's accessories grouped by station, within the rules above. Returns
 * the session unchanged (same array) when nothing can or should move.
 */
export function orderAccessories<T extends FlowExercise>(exs: T[], equipmentOf: (e: T) => string | null | undefined, opts: FlowOptions = {}): FlowResult<T> {
  const { main, rest } = split(exs);
  const mainUnits = unitsOf(main, equipmentOf, opts);
  const start = [...mainUnits].reverse().find((u) => u.stations.size)?.stations ?? new Set<string>();
  const units = unitsOf(rest, equipmentOf, opts);
  const before = changesAlong(units.map((u) => u.stations), start);
  const same: FlowResult<T> = { exercises: exs, moved: [], before, after: before };
  if (units.length < 2 || before === 0) return same;

  const left = [...units];
  const placed: Unit<T>[] = [];
  let cur = start;
  let fromMain = true;
  const moved: FlowResult<T>["moved"] = [];
  while (left.length) {
    let pick = 0;
    const head = left[0];
    if (cur.size && head.stations.size && !meets(head.stations, cur)) {
      for (let k = 1; k < left.length; k++) {
        const u = left[k];
        if (!u.stations.size || !meets(u.stations, cur)) continue;
        // only a compound on its own follows straight on from the main lift's setup (an RDL after deadlifts,
        // never an EZ-bar curl, nor a superset that only has a barbell in it because of its curl)
        if (fromMain && !(u.compound && u.items.length === 1)) continue;
        if (left.slice(0, k).every((y) => canJump(u, y))) {
          pick = k;
          break;
        }
      }
    }
    const [u] = left.splice(pick, 1);
    if (pick > 0) moved.push({ name: u.items.map((e) => e.exercise_name).join(" + "), toMain: fromMain });
    placed.push(u);
    if (u.stations.size) {
      cur = u.stations;
      fromMain = false;
    }
  }
  const after = changesAlong(placed.map((u) => u.stations), start);
  if (after >= before) return same;
  return { exercises: [...main, ...placed.flatMap((u) => u.items)], moved, before, after };
}

/** Superset letters in the order they now appear (A first), each pair keeping its own numbers. */
export function reletterSupersets<T extends { superset?: string | null }>(exs: T[]): T[] {
  const map = new Map<string, string>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let changed = false;
  const out = exs.map((e) => {
    const g = supersetGroup(e.superset);
    if (!g) return e;
    if (!map.has(g)) map.set(g, letters[map.size] ?? g);
    const next = `${map.get(g)}${String(e.superset).trim().slice(1)}`;
    if (next === e.superset) return e;
    changed = true;
    return { ...e, superset: next };
  });
  return changed ? out : exs;
}

/**
 * Every session of a built block grouped by station (orderAccessories). `notes`
 * say what moved, for the coach; the block comes back as it was when nothing did.
 */
export function withAccessoryFlow<B extends { days: Array<{ title: string; exercises: E[] }> }, E extends FlowExercise>(
  block: B,
  equipmentOf: (e: E) => string | null | undefined,
  opts: FlowOptions = {},
): { block: B; notes: string[]; saved: number } {
  const notes: string[] = [];
  let saved = 0;
  let any = false;
  const days = block.days.map((d) => {
    const r = orderAccessories(d.exercises, equipmentOf, opts);
    if (r.exercises === d.exercises) return d;
    any = true;
    saved += r.before - r.after;
    const what = r.moved.map((m) => `${m.name} moved up ${m.toMain ? "to follow the main lift at the same setup" : "to the other work at its station"}`).join("; ");
    notes.push(`${d.title}: ${what} (${r.before} → ${r.after} station change${r.after === 1 ? "" : "s"} after the main lifts).`);
    return { ...d, exercises: reletterSupersets(r.exercises) };
  });
  return { block: any ? { ...block, days } : block, notes, saved };
}
