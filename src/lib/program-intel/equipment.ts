/**
 * Equipment: what an exercise needs, what a client actually has, and whether
 * a program fits it. Deterministic.
 *
 * What a client has is resolved in this order:
 *   1. the profile the coach confirmed in Program Intelligence (authoritative);
 *   2. what their most recent program proved they have (every exercise they
 *      actually trained), when that program was built for where they train
 *      now (a home program, station notes) or Goals & Setup agrees;
 *   3. Goals & Setup's equipment checklist and location (stated);
 *   4. nothing on file (unknown: nothing is ruled out, and it's flagged).
 * Conflicts between those sources are named, never silently resolved.
 */
import type { EquipmentItem, EquipmentProfile, IntelRecords, RawExercise } from "./types";

export const EQUIPMENT_LABEL: Record<EquipmentItem, string> = {
  barbell: "Barbell",
  rack: "Squat rack",
  bench: "Flat bench",
  adjustable_bench: "Adjustable bench",
  dumbbells: "Dumbbells",
  adjustable_dumbbells: "Adjustable dumbbells",
  cable_high: "Cable (high position)",
  cable_low: "Cable (low position)",
  landmine: "Landmine",
  machines: "Gym machines",
  leg_press: "Leg press",
  hack_squat: "Hack squat",
  smith: "Smith machine",
  leg_extension: "Leg extension",
  leg_curl: "Leg curl",
  lat_pulldown: "Lat pulldown machine",
  seated_row: "Seated row machine",
  hip_thrust_machine: "Hip thrust / glute machine",
  pullup_bar: "Pull-up bar",
  dip_station: "Dip station",
  bands: "Resistance bands",
  kettlebells: "Kettlebells",
  trap_bar: "Trap bar",
  belt_squat: "Belt squat",
  sled: "Sled",
  cardio: "Cardio equipment",
};
export const EQUIPMENT_ITEMS = Object.keys(EQUIPMENT_LABEL) as EquipmentItem[];

/** Goals & Setup's checklist wording → items (wording that isn't equipment is left out). */
const GOALS_MAP: Array<[RegExp, EquipmentItem[]]> = [
  [/^barbell$/i, ["barbell"]],
  [/squat rack|power rack/i, ["rack"]],
  [/^bench$/i, ["bench"]],
  [/adjustable dumbbell/i, ["dumbbells", "adjustable_dumbbells"]],
  [/^dumbbells?$/i, ["dumbbells"]],
  [/^machines?$/i, ["machines"]],
  [/cable/i, ["cable_high", "cable_low"]],
  [/smith/i, ["smith"]],
  [/leg press/i, ["leg_press"]],
  [/hack squat/i, ["hack_squat"]],
  [/leg extension/i, ["leg_extension"]],
  [/leg curl/i, ["leg_curl"]],
  [/lat pulldown/i, ["lat_pulldown"]],
  [/seated row/i, ["seated_row"]],
  [/hip thrust|glute machine/i, ["hip_thrust_machine"]],
  [/band/i, ["bands"]],
  [/pull-?up/i, ["pullup_bar"]],
  [/cardio/i, ["cardio"]],
  [/kettlebell/i, ["kettlebells"]],
  [/trap bar|hex bar/i, ["trap_bar"]],
  [/landmine/i, ["landmine"]],
];

export function itemsFromGoals(list: string[] | null | undefined): { items: EquipmentItem[]; unsure: boolean } {
  const out = new Set<EquipmentItem>();
  let unsure = false;
  for (const raw of list ?? []) {
    const t = String(raw).trim();
    if (/not sure/i.test(t)) unsure = true;
    for (const [re, items] of GOALS_MAP) if (re.test(t)) items.forEach((i) => out.add(i));
  }
  return { items: [...out], unsure };
}

/**
 * What an exercise needs: every group must be met, any item in a group meets
 * it. [] = nothing (bodyweight). Names decide first, the library's coarse
 * equipment tag second.
 */
