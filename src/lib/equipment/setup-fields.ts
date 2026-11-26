/**
 * What a setup asks for, by equipment and exercise (pure, tested in
 * setup-fields.test.ts). The setup sheet offers the settings that matter for
 * what's being set up (a rack's rack and safety height, a cable's pulley and
 * attachment, a machine's seat and pads, a bench's angle; a squat's stance, a
 * press's grip) and gives each the control that saves typing: a stepper for a
 * number, one-tap chips for a choice, a box only for words of their own.
 *
 * Settings are still stored as plain { label, value } (equipment.ts): a field
 * here is how a label is shown and edited. A label typed before this existed
 * ("J-hooks", "Safeties", "Seat") is matched to its field by `match`, keeps
 * the words it was saved with, and gets the field's control.
 */
import type { EquipmentKind, EquipmentData, Setting } from "./equipment";

export type FieldControl = "number" | "choice" | "text";

export type FieldDef = {
  key: string;
  /** What a new setting is called. */
  label: string;
  /** The card's short form of `label` ("Rack height 9" → "Rack 9"). */
  short: string;
  control: FieldControl;
  /** A number's step (+ / −), and the range it stays in. */
  step?: number;
  min?: number;
  max?: number;
  /** What + starts from on an empty number with nothing used before. */
  start?: number;
  /** A choice's one-tap answers (anything else can still be typed). */
  options?: readonly string[];
  /** Labels that mean this field (case-insensitive, whole label). */
  match: RegExp;
  /** How important it is on the card's one-line summary (lower first). */
  rank: number;
};

const GRIP_WIDTH = ["Close", "Shoulder-width", "Medium", "Wide"] as const;
const GRIP_PULL = ["Overhand", "Underhand", "Neutral", "Wide", "Close"] as const;
const GRIP_DEADLIFT = ["Double overhand", "Mixed", "Hook", "Straps"] as const;

export const FIELDS = {
  rack_height: { key: "rack_height", label: "Rack height", short: "Rack", control: "number", step: 1, min: 0, max: 60, start: 8, match: /^(j[- ]?hooks?|hooks?|rack(?: height| hole)?|bar height|hook height)$/i, rank: 1 },
  safety_height: { key: "safety_height", label: "Safety height", short: "Safeties", control: "number", step: 1, min: 0, max: 60, start: 4, match: /^safet(?:y|ies)(?: height| arms| pins| straps)?$/i, rank: 2 },
  pins: { key: "pins", label: "Pins", short: "Pins", control: "number", step: 1, min: 0, max: 60, start: 4, match: /^pins?(?: height)?$/i, rank: 3 },
  seat: { key: "seat", label: "Seat position", short: "Seat", control: "number", step: 1, min: 0, max: 40, start: 4, match: /^seat(?: height| position| setting)?$/i, rank: 1 },
  back_pad: { key: "back_pad", label: "Back pad", short: "Back pad", control: "number", step: 1, min: 0, max: 40, start: 3, match: /^back ?(?:pad|rest)$/i, rank: 2 },
  chest_pad: { key: "chest_pad", label: "Chest pad", short: "Chest pad", control: "number", step: 1, min: 0, max: 40, start: 3, match: /^chest ?(?:pad|support)$/i, rank: 2 },
  leg_pad: { key: "leg_pad", label: "Leg pad", short: "Leg pad", control: "number", step: 1, min: 0, max: 40, start: 3, match: /^(?:leg|shin|ankle|knee|thigh|roller) ?(?:pad|roller)?$/i, rank: 2 },
  start_position: { key: "start_position", label: "Start position", short: "Start", control: "number", step: 1, min: 0, max: 40, start: 3, match: /^(?:start(?:ing)? position|range|rom|lever|arm position)$/i, rank: 3 },
  foot_position: { key: "foot_position", label: "Foot position", short: "Feet", control: "choice", options: ["High", "Middle", "Low", "Narrow", "Wide"], match: /^(?:foot|feet)(?: position| placement)?$|^foot ?plate$/i, rank: 4 },
  pulley_height: { key: "pulley_height", label: "Pulley height", short: "Pulley", control: "number", step: 1, min: 0, max: 60, start: 10, match: /^(?:pulley|cable)(?: height| position| hole)?$/i, rank: 1 },
  attachment: { key: "attachment", label: "Attachment", short: "", control: "choice", options: ["Rope", "Straight bar", "EZ bar", "V-bar", "D-handle", "Lat bar", "MAG grip", "Ankle strap"], match: /^(?:attachment|handles?|bar)$/i, rank: 2 },
  bench_angle: { key: "bench_angle", label: "Bench angle", short: "Bench", control: "choice", options: ["Flat", "15°", "30°", "45°", "60°", "75°", "Upright", "Decline"], match: /^(?:bench(?: angle| incline| setting)?|incline angle|back angle|angle)$/i, rank: 3 },
  grip: { key: "grip", label: "Grip", short: "grip", control: "choice", options: GRIP_WIDTH, match: /^grip(?: width)?$/i, rank: 5 },
  stance: { key: "stance", label: "Stance", short: "stance", control: "choice", options: ["Narrow", "Hip-width", "Shoulder-width", "Wide", "Sumo"], match: /^stance(?: width)?$/i, rank: 5 },
  incline: { key: "incline", label: "Incline", short: "Incline", control: "number", step: 0.5, min: 0, max: 40, start: 5, match: /^incline(?: %)?$/i, rank: 1 },
  speed: { key: "speed", label: "Speed", short: "Speed", control: "number", step: 0.1, min: 0, max: 30, start: 3, match: /^speed$/i, rank: 2 },
  level: { key: "level", label: "Level", short: "Level", control: "number", step: 1, min: 0, max: 40, start: 5, match: /^(?:level|resistance)$/i, rank: 1 },
  damper: { key: "damper", label: "Damper", short: "Damper", control: "number", step: 1, min: 1, max: 10, start: 5, match: /^damper$/i, rank: 1 },
} as const satisfies Record<string, FieldDef>;

