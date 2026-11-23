/**
 * The cardio builder's kinds of cardio (Nov 23 2026): what each one is called,
 * how it's stored on `cardio_targets` (the historical `cardio_type` strings the
 * program sync, the client's cards and analytics already read), which settings
 * it takes, how much it costs the lower body, and a rough energy estimate.
 * Pure. Treadmill walking is the default for a new session: simple, low impact
 * and easy to progress one variable at a time (weight-management/treadmill.ts).
 */
import { walkingNetKcalPerMin } from "@/lib/weight-management/treadmill";

export type Modality =
  | "treadmill_flat"
  | "treadmill_incline"
  | "treadmill_variable"
  | "outdoor_walk"
  | "bike"
  | "elliptical"
  | "stair_climber"
  | "run"
  | "row"
  | "conditioning"
  | "custom";

/** What the session's fields are about, so the builder shows only what applies. */
export type ModalityField = "speed" | "incline" | "inclineMax" | "name";

/** How much a session costs the legs for lifting: eccentric load and impact. */
export type LowerBodyCost = "low" | "moderate" | "high";

export type ModalitySpec = {
  key: Modality;
  label: string;
  short: string;
  /** The `cardio_type` stored for it (legacy-compatible: the sync maps it to a library exercise). */
  storage: string;
  fields: ModalityField[];
  lowerBody: LowerBodyCost;
  walking: boolean;
  treadmill: boolean;
  /** METs at an easy-to-moderate effort, for the estimate when speed and incline don't apply. */
  mets: number;
  /** A starting point when the coach picks it. */
  defaults: { minutes: number; speedMph: number | null; incline: number | null; inclineMax: number | null; rpeMin: number; rpeMax: number };
};

export const MODALITIES: ModalitySpec[] = [
  {
    key: "treadmill_incline",
    label: "Incline treadmill walk",
    short: "Incline walk",
    storage: "Incline Treadmill Walk",
    fields: ["speed", "incline"],
    lowerBody: "low",
    walking: true,
    treadmill: true,
    mets: 5,
    defaults: { minutes: 20, speedMph: 3, incline: 6, inclineMax: null, rpeMin: 3, rpeMax: 5 },
  },
  {
    key: "treadmill_flat",
    label: "Flat treadmill walk",
    short: "Treadmill walk",
    storage: "Treadmill Walk",
    fields: ["speed"],
    lowerBody: "low",
    walking: true,
    treadmill: true,
    mets: 3.5,
    defaults: { minutes: 25, speedMph: 3.2, incline: 0, inclineMax: null, rpeMin: 3, rpeMax: 4 },
  },
  {
    key: "treadmill_variable",
    label: "Variable incline walk",
    short: "Variable incline",
    storage: "Variable Incline Treadmill Walk",
    fields: ["speed", "incline", "inclineMax"],
    lowerBody: "moderate",
    walking: true,
    treadmill: true,
    mets: 5.5,
    defaults: { minutes: 25, speedMph: 3, incline: 2, inclineMax: 8, rpeMin: 4, rpeMax: 6 },
  },
  {
    key: "outdoor_walk",
    label: "Outdoor walk",
    short: "Outdoor walk",
    storage: "Outdoor Walking",
    fields: [],
    lowerBody: "low",
    walking: true,
    treadmill: false,
    mets: 3.5,
    defaults: { minutes: 30, speedMph: null, incline: null, inclineMax: null, rpeMin: 3, rpeMax: 4 },
  },
  {
    key: "bike",
    label: "Stationary bike",
    short: "Bike",
    storage: "Bike",
    fields: [],
    lowerBody: "low",
    walking: false,
    treadmill: false,
    mets: 5.5,
    defaults: { minutes: 20, speedMph: null, incline: null, inclineMax: null, rpeMin: 4, rpeMax: 5 },
  },
  {
    key: "elliptical",
    label: "Elliptical",
    short: "Elliptical",
    storage: "Elliptical",
    fields: [],
    lowerBody: "low",
    walking: false,
    treadmill: false,
    mets: 5,
    defaults: { minutes: 20, speedMph: null, incline: null, inclineMax: null, rpeMin: 4, rpeMax: 5 },
  },
  {
    key: "stair_climber",
    label: "Stair climber",
    short: "Stairs",
    storage: "Stairmaster",
    fields: [],
    lowerBody: "moderate",
    walking: false,
    treadmill: false,
    mets: 8,
    defaults: { minutes: 15, speedMph: null, incline: null, inclineMax: null, rpeMin: 5, rpeMax: 6 },
  },
  {
    key: "run",
    label: "Running",
    short: "Run",
    storage: "Running",
    fields: ["speed"],
    lowerBody: "high",
    walking: false,
    treadmill: false,
    mets: 9,
    defaults: { minutes: 20, speedMph: null, incline: null, inclineMax: null, rpeMin: 4, rpeMax: 6 },
  },
  {
    key: "row",
    label: "Rowing",
    short: "Row",
    storage: "Rowing",
    fields: [],
    lowerBody: "moderate",
    walking: false,
    treadmill: false,
    mets: 6,
    defaults: { minutes: 15, speedMph: null, incline: null, inclineMax: null, rpeMin: 4, rpeMax: 6 },
  },
  {
    key: "conditioning",
    label: "Sport conditioning",
    short: "Conditioning",
    storage: "Conditioning",
    fields: ["name"],
    lowerBody: "high",
    walking: false,
    treadmill: false,
    mets: 8,
    defaults: { minutes: 15, speedMph: null, incline: null, inclineMax: null, rpeMin: 6, rpeMax: 8 },
  },
  {
    key: "custom",
    label: "Custom",
    short: "Custom",
    storage: "Custom",
    fields: ["name"],
    lowerBody: "moderate",
    walking: false,
    treadmill: false,
    mets: 5,
    defaults: { minutes: 20, speedMph: null, incline: null, inclineMax: null, rpeMin: 4, rpeMax: 5 },
  },
];