export function requirementsOf(ex: { name: string; equipment?: string | null }): EquipmentItem[][] {
  const n = ex.name.toLowerCase();
  const tag = String(ex.equipment ?? "").toLowerCase();
  const req: EquipmentItem[][] = [];
  const add = (...g: EquipmentItem[]) => req.push(g);
  const db = /dumbbell|\bdb\b/.test(n) || /dumbbell/.test(tag);
  const bb = /barbell|\bbb\b|competition (squat|bench|deadlift)|back squat|front squat|\bdeadlift\b|romanian|\brdl\b|good morning|bench press|overhead press|military press|\bohp\b|pendlay|bent[- ]over (barbell )?row/.test(n) && !db;
  if (/landmine/.test(n)) {
    add("landmine");
    add("barbell");
    return req;
  }
  if (/smith/.test(n)) return [["smith"]];
  if (/leg press/.test(n)) return [["leg_press"]];
  if (/hack squat/.test(n)) return [["hack_squat"]];
  if (/belt squat/.test(n)) return [["belt_squat"]];
  if (/trap bar|hex bar/.test(n)) return [["trap_bar"]];
  if (/\bsled\b|prowler/.test(n)) return [["sled"]];
  if (/leg extension/.test(n)) return [["leg_extension"]];
  if (/leg curl|hamstring curl/.test(n) && !/nordic|slider|swiss|stability ball/.test(n)) return [["leg_curl"]];
  if (/hip thrust machine|glute (drive|machine)/.test(n)) return [["hip_thrust_machine"]];
  if (/pull[- ]?down|pulldown/.test(n)) return [["lat_pulldown", "cable_high"]];
  if (/cable|pushdown|push-down|face pull|pull[- ]through|crossover|cable fly/.test(n) || tag === "cable") {
    if (/pushdown|push-down|face pull|overhead|high|crossover|pullover|y[- ]raise|straight[- ]arm/.test(n)) return [["cable_high"]];
    if (/row|curl|kickback|pull[- ]through|low|lateral raise|upright|front raise|crunch/.test(n)) return [["cable_low", "seated_row"]];
    return [["cable_high", "cable_low"]];
  }
  if (/seated row/.test(n) && !db) return [["seated_row", "cable_low"]];
  if (/kettlebell|\bkb\b/.test(n) || tag === "kettlebell") return [["kettlebells"]];
  if (/\bband(ed|s)?\b/.test(n) || tag === "bands") return [["bands"]];
  if (/pull[- ]?up|chin[- ]?up|hanging (leg|knee)/.test(n)) return [["pullup_bar"]];
  if (/\bdips?\b/.test(n) && !/bench dip/.test(n)) return [["dip_station"]];
  if (/machine|pec deck|chest press machine|shoulder press machine|assisted/.test(n) || tag === "machine") return [["machines"]];
  if (bb || /barbell/.test(tag)) {
    add("barbell");
    if (/squat|bench press|competition bench|overhead press|military press|\bohp\b/.test(n) && !/split|lunge|step/.test(n)) add("rack");
    if (/bench press|competition bench|incline|decline/.test(n)) add(...((/incline|decline/.test(n) ? ["adjustable_bench"] : ["bench", "adjustable_bench"]) as EquipmentItem[]));
    return req;
  }
  if (db) {
    add("dumbbells", "adjustable_dumbbells");
    if (/incline|decline|seated|chest supported|chest-supported/.test(n)) add("adjustable_bench");
    else if (/bench press|fly|flye|pullover|split squat|bulgarian|tricep extension|skull/.test(n)) add("bench", "adjustable_bench");
    return req;
  }
  if (/bench/.test(tag) && !/bodyweight/.test(tag)) return [["bench", "adjustable_bench"]];
  return req;
}

export type EquipmentResolution = {
  source: "coach" | "program" | "goals" | "unknown";
  /** confirmed by the coach; inferred from what was trained; stated in Goals & Setup; unknown */
  confidence: "confirmed" | "inferred" | "stated" | "unknown";
  location: string | null;
  /** what the generator may use */
  items: EquipmentItem[];
  /** proven by the most recent program's trained exercises */
  proven: EquipmentItem[];
  /** stated in Goals & Setup */
  stated: EquipmentItem[];
  home: boolean;
  cableStations: number | null;
  space: string | null;
  notes: string | null;
  /** practical rules the program must follow (stations, cable sharing, load changes) */
  constraints: string[];
  conflicts: string[];
  evidence: string[];
};

const HOME_RE = /\bhome\b|at[- ]home|garage|basement/i;

/** Where the previous program says the athlete trains (names, notes, station notes). */
export function programHomeSignals(rec: IntelRecords, blockIds: string[]): string[] {
  const keep = new Set(blockIds);
  const out: string[] = [];
  for (const b of rec.blocks.filter((x) => keep.has(x.id))) {
    const t = [b.name, b.training_focus, b.goal, b.coach_notes].filter(Boolean).join(" · ");
    if (HOME_RE.test(t)) out.push(`Program "${b.name}"`);
  }
  const weekIds = new Set(rec.weeks.filter((w) => keep.has(w.block_id)).map((w) => w.id));
  const dayIds = new Set(rec.days.filter((d) => weekIds.has(d.week_id)).map((d) => d.id));
  const stationNotes = rec.rows.filter((r) => dayIds.has(r.day_id) && /\bstation\b/i.test(r.notes ?? "")).length;
  if (stationNotes >= 3) out.push(`${stationNotes} exercise notes organize the workout by station`);
  return out;
}

