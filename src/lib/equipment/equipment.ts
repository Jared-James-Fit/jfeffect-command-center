/**
 * Equipment & setups (pure, tested in equipment.test.ts).
 *
 * An athlete's gyms, the racks and machines in them, and how each exercise is
 * set up on each one ("J-hooks 9 · Safeties 4"). The database is the judge of
 * what's current and what a set was done on (20270420090000_equipment_setups.sql:
 * athlete_current_equipment, the stamping trigger, equipment_choose); this file
 * reads the same data the same way for the screens:
 *
 *   currentSetup     the setup a workout card shows (newest pick, never retired equipment)
 *   cardEquipment    what a card shows: what its sets were logged on, else the
 *                    current pick (never today's pick on a past workout)
 *   setupSummary     the card's one quiet line ("Rogue rack · J-hooks 9 · Safeties 4")
 *   preferSameEquipment  "Last time" and the weight suggestions read the same
 *                    machine when there's history on it: weights on two machines
 *                    are never treated as the same thing (a rack or a bench never
 *                    changes the weight, so those read everything)
 */

export type EquipmentKind = "rack" | "bench" | "machine" | "cable" | "smith" | "cardio" | "other";

export const EQUIPMENT_KINDS: ReadonlyArray<{ key: EquipmentKind; label: string }> = [
  { key: "rack", label: "Rack" },
  { key: "bench", label: "Bench" },
  { key: "machine", label: "Machine" },
  { key: "cable", label: "Cable" },
  { key: "smith", label: "Smith" },
  { key: "cardio", label: "Cardio" },
  { key: "other", label: "Other" },
];

export const KIND_LABEL: Record<EquipmentKind, string> = Object.fromEntries(
  EQUIPMENT_KINDS.map((k) => [k.key, k.label]),
) as Record<EquipmentKind, string>;

export type Gym = {
  id: string;
  client_id: string;
  name: string;
  archived_at: string | null;
};

export type Equipment = {
  id: string;
  client_id: string;
  gym_id: string | null;
  kind: EquipmentKind;
  name: string;
  brand: string | null;
  model: string | null;
  notes: string | null;
  photo_path: string | null;
  favorite: boolean;
  last_used_at: string | null;
  archived_at: string | null;
  created_at?: string | null;
};

export type Setting = { label: string; value: string };

export type ExerciseSetup = {
  id: string;
  client_id: string;
  exercise_id: string;
  equipment_id: string | null;
  settings: Setting[];
  notes: string | null;
  photo_path: string | null;
  source: "athlete" | "coach";
  last_used_at: string | null;
  updated_at: string | null;
};

export type EquipmentData = { gyms: Gym[]; equipment: Equipment[]; setups: ExerciseSetup[] };

export const EMPTY_EQUIPMENT: EquipmentData = { gyms: [], equipment: [], setups: [] };

/** Limits the database keeps too (athlete_setup_clean_settings). */
export const SETTING_LABEL_MAX = 32;
export const SETTING_VALUE_MAX = 40;
export const SETTINGS_MAX = 12;
export const NAME_MAX = 60;
export const NOTE_MAX = 280;

/**
 * Settings as stored: labelled values only, trimmed, at most 12, in the order
 * given; a label with nothing typed beside it is dropped. The same rule as
 * athlete_setup_clean_settings.
 */
export function cleanSettings(list: unknown): Setting[] {
  if (!Array.isArray(list)) return [];
  const out: Setting[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const label = String((item as any).label ?? "").trim().slice(0, SETTING_LABEL_MAX);
    const value = String((item as any).value ?? "").trim().slice(0, SETTING_VALUE_MAX);
    if (!label || !value) continue;
    out.push({ label, value });
    if (out.length >= SETTINGS_MAX) break;
  }
  return out;
}

/** The settings worth asking for on each kind of equipment (all optional, all renameable). */
export const SETTING_SUGGESTIONS: Record<EquipmentKind, readonly string[]> = {
  rack: ["J-hooks", "Safeties"],
  bench: ["Back pad", "Seat"],
  machine: ["Seat", "Back pad"],
  cable: ["Pulley height", "Attachment"],
  smith: ["Safeties", "Bench"],
  cardio: ["Incline", "Speed"],
  other: ["Setting"],
};