const BY_KEY = new Map(MODALITIES.map((m) => [m.key, m]));

export const DEFAULT_MODALITY: Modality = "treadmill_incline";

export function modalitySpec(key: Modality | string | null | undefined): ModalitySpec {
  return BY_KEY.get(key as Modality) ?? BY_KEY.get(DEFAULT_MODALITY)!;
}

export function isModality(v: unknown): v is Modality {
  return typeof v === "string" && BY_KEY.has(v as Modality);
}

/**
 * The kind of cardio a stored row is: its own `modality` when it has one, else read from the
 * historical `cardio_type` (and the coach's custom name). Never rewrites what's stored.
 */
export function modalityOf(row: { modality?: string | null; cardio_type?: string | null; custom_type?: string | null; incline?: number | null; incline_max?: number | null }): Modality {
  if (isModality(row.modality)) return row.modality;
  const t = `${row.cardio_type ?? ""} ${row.custom_type ?? ""}`.toLowerCase();
  if (/variable/.test(t)) return "treadmill_variable";
  if (/walk/.test(t)) {
    if (/outdoor|outside/.test(t)) return "outdoor_walk";
    if (/incline/.test(t) || Number(row.incline) > 1) return "treadmill_incline";
    if (/treadmill/.test(t)) return "treadmill_flat";
    return "outdoor_walk";
  }
  if (/treadmill/.test(t)) return Number(row.incline) > 1 ? "treadmill_incline" : "treadmill_flat";
  if (/incline/.test(t)) return "treadmill_incline";
  if (/(run|jog|sprint)/.test(t)) return "run";
  if (/(bike|cycl|spin|airbike|assault)/.test(t)) return "bike";
  if (/elliptical/.test(t)) return "elliptical";
  if (/(stair|stepper)/.test(t)) return "stair_climber";
  if (/(row|erg)/.test(t)) return "row";
  if (/(sled|conditioning|circuit|interval|hiit|sport)/.test(t)) return "conditioning";
  if (!t.trim()) return DEFAULT_MODALITY;
  return "custom";
}

/** METs from the Compendium for a run at a speed (mph), else the kind's easy-to-moderate value. */
function metsFor(spec: ModalitySpec, speedMph: number | null): number {
  if (spec.key === "run" && speedMph && speedMph > 0) {
    // ACSM running: VO2 (ml/kg/min) = 0.2 × m/min + 3.5
    const mpm = speedMph * 26.8224;
    return (0.2 * mpm + 3.5) / 3.5;
  }
  return spec.mets;
}

/**
 * Net kcal a minute (above resting) for a session: the ACSM walking equation for a walk with a
 * speed (and incline), else METs × bodyweight. An estimate, always labelled as one; null without
 * a bodyweight.
 */
export function netKcalPerMin(
  s: { modality: Modality; speedMph: number | null; incline: number | null; inclineMax: number | null },
  kg: number | null,
): number | null {
  if (!kg || kg <= 0) return null;
  const spec = modalitySpec(s.modality);
  if (spec.walking && s.speedMph && s.speedMph > 0) {
    const grade = s.inclineMax != null && s.incline != null ? (s.incline + s.inclineMax) / 2 : (s.incline ?? 0);
    return walkingNetKcalPerMin(s.speedMph, Math.max(0, grade), kg);
  }
  const mets = metsFor(spec, s.speedMph);
  return Math.max(0, ((mets - 1) * 3.5 * kg) / 200);
}

/** RPE as the words a client understands. */
export function rpeWords(min: number | null, max: number | null): string | null {
  const hi = max ?? min;
  if (hi == null) return null;
  if (hi <= 3) return "Easy: you could hold a full conversation";
  if (hi <= 5) return "Easy to moderate: you can still talk in full sentences";
  if (hi <= 7) return "Moderately hard: short sentences only";
  return "Hard: a few words at a time";
}