export function resolveEquipment(rec: IntelRecords, previousBlockIds: string[], exercises: Map<string, RawExercise & { equipment?: string | null }>): EquipmentResolution {
  const evidence: string[] = [];
  const conflicts: string[] = [];
  const profile: EquipmentProfile | null = rec.profile?.equipment_profile ?? null;
  const goalsLoc = rec.goals?.training_location ?? null;
  const fromGoals = itemsFromGoals(rec.goals?.equipment);
  // Equipment the previous program proved: every exercise trained in it.
  const keep = new Set(previousBlockIds);
  const weekIds = new Set(rec.weeks.filter((w) => keep.has(w.block_id)).map((w) => w.id));
  const dayIds = new Set(rec.days.filter((d) => weekIds.has(d.week_id)).map((d) => d.id));
  const trainedRows = new Set(rec.results.filter((r) => r.completed_at || r.actual_reps != null).map((r) => r.row_id));
  const proven = new Set<EquipmentItem>();
  const provenFrom = new Map<EquipmentItem, string>();
  for (const r of rec.rows) {
    if (!dayIds.has(r.day_id) || !trainedRows.has(r.id)) continue;
    const e = exercises.get(r.exercise_id ?? "");
    const name = r.exercise_name_override?.trim() || e?.name || "";
    if (!name) continue;
    for (const group of requirementsOf({ name, equipment: (e as any)?.equipment ?? null })) {
      // a group with one item is proven; a choice (e.g. pulldown machine or high cable) is proven by notes when they say which
      const note = `${r.notes ?? ""}`.toLowerCase();
      let item: EquipmentItem | undefined = group.length === 1 ? group[0] : undefined;
      if (!item) item = group.find((g) => (g === "cable_high" && /high cable/.test(note)) || (g === "cable_low" && /low|floor cable/.test(note)) || (g === "adjustable_bench" && /adjustable bench/.test(note)) || (g === "adjustable_dumbbells" && /adjustable dumbbell/.test(note)));
      if (!item && group.includes("dumbbells")) item = "dumbbells";
      if (!item && group.includes("bench")) item = "bench";
      // They trained it, so they have one of the options: the first stands for the choice (a lat pulldown
      // done without a note saying "high cable" still proves pulldowns are possible).
      if (!item) item = group[0];
      if (item && !proven.has(item)) {
        proven.add(item);
        provenFrom.set(item, name);
      }
    }
    const note = `${r.notes ?? ""}`.toLowerCase();
    if (/adjustable bench/.test(note)) proven.add("adjustable_bench");
    if (/adjustable dumbbell/.test(note)) proven.add("adjustable_dumbbells");
    if (/leg attachment|bench leg/.test(note) || /attachment/.test(name.toLowerCase())) {
      proven.add("leg_extension");
      proven.add("leg_curl");
    }
  }
  if (proven.has("adjustable_bench")) proven.add("bench");
  const homeSignals = programHomeSignals(rec, previousBlockIds);
  const home = profile ? HOME_RE.test(profile.location ?? "") : homeSignals.length > 0 || HOME_RE.test(goalsLoc ?? "");
  const provenList = [...proven];
  for (const i of provenList) evidence.push(`${EQUIPMENT_LABEL[i]}: trained ${provenFrom.get(i) ?? "(from exercise notes)"}`);

  let source: EquipmentResolution["source"];
  let confidence: EquipmentResolution["confidence"];
  let items: EquipmentItem[];
  let location: string | null;
  if (profile && profile.items?.length) {
    source = "coach";
    confidence = "confirmed";
    items = profile.items;
    location = profile.location ?? goalsLoc;
    const unused = provenList.filter((i) => !items.includes(i));
    if (unused.length) conflicts.push(`The last program trained with ${unused.map((i) => EQUIPMENT_LABEL[i]).join(", ")}, which isn't in the confirmed equipment. Using the confirmed list.`);
  } else if (provenList.length && (homeSignals.length || HOME_RE.test(goalsLoc ?? ""))) {
    source = "program";
    confidence = "inferred";
    items = provenList;
    location = homeSignals.length ? "Home gym (from the last program)" : goalsLoc;
    if (goalsLoc && !HOME_RE.test(goalsLoc))
      conflicts.push(`Goals & Setup says "${goalsLoc}"${rec.goals?.updated_at ? ` (updated ${rec.goals.updated_at.slice(0, 10)})` : ""}, but the last program was built for a home setup (${homeSignals.join("; ")}). Using only the equipment that program proved; confirm the equipment to change this.`);
    const extra = fromGoals.items.filter((i) => !items.includes(i));
    if (extra.length && HOME_RE.test(goalsLoc ?? "")) evidence.push(`Goals & Setup also lists: ${extra.map((i) => EQUIPMENT_LABEL[i]).join(", ")} (not used yet)`);
  } else if (fromGoals.items.length) {
    source = "goals";
    confidence = "stated";
    items = [...new Set([...fromGoals.items, ...provenList])];
    location = goalsLoc;
    if (fromGoals.unsure) conflicts.push(`Goals & Setup's equipment list includes "Not sure": confirm what they have before relying on it.`);
  } else if (provenList.length) {
    source = "program";
    confidence = "inferred";
    items = provenList;
    location = goalsLoc;
  } else {
    source = "unknown";
    confidence = "unknown";
    items = [];
    location = goalsLoc;
  }
  const cableStations = profile?.cableStations ?? (home && (items.includes("cable_high") || items.includes("cable_low")) ? 1 : null);
  const constraints: string[] = [];
  if (cableStations === 1 && (items.includes("cable_high") || items.includes("cable_low")))
    constraints.push(`One cable column${profile?.cableStations ? "" : " (assumed for a home setup)"}: never superset or alternate two cable exercises; group cable work into one station and do the high and low positions back to back.`);
  if (items.includes("adjustable_dumbbells")) constraints.push("Adjustable dumbbells: changing the load takes time, so group dumbbell exercises with similar loads and avoid supersets that need two different dumbbell weights.");
  if (items.includes("adjustable_bench")) constraints.push("One adjustable bench: order exercises so the bench angle changes as few times as possible (e.g. incline work together, then flat).");
  if (home) constraints.push("Home setup: organize each session into stations (rack / barbell → dumbbells + bench → cable) and finish one station before moving to the next; avoid exercises that need a long setup change for one or two sets.");
  if (items.includes("leg_extension") && items.includes("leg_curl") && !items.includes("machines") && home) constraints.push("Leg extension and leg curl share one bench attachment: finish all sets of one before switching to the other.");
  if (profile?.space) constraints.push(`Space: ${profile.space}.`);
  if (profile?.notes) constraints.push(`Coach's equipment notes: ${profile.notes}`);
  return { source, confidence, location, items, proven: provenList, stated: fromGoals.items, home, cableStations, space: profile?.space ?? null, notes: profile?.notes ?? null, constraints, conflicts, evidence };
}