export type FieldKey = keyof typeof FIELDS;

type ExerciseLike = { name?: string | null; equipment?: string | null } | null | undefined;

const lower = (s: string | null | undefined) => String(s ?? "").toLowerCase();

/** What kind of lift it is, from its name (for the body-position fields and a grip's answers). */
function liftShape(ex: ExerciseLike): {
  squat: boolean;
  deadlift: boolean;
  press: boolean;
  pull: boolean;
  legPress: boolean;
  legPad: boolean;
  chestSupported: boolean;
  free: boolean;
} {
  const n = lower(ex?.name);
  const e = lower(ex?.equipment);
  const free = /dumbbell|\bdb\b|kettlebell|\bkb\b/.test(n) || /dumbbell|kettlebell/.test(e);
  return {
    squat: /squat/.test(n) && !/split squat|pistol|sissy|goblet/.test(n),
    deadlift: /deadlift|rdl|romanian|stiff[- ]leg|good morning|rack pull/.test(n),
    press: /press|bench|dip/.test(n) && !/leg press/.test(n),
    pull: /row|pull[- ]?down|pull[- ]?up|chin|pullover|face pull|pull[- ]?through/.test(n),
    legPress: /leg press|hack squat|pendulum|v[- ]squat|belt squat/.test(n),
    legPad: /leg extension|leg curl|hamstring curl|knee extension|glute ham|ghr|back extension|hyperextension/.test(n),
    chestSupported: /chest[- ]supported|t[- ]bar|seal row|incline row|iso[- ]?lateral row/.test(n),
    free,
  };
}

/**
 * The settings a setup offers before anything's saved: what the equipment
 * has (a rack's heights, a cable's pulley and attachment…), then what the lift
 * needs (a squat's stance, a press's grip), at most four. With nothing picked
 * it's the lift's own (a dumbbell incline's bench angle).
 */
export function fieldsFor(kind: EquipmentKind | null, ex: ExerciseLike): FieldKey[] {
  const s = liftShape(ex);
  const name = lower(ex?.name);
  const out: FieldKey[] = [];
  const add = (...keys: FieldKey[]) => {
    for (const k of keys) if (!out.includes(k)) out.push(k);
  };
  switch (kind) {
    case "rack":
      add("rack_height", "safety_height");
      if (/pin press|pin squat|rack pull|pin pull/.test(name)) add("pins");
      break;
    case "smith":
      add("rack_height", "safety_height");
      if (s.press) add("bench_angle");
      break;
    case "bench":
      add("bench_angle");
      if (/seated|preacher|curl|press/.test(name)) add("seat");
      break;
    case "machine":
      if (s.legPress) add("seat", "foot_position");
      else if (s.legPad) add("seat", "leg_pad", "start_position");
      else if (s.chestSupported) add("chest_pad", "seat");
      else add("seat", "back_pad");
      break;
    case "cable":
      add("pulley_height", "attachment");
      break;
    case "cardio":
      if (/bike|cycle|elliptical|stair|step/.test(name)) add("level", "seat");
      else if (/row/.test(name)) add("damper");
      else add("incline", "speed");
      break;
    default:
      break;
  }
  // what the lift itself asks, whatever it's on
  if (kind !== "cardio") {
    if (s.squat && !s.legPress) add("stance");
    if (s.deadlift) add("stance", "grip");
    if (s.press && !s.free && kind !== "machine" && kind !== "cable") add("grip");
    if (s.free && /incline|decline|bench|seated/.test(name) && kind == null) add("bench_angle");
  }
  return out.slice(0, 4);
}