/** The fields a setup sheet offers: what's saved first, then the kind's suggestions not already there. */
export function setupFields(kind: EquipmentKind | null, saved: readonly Setting[]): Setting[] {
  const out: Setting[] = saved.map((s) => ({ ...s }));
  const have = new Set(out.map((s) => s.label.toLowerCase()));
  for (const label of SETTING_SUGGESTIONS[kind ?? "other"]) {
    if (!have.has(label.toLowerCase())) out.push({ label, value: "" });
  }
  return out;
}

/**
 * What kind of equipment an exercise is most likely done on (picker order and
 * a new piece's default), from the library's equipment field and its name.
 * null: nothing to set up (dumbbells on the floor, a bodyweight move).
 */
export function suggestKind(ex: { name?: string | null; equipment?: string | null } | null | undefined): EquipmentKind | null {
  const name = String(ex?.name ?? "").toLowerCase();
  const eq = String(ex?.equipment ?? "").toLowerCase();
  if (/\bsmith\b/.test(name) || /\bsmith\b/.test(eq)) return "smith";
  if (/treadmill|bike|rower|rowing machine|elliptical|stair|ski erg|assault/.test(name)) return "cardio";
  if (/\bcable\b|pulldown|pushdown|face pull/.test(name) || /\bcable\b/.test(eq)) return "cable";
  if (/machine|leg press|hack squat|leg extension|leg curl|pec deck|hammer strength|iso[- ]?lateral|belt squat|chest press|seated row machine|abductor|adductor/.test(name) || /\bmachine\b/.test(eq)) return "machine";
  const barbell = /barbell/.test(eq) || /\bbarbell\b|competition|comp\b|\bsquat\b|bench press|overhead press|ohp\b|pin press|rack pull/.test(name);
  // a barbell squat, bench or press comes out of a rack (a bench press's uprights included)
  // (never one done with dumbbells or a kettlebell, whatever its name: a Bulgarian split squat with dumbbells needs no rack)
  const freeWeights = /dumbbell|\bdb\b|kettlebell|\bkb\b/.test(name) || /dumbbell|kettlebell/.test(eq);
  if (barbell && /squat|bench|press|good morning|rack|pin|lunge|split squat/.test(name) && !freeWeights) return "rack";
  if (/\brack\b/.test(eq)) return "rack";
  if (/incline|decline|bench|seated|preacher/.test(name) || /\bbench\b/.test(eq)) return "bench";
  return null;
}

/**
 * Where an empty card offers "Add your setup": equipment whose settings change
 * the lift (J-hooks and safeties, a seat, a pulley). Never a bench, dumbbells
 * or a bodyweight move, so a day's accessories don't each ask.
 */
