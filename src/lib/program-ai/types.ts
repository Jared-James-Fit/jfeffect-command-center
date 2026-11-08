/**
 * Edit with AI: the program as the editor sees it (a client's current and
 * upcoming blocks, or a library template), with a short ref on every block,
 * week, workout and exercise ("B1W3D2E4") that the model uses instead of ids,
 * and the server maps back to the real records. Pure types.
 */

/** Why a workout can't be changed: trained / started (logged), or its date has passed. */
export type Lock = "trained" | "started" | "past" | null;

export type RowSnap = {
  id: string;
  ref: string;
  dayId: string;
  sortOrder: number;
  exerciseId: string | null;
  /** The library name (or the row's own name when it has no exercise). */
  name: string;
  nameOverride: string | null;
  sets: number | null;
  reps: string | null;
  rpe: string | null;
  rir: string | null;
  percentage: number | null;
  percentageBasis: string | null;
  loadKg: number | null;
  loadLb: number | null;
  loadUnit: string | null;
  manualOverride: boolean;
  restSeconds: number | null;
  restOverride: number | null;
  tempo: string | null;
  notes: string | null;
  timeProfile: string;
  purposeLabel: string | null;
  measurementType: string;
  trackingType: string;
  durationSeconds: number | null;
  /** A row the client's cardio plan writes (program_cardio_sync): never the editor's. */
  cardio: boolean;
  /** Concurrency: the row as the proposal saw it. */
  updatedAt: string | null;
  /** Template rows: the stored object, carried through untouched fields. */
  raw?: Record<string, unknown>;
};

export type DaySnap = {
  id: string;
  ref: string;
  weekId: string;
  dayIndex: number;
  title: string | null;
  subtitle: string | null;
  focus: string | null;
  /** Where it sits on the calendar (the scheduled instance when there is one). */
  date: string | null;
  lock: Lock;
  isCustom: boolean;
  updatedAt: string | null;
  rows: RowSnap[];
  raw?: Record<string, unknown>;
};

export type WeekSnap = {
  id: string;
  ref: string;
  blockId: string;
  weekIndex: number;
  start: string | null;
  end: string | null;
  phase: string | null;
  days: DaySnap[];
  raw?: Record<string, unknown>;
};

export type BlockSnap = {
  id: string;
  ref: string;
  name: string;
  status: string;
  visible: boolean;
  start: string | null;
  end: string | null;
  current: boolean;
  weeks: WeekSnap[];
  raw?: Record<string, unknown>;
};

export type ProgramSnapshot = {
  kind: "client" | "template";
  clientId: string | null;
  templateId: string | null;
  /** Client name or template name. */
  title: string;
  unit: "kg" | "lb";
  today: string;
  /** The client's committed training days (mon…sun). */
  trainingDays: string[];
  blocks: BlockSnap[];
  /** Templates: payload_revision the proposal read. */
  revision?: number | null;
  /** The athlete's session limit, when known (Goals & Setup, booked PT hour, a rule). */
  maxSessionMinutes?: number | null;
  /** Lifts with a max on file (percentages need one). */
  maxLifts?: string[];
  /** Locked days left out of the text the model reads (older finished weeks), said so. */
  omittedNote?: string | null;
};

export type CatalogExercise = {
  /** Short code the model writes ("X12"). */
  code: string;
  id: string;
  name: string;
  muscle: string | null;
  equipment: string | null;
  family: string | null;
  video: boolean;
  timeProfile: string;
  defaultRest: number | null;
  /** Below the exercise standard: why (shown, and a warning if picked). */
  standard: string | null;
};

export type Issue = { level: "error" | "warning"; text: string };

export type RowLine = { kind: "changed" | "swapped" | "added" | "removed" | "moved"; before: string | null; after: string | null };

export type DayDiff = {
  ref: string;
  label: string;
  kind: "changed" | "added" | "removed";
  minutesBefore: number | null;
  minutesAfter: number | null;
  rows: RowLine[];
  renamed?: { before: string; after: string } | null;
};

export type ResolvedChange = {
  id: string;
  title: string;
  why: string;
  basis: "requested" | "data" | "speculative";
  evidence: string[];
  ops: unknown[];
  issues: Issue[];
  /** Workouts it changes, in program order. */
  days: DayDiff[];
  schedule?: { before: string[]; after: string[] | null; redate: boolean } | null;
  /** Can it be applied (no errors and something to change)? */
  ok: boolean;
  touched: { workouts: number; exercises: number; weeks: string[] };
};