/** The other fields that suit this setup, one tap each under the list ("+ Grip"). */
export function moreFieldsFor(kind: EquipmentKind | null, ex: ExerciseLike, shown: readonly string[]): FieldKey[] {
  const have = new Set(shown.map((l) => fieldFor(l, kind)?.key).filter(Boolean) as string[]);
  const pool: FieldKey[] = (() => {
    switch (kind) {
      case "rack":
        return ["pins", "bench_angle", "grip", "stance"];
      case "smith":
        return ["bench_angle", "grip", "stance"];
      case "bench":
        return ["seat", "grip"];
      case "machine":
        return ["seat", "back_pad", "chest_pad", "leg_pad", "foot_position", "start_position", "grip"];
      case "cable":
        return ["grip", "stance", "seat", "bench_angle"];
      case "cardio":
        return ["incline", "speed", "level", "seat"];
      default: {
        // nothing picked: only what could matter for this lift (a deadlift never asks for a bench angle)
        const n = lower(ex?.name);
        const out: FieldKey[] = ["grip", "stance"];
        if (/press|fly|flye|row|curl|bench|incline|decline|seated|extension|raise/.test(n)) out.push("bench_angle");
        if (/seated|machine|preacher/.test(n)) out.push("seat");
        return out;
      }
    }
  })();
  const s = liftShape(ex);
  const sorted = [...pool].sort((a, b) => Number(rel(b)) - Number(rel(a)));
  function rel(k: FieldKey) {
    if (k === "stance") return s.squat || s.deadlift || s.legPress;
    if (k === "grip") return s.press || s.pull || s.deadlift;
    return false;
  }
  return sorted.filter((k) => !have.has(k)).slice(0, 4);
}

/**
 * The field a saved label is (null: their own label). On cardio "Incline" is
 * the treadmill's; anywhere else an "incline" or "angle" is the bench's.
 */
export function fieldFor(label: string | null | undefined, kind: EquipmentKind | null = null): FieldDef | null {
  const l = String(label ?? "").trim();
  if (!l) return null;
  if (kind === "cardio") {
    for (const k of ["incline", "speed", "level", "damper", "seat"] as const) if (FIELDS[k].match.test(l)) return FIELDS[k];
  }
  if (/^incline$/i.test(l) && kind && kind !== "cardio") return FIELDS.bench_angle;
  for (const f of Object.values(FIELDS) as FieldDef[]) if (f.match.test(l)) return f;
  return null;
}

/** A choice's answers for this lift (a deadlift's grip is how they hold the bar; a row's is which way the palms face). */
export function optionsFor(def: FieldDef, ex: ExerciseLike): readonly string[] {
  if (def.key !== "grip") return def.options ?? [];
  const s = liftShape(ex);
  if (s.deadlift) return GRIP_DEADLIFT;
  if (s.pull) return GRIP_PULL;
  return GRIP_WIDTH;
}

/** A number setting's control: what the label means as a number (unknown labels that read as numbers get a stepper too). */
const NUMERIC_LABEL = /\b(hole|notch|position|setting|height|level|pad|pin|seat)\b/i;
export function controlFor(label: string, value: string, kind: EquipmentKind | null = null): FieldControl {
  const def = fieldFor(label, kind);
  if (def) return def.control;
  if (NUMERIC_LABEL.test(label) && /^[\d.,\s]*$/.test(value)) return "number";
  return "text";
}