/** Which of an exercise's requirements the available equipment doesn't meet ([] = it fits). Unknown equipment rules nothing out. */
export function missingEquipment(ex: { name: string; equipment?: string | null }, res: Pick<EquipmentResolution, "items" | "confidence">): EquipmentItem[][] {
  if (res.confidence === "unknown") return [];
  const have = new Set(res.items);
  // a full gym's machines cover the specific machines
  if (have.has("machines")) for (const m of ["leg_press", "hack_squat", "leg_extension", "leg_curl", "lat_pulldown", "seated_row", "hip_thrust_machine", "smith"] as EquipmentItem[]) have.add(m);
  if (have.has("adjustable_bench")) have.add("bench");
  if (have.has("adjustable_dumbbells")) have.add("dumbbells");
  return requirementsOf(ex).filter((g) => !g.some((i) => have.has(i)));
}

/** The station an exercise is done at (for ordering and counting transitions). */
export function stationOf(ex: { name: string; equipment?: string | null }): string {
  const req = requirementsOf(ex).flat();
  if (req.includes("landmine")) return "landmine";
  if (req.some((i) => i === "cable_high" || i === "cable_low" || i === "lat_pulldown" || i === "seated_row")) return "cable";
  if (req.includes("barbell")) return "barbell";
  if (req.some((i) => i === "dumbbells" || i === "adjustable_dumbbells")) return "dumbbells";
  if (req.some((i) => i === "leg_extension" || i === "leg_curl")) return "leg attachment";
  if (req.some((i) => ["machines", "leg_press", "hack_squat", "smith", "hip_thrust_machine", "belt_squat"].includes(i))) return "machine";
  if (req.includes("kettlebells")) return "kettlebells";
  if (req.includes("bands")) return "bands";
  if (req.includes("pullup_bar")) return "pull-up bar";
  return "bodyweight";
}