export function offersSetup(ex: { name?: string | null; equipment?: string | null } | null | undefined): boolean {
  const kind = suggestKind(ex);
  return kind === "rack" || kind === "smith" || kind === "machine" || kind === "cable";
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

const live = (eq: Equipment | undefined | null): boolean => !!eq && !eq.archived_at;

/**
 * The setup an exercise's card shows now: the one picked last, never on
 * retired equipment (the database's athlete_current_equipment, as a setup).
 */
export function currentSetup(data: EquipmentData, exerciseId: string | null | undefined): ExerciseSetup | null {
  if (!exerciseId) return null;
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  let best: ExerciseSetup | null = null;
  for (const s of data.setups) {
    if (s.exercise_id !== exerciseId || !s.last_used_at) continue;
    if (s.equipment_id && !live(byId.get(s.equipment_id))) continue;
    if (!best || time(s.last_used_at) > time(best.last_used_at)) best = s;
  }
  return best;
}

/** The setup saved for this exercise on this equipment (null: on nothing in particular). */
export function setupFor(data: EquipmentData, exerciseId: string | null | undefined, equipmentId: string | null): ExerciseSetup | null {
  if (!exerciseId) return null;
  return data.setups.find((s) => s.exercise_id === exerciseId && (s.equipment_id ?? null) === (equipmentId ?? null)) ?? null;
}

/** How long after a set is logged it still belongs to "today's" workout (the trigger's 18 hours). */
export const LIVE_WINDOW_MS = 18 * 60 * 60 * 1000;

type CardSet = { completed_at?: string | null; equipment_id?: string | null };

/**
 * What a workout card says it's on:
 *   - "logged": what its logged sets were stamped with (the most of them), so a
 *     finished workout always shows what it was really done on;
 *   - "none": logged sets from before today with nothing stamped (an old
 *     workout): never today's pick, which it wasn't done on;
 *   - "current": otherwise the exercise's current pick.
 */
export function cardEquipment(
  sets: readonly CardSet[],
  current: ExerciseSetup | null,
  now: number = Date.now(),
): { equipmentId: string | null; source: "logged" | "current" | "none" } {
  const logged = sets.filter((s) => !!s.completed_at);
  const counts = new Map<string, number>();
  for (const s of logged) {
    if (s.equipment_id) counts.set(s.equipment_id, (counts.get(s.equipment_id) ?? 0) + 1);
  }
  if (counts.size) {
    const [id] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { equipmentId: id, source: "logged" };
  }
  if (logged.some((s) => now - time(s.completed_at) > LIVE_WINDOW_MS)) {
    return { equipmentId: null, source: "none" };
  }
  return current ? { equipmentId: current.equipment_id, source: "current" } : { equipmentId: null, source: "none" };
}

/**
 * A card's equipment and setup, as its one quiet line says it ("Rogue rack ·
 * J-hooks 9 · Safeties 4"): what its sets were logged on, else the exercise's
 * current pick (cardEquipment), and the setup saved for that equipment. One
 * reading for the logger and the coach's workout quick view.
 */
export function cardSetupView(
  data: EquipmentData,
  exerciseId: string | null | undefined,
  sets: readonly CardSet[],
  now: number = Date.now(),
): { equipmentId: string | null; equipment: Equipment | null; setup: ExerciseSetup | null; summary: string } {
  const current = currentSetup(data, exerciseId);
  const shown = cardEquipment(sets, current, now);
  const equipment = shown.equipmentId ? data.equipment.find((e) => e.id === shown.equipmentId) ?? null : null;
  const setup = shown.source === "current" ? current : shown.equipmentId ? setupFor(data, exerciseId, shown.equipmentId) : null;
  return { equipmentId: shown.equipmentId, equipment, setup, summary: setupSummary(setup, equipment) };
}

/** A rack or a bench never changes what the weight means; a machine, a cable or a Smith does. */
export function comparesAcrossEquipment(kind: EquipmentKind | null | undefined): boolean {
  return kind === "rack" || kind === "bench";
}

/**
 * The equipment id history should be read on for this card's weights: the
 * card's equipment when it changes what a weight means, else null (read all).
 */
export function loadEquipmentId(eq: Pick<Equipment, "id" | "kind"> | null | undefined): string | null {
  if (!eq) return null;
  return comparesAcrossEquipment(eq.kind) ? null : eq.id;
}

/**
 * History read on the card's machine: sets on this machine and sets that never
 * said (logged before equipment was tracked, or with nothing picked), never
 * another machine's. With none of those, everything (and `other`, so the card
 * can say it's another machine's).
 */
export function preferSameEquipment<T extends { equipmentId?: string | null }>(
  logs: readonly T[],
  equipmentId: string | null | undefined,
): { logs: T[]; other: boolean } {
  if (!equipmentId) return { logs: [...logs], other: false };
  const same = logs.filter((l) => !l.equipmentId || l.equipmentId === equipmentId);
  if (same.length) return { logs: same, other: false };
  return { logs: [...logs], other: logs.length > 0 };
}

/** "Rogue rack", or its brand and model when it has no name of its own. */
export function equipmentName(eq: Pick<Equipment, "name" | "brand" | "model"> | null | undefined): string {
  if (!eq) return "";
  const name = (eq.name ?? "").trim();
  if (name) return name;
  return [eq.brand, eq.model].filter(Boolean).join(" ").trim();
}

/** "Hammer Strength · ISO-Lateral Row" under a name, only when it adds something. */
export function equipmentDetail(eq: Pick<Equipment, "name" | "brand" | "model">, gymName?: string | null): string {
  const name = (eq.name ?? "").trim().toLowerCase();
  const bm = [eq.brand, eq.model].map((s) => (s ?? "").trim()).filter((s) => s && !name.includes(s.toLowerCase()));
  return [gymName ?? null, ...bm].filter(Boolean).join(" · ");
}

/** "J-hooks 9 · Safeties 4". */
export function settingsText(settings: readonly Setting[] | null | undefined, max = 3): string {
  const list = cleanSettings(settings ?? []);
  return list.slice(0, max).map((s) => `${s.label} ${s.value}`).join(" · ");
}

/**
 * The card's one quiet line: the equipment, then its first settings.
 * Empty when there's nothing worth a line (no equipment and no settings).
 */
export function setupSummary(setup: Pick<ExerciseSetup, "settings"> | null, eq: Pick<Equipment, "name" | "brand" | "model"> | null): string {
  const parts = [eq ? equipmentName(eq) : "", settingsText(setup?.settings ?? [], eq ? 2 : 3)].filter(Boolean);
  return parts.join(" · ");
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The equipment they already have under this name in this gym (adding it again reuses it). */
export function findDuplicate(data: EquipmentData, name: string, gymId: string | null, exceptId?: string | null): Equipment | null {
  const n = norm(name);
  if (!n) return null;
  return data.equipment.find((e) => !e.archived_at && e.id !== exceptId && (e.gym_id ?? null) === (gymId ?? null) && norm(e.name) === n) ?? null;
}

/** Equipment with a name like what's being typed (any gym), for "You already have…". */
export function similarEquipment(data: EquipmentData, typed: string, limit = 3): Equipment[] {
  const n = norm(typed);
  if (n.length < 2) return [];
  return data.equipment
    .filter((e) => !e.archived_at && (norm(e.name).includes(n) || norm(`${e.brand ?? ""} ${e.model ?? ""}`).includes(n)))
    .slice(0, limit);
}

export type PickerSections = {
  /** Used for this exercise before (setups), most recent first. */
  forExercise: Equipment[];
  /** Starred, not already above. */
  favorites: Equipment[];
  /** Everything else, by gym (gyms by name, then no gym), the exercise's kind first. */
  byGym: Array<{ gym: Gym | null; items: Equipment[] }>;
};

/** The equipment picker for an exercise: what it's been done on, favorites, then everything by gym. */
export function pickerSections(data: EquipmentData, exerciseId: string | null | undefined, kind: EquipmentKind | null): PickerSections {
  const liveEq = data.equipment.filter((e) => !e.archived_at);
  const byId = new Map(liveEq.map((e) => [e.id, e]));
  const used = data.setups
    .filter((s) => s.exercise_id === exerciseId && s.equipment_id && byId.has(s.equipment_id))
    .sort((a, b) => time(b.last_used_at) - time(a.last_used_at) || time(b.updated_at) - time(a.updated_at));
  const seen = new Set<string>();
  const forExercise: Equipment[] = [];
  for (const s of used) {
    if (seen.has(s.equipment_id!)) continue;
    seen.add(s.equipment_id!);
    forExercise.push(byId.get(s.equipment_id!)!);
  }
  const favorites = liveEq.filter((e) => e.favorite && !seen.has(e.id)).sort((a, b) => time(b.last_used_at) - time(a.last_used_at) || a.name.localeCompare(b.name));
  for (const f of favorites) seen.add(f.id);
  const rest = liveEq.filter((e) => !seen.has(e.id));
  const order = (a: Equipment, b: Equipment) =>
    Number(b.kind === kind) - Number(a.kind === kind) || time(b.last_used_at) - time(a.last_used_at) || a.name.localeCompare(b.name);
  const gyms = data.gyms.filter((g) => !g.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const byGym: PickerSections["byGym"] = [];
  for (const g of gyms) {
    const items = rest.filter((e) => e.gym_id === g.id).sort(order);
    if (items.length) byGym.push({ gym: g, items });
  }
  const loose = rest.filter((e) => !e.gym_id || !gyms.some((g) => g.id === e.gym_id)).sort(order);
  if (loose.length) byGym.push({ gym: null, items: loose });
  return { forExercise, favorites, byGym };
}

/** The quick-switch chips under the card's equipment: what's been used for it, then favorites (at most `max`). */
export function quickSwitch(data: EquipmentData, exerciseId: string | null | undefined, currentId: string | null, max = 4): Equipment[] {
  const s = pickerSections(data, exerciseId, null);
  const out: Equipment[] = [];
  for (const e of [...s.forExercise, ...s.favorites]) {
    if (e.id === currentId || out.some((o) => o.id === e.id)) continue;
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** The gym they're most likely in today: the one their latest pick is in. */
export function likelyGym(data: EquipmentData): string | null {
  let best: { at: number; gym: string | null } = { at: 0, gym: null };
  for (const e of data.equipment) {
    if (e.archived_at || !e.gym_id) continue;
    const at = time(e.last_used_at);
    if (at > best.at) best = { at, gym: e.gym_id };
  }
  return best.gym;
}

// ─────────────────────────── Setups typed into notes ───────────────────────────

const NOTE_LABELS: Array<[RegExp, string]> = [
  [/^j[- ]?hooks?$/i, "J-hooks"],
  [/^hooks?$/i, "J-hooks"],
  [/^rack(?: height)?$/i, "Rack height"],
  [/^safet(?:y|ies)(?: height)?$/i, "Safeties"],
  [/^pins?$/i, "Pins"],
  [/^seat(?: height)?$/i, "Seat"],
  [/^back ?pad$/i, "Back pad"],
  [/^pad$/i, "Pad"],
  [/^bench(?: angle)?$/i, "Bench"],
  [/^notch$/i, "Notch"],
  [/^hole$/i, "Hole"],
  [/^incline$/i, "Incline"],
  [/^speed$/i, "Speed"],
  [/^pulley(?: height)?$/i, "Pulley height"],
  [/^cable(?: height)?$/i, "Pulley height"],
  [/^handles?$/i, "Handles"],
  [/^foot ?plate$/i, "Foot plate"],
  [/^setting$/i, "Setting"],
];

const NOTE_PATTERN =
  /\b(j[- ]?hooks?|hooks?|rack(?: height)?|safet(?:y|ies)(?: height)?|pins?|seat(?: height)?|back ?pad|pad|bench(?: angle)?|notch|hole|incline|speed|pulley(?: height)?|cable height|handles?|foot ?plate|setting)\s*(?:at|on|is|=|:|#|height)?\s*(\d+(?:\.\d+)?)(?![\d.])(?!\s*(?:lbs?|kgs?|pounds?|kilos?)\b)(?:([a-z])\b)?/gi;

/**
 * Settings someone already typed into an exercise note ("Rack height 33",
 * "Do rack height 30 next time", "Incline 10, Speed 2.5"), offered as a
 * starting point for their first saved setup. A weight ("90lbs") is never a
 * setting. The last value for a label wins (a later "30" over an earlier "33").
 */
export function settingsFromNote(text: string | null | undefined): Setting[] {
  const src = String(text ?? "");
  const found = new Map<string, Setting>();
  for (const m of src.matchAll(NOTE_PATTERN)) {
    const raw = m[1].replace(/\s+/g, " ");
    const label = NOTE_LABELS.find(([re]) => re.test(raw))?.[1] ?? raw;
    found.set(label.toLowerCase(), { label, value: `${m[2]}${m[3] ?? ""}` });
  }
  return cleanSettings([...found.values()]);
}

/** Whether a note reads like a setup worth offering to save ("Rack 9"). */
export function noteLooksLikeSetup(text: string | null | undefined): boolean {
  return settingsFromNote(text).length > 0;
}