/** A number as typed ("9", "2,5", " 10 ") or null. */
export function readNumber(value: string | null | undefined): number | null {
  const t = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

/**
 * One tap of − or +: from the value (or, when empty, what they used before,
 * else the field's usual start), a step at a time, kept in range and written
 * the way it's typed ("2.5", never "2.5000001").
 */
export function stepValue(value: string, dir: 1 | -1, def: Pick<FieldDef, "step" | "min" | "max" | "start"> | null, fallback?: string | null): string {
  const step = def?.step ?? 1;
  const cur = readNumber(value);
  if (cur == null) {
    const from = readNumber(fallback ?? null) ?? def?.start ?? (def?.min ?? 0) + (dir > 0 ? step : 0);
    return format(clamp(from, def), step);
  }
  return format(clamp(cur + dir * step, def), step);
}

function clamp(n: number, def: Pick<FieldDef, "min" | "max"> | null): number {
  const min = def?.min ?? -Infinity;
  const max = def?.max ?? Infinity;
  return Math.min(max, Math.max(min, n));
}

function format(n: number, step: number): string {
  const d = Math.max(decimals(step), 0);
  const fixed = n.toFixed(d);
  return d ? String(Number(fixed)) : fixed;
}

/**
 * How a setting reads on the card's one line ("Rack 9", "Bench 30°",
 * "Flat bench", "Rope", "Wide grip", "Sumo stance"); a label saved in their
 * own words keeps them ("J-hooks 9").
 */
export function settingWords(s: Setting, kind: EquipmentKind | null = null): string {
  const def = fieldFor(s.label, kind);
  const value = s.value.trim();
  if (!def) return `${s.label} ${value}`;
  if (def.key === "attachment") return value;
  if (def.key === "grip" || def.key === "stance") return /grip|stance/i.test(value) ? value : `${value} ${def.short}`;
  if (def.key === "bench_angle") {
    if (/^flat$/i.test(value)) return "Flat bench";
    if (/^decline$/i.test(value)) return "Decline bench";
    if (/^upright$/i.test(value)) return "Upright bench";
    return `${def.short} ${value}`;
  }
  // the field's own long label shortens; a label saved their way ("J-hooks") stays theirs
  const own = s.label.trim().toLowerCase() === def.label.toLowerCase();
  return `${own ? def.short : s.label.trim()} ${value}`;
}

/**
 * The settings in the order the card reads them: the ones that set the
 * lift up first (heights, seat, pulley), then attachment and angles, then
 * grip and stance; a label of their own after the known ones, in saved order.
 */
export function rankSettings(list: readonly Setting[], kind: EquipmentKind | null = null): Setting[] {
  return list
    .map((s, i) => ({ s, i, r: fieldFor(s.label, kind)?.rank ?? 6 }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Values they've used for this setting before, newest first (one tap to put
 * one back): this setup's earlier versions, the same lift on other
 * equipment, then the same equipment for other lifts. Never what's in the box
 * now, at most `max`.
 */
export function previousValues({
  data,
  revisions = [],
  exerciseId,
  equipmentId,
  label,
  kind = null,
  current = "",
  max = 3,
}: {
  data: EquipmentData;
  revisions?: ReadonlyArray<{ equipment_id: string | null; settings: Setting[]; created_at?: string | null }>;
  exerciseId: string;
  equipmentId: string | null;
  label: string;
  kind?: EquipmentKind | null;
  current?: string;
  max?: number;
}): string[] {
  const def = fieldFor(label, kind);
  const same = (l: string) => (def ? fieldFor(l, kind)?.key === def.key : l.trim().toLowerCase() === label.trim().toLowerCase());
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (!t || t.toLowerCase() === current.trim().toLowerCase() || out.some((o) => o.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
  for (const r of [...revisions].filter((r) => (r.equipment_id ?? null) === (equipmentId ?? null)).sort((a, b) => time(b.created_at) - time(a.created_at))) {
    for (const s of r.settings ?? []) if (same(s.label)) push(s.value);
  }
  const others = data.setups.filter((s) => !(s.exercise_id === exerciseId && (s.equipment_id ?? null) === (equipmentId ?? null)));
  const byRecent = (a: { updated_at: string | null }, b: { updated_at: string | null }) => time(b.updated_at) - time(a.updated_at);
  for (const s of others.filter((s) => s.exercise_id === exerciseId).sort(byRecent)) for (const x of s.settings) if (same(x.label)) push(x.value);
  if (equipmentId) for (const s of others.filter((s) => s.equipment_id === equipmentId).sort(byRecent)) for (const x of s.settings) if (same(x.label)) push(x.value);
  return out.slice(0, max);
}
