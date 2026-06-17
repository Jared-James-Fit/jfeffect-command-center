/**
 * Workout Context Adapter — shared type surface.
 *
 * Phase 1 of the unified workout experience. Defines the contract every
 * shared workout component will eventually call. Concrete adapters
 * (`client-adapter.ts`, `member-adapter.ts`) implement this interface on
 * top of the existing `pl_*` and `member_*` tables respectively. No data
 * migration — both backends stay where they are.
 *
 * Phase 1 only introduces the types and skeleton implementations. Later
 * phases progressively migrate components onto this surface.
 */

export type WorkoutContextKind = "client" | "member";

/** Stable reference to a single training program assignment. */
export interface WorkoutContextRef {
  kind: WorkoutContextKind;
  /** Auth user id of the trainee. */
  userId: string;
  /** For `client` kind: the `clients.id` row. For `member` kind: the auth user id. */
  ownerId: string;
  /** For `member` kind: the enrollment id. Undefined for clients. */
  enrollmentId?: string;
}

/** A single calendar-placed workout day, in display order. */
export interface WorkoutScheduleDay {
  /** Stable id used as React key + reschedule target. */
  id: string;
  date: string; // yyyy-MM-dd, local
  week: number;
  day: number;
  title: string | null;
  blockId: string | null;
  blockName: string | null;
  completed: boolean;
  completedAt: string | null;
}

/** Single completion row, history-tab friendly. */
export interface WorkoutCompletion {
  id: string;
  dayId: string;
  week: number;
  day: number;
  completedAt: string;
}

export type RescheduleScope =
  | "this_workout_only"
  | "this_week_only"
  | "all_future_weeks"
  | "entire_schedule";

export interface RescheduleInput {
  dayId: string;
  /** New target date (yyyy-MM-dd, local). */
  newDate: string;
  scope: RescheduleScope;
}

export interface LogSetInput {
  dayId: string;
  rowId: string;
  setIndex: number;
  reps?: number | null;
  loadLb?: number | null;
  rpe?: number | null;
  rir?: number | null;
  isWorkingSet?: boolean | null;
  notes?: string | null;
  completedDurationSeconds?: number | null;
}

/**
 * Capability flags surfaced to the UI so shared components can hide
 * coaching-only or membership-only controls without branching by kind.
 */
export interface WorkoutContextCapabilities {
  /** Can the viewer edit the master program template? Always false in workout UI. */
  canEditTemplate: false;
  /** Can the viewer edit their own logged sets? */
  canEditOwnLogs: boolean;
  /** Can the viewer reschedule their own days? */
  canReschedule: boolean;
  /** Can the viewer swap an exercise for an alternate? */
  canSubstituteExercise: boolean;
  /** Coach-only annotations / pain flags. */
  canSeeCoachNotes: boolean;
  /** Coach-only intel: pain flags, risk widgets, coach analytics in the day view. */
  canSeeCoachIntel: boolean;
  /** Can the viewer leave coach feedback on this trainee's workout? */
  canLeaveCoachFeedback: boolean;
  /** Admin-only operational notes attached to the day. */
  canSeeAdminNotes: boolean;
  /** Can the viewer assign programs to other users from this view? Always false here. */
  canAssignPrograms: false;
}

/* -------------------------------------------------------------------------- */
/* Day-view DTOs                                                              */
/* -------------------------------------------------------------------------- */

export interface WorkoutDay {
  id: string;
  week: number;
  day: number;
  title: string | null;
  focus: string | null;
  targetMinutes: number | null;
  blockId: string | null;
  blockName: string | null;
  scheduledDate: string | null;
}

export interface ExerciseRowDTO {
  id: string;                 // adapter-stable row id
  exerciseId: string | null;
  exerciseName: string;
  videoUrl: string | null;
  vimeoEmbedUrl?: string | null;
  thumbnailUrl?: string | null;
  muscleGroup?: string | null;
  category?: string | null;
  cues?: string | null;
  commonMistakes?: string | null;
  sortOrder: number;
  targetSets: number | null;
  targetReps: string | null;
  targetEffort: string | null;       // RPE/RIR target text
  targetLoadText: string | null;
  restSeconds: number | null;
  notes: string | null;              // template-level notes
  warmupProtocolId?: string | null;
  defaultLoadUnit?: string | null;
  blockGroupId?: string | null;      // for grouped/superset display
  raw?: unknown;                     // adapter-specific passthrough
}

export interface RowResultDTO {
  id: string;
  rowId: string;
  setIndex: number;
  reps: number | null;
  loadLb: number | null;
  actualLoadUnit: string | null;
  rpe: number | null;
  rir: number | null;
  isWorkingSet: boolean | null;
  notes: string | null;
  completedDurationSeconds: number | null;
  loggedAt: string | null;
}

export interface ExerciseNoteDTO {
  id: string;
  rowId: string | null;
  exerciseId: string | null;
  note: string;
  createdAt: string;
  authorRole: "trainee" | "coach";
}

export interface HistoryEntryDTO {
  date: string;
  setIndex: number;
  reps: number | null;
  loadLb: number | null;
  rpe: number | null;
}

export interface MaxEntryDTO {
  exerciseId: string;
  oneRmLb: number | null;
  estimated: boolean;
}

export interface DayCompletionDTO {
  id: string | null;
  startedAt: string | null;
  inProgressAt: string | null;
  completedAt: string | null;
  notes: string | null;
  actualMinutes: number | null;
}

export interface DayCompletionPatch {
  startedAt?: string | null;
  inProgressAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
  actualMinutes?: number | null;
  /**
   * Heartbeat-derived active engagement time. Currently only consumed by
   * the member adapter (writes to `member_workout_completions.active_duration_seconds`).
   * Other adapters ignore it.
   */
  activeDurationSeconds?: number | null;
}

export interface UpsertRowResultInput {
  id?: string | null;
  rowId: string;
  setIndex: number;
  reps?: number | null;
  loadLb?: number | null;
  actualLoadUnit?: string | null;
  rpe?: number | null;
  rir?: number | null;
  isWorkingSet?: boolean | null;
  notes?: string | null;
  completedDurationSeconds?: number | null;
}

export interface UpsertExerciseNoteInput {
  id?: string | null;
  rowId?: string | null;
  exerciseId?: string | null;
  note: string;
}

export interface RowBlockSummaryDTO {
  rowId: string;
  blockId: string | null;
  summary: string | null;
}

export interface CoachPainFlagDTO {
  id: string;
  rowId: string | null;
  severity: "low" | "medium" | "high";
  note: string | null;
  createdAt: string;
}

export interface WorkoutContextAdapter {
  kind: WorkoutContextKind;
  ref: WorkoutContextRef;
  capabilities: WorkoutContextCapabilities;

  /** Implemented progressively in Phase 2+. Throws `NotImplemented` until then. */
  listSchedule(opts?: { fromDate?: string; toDate?: string }): Promise<WorkoutScheduleDay[]>;
  listCompletions(opts?: { limit?: number }): Promise<WorkoutCompletion[]>;
  reschedule(input: RescheduleInput): Promise<void>;
  logSet(input: LogSetInput): Promise<void>;
  completeDay(dayId: string): Promise<void>;

  /* ---- day-view surface (Phase B+) ---- */
  getDay(dayId: string): Promise<WorkoutDay>;
  listRows(dayId: string): Promise<ExerciseRowDTO[]>;
  listRowResults(dayId: string): Promise<RowResultDTO[]>;
  listExerciseNotes(dayId: string): Promise<ExerciseNoteDTO[]>;
  listExerciseHistory(exerciseId: string, opts?: { limit?: number }): Promise<HistoryEntryDTO[]>;
  listClientMaxes(): Promise<MaxEntryDTO[]>;
  getDayCompletion(dayId: string): Promise<DayCompletionDTO | null>;
  getRowBlockSummaries(rowIds: string[]): Promise<RowBlockSummaryDTO[]>;
  listCoachPainFlags(dayId: string): Promise<CoachPainFlagDTO[]>;

  upsertRowResult(input: UpsertRowResultInput): Promise<string>;
  deleteRowResult(id: string): Promise<void>;
  upsertExerciseNote(input: UpsertExerciseNoteInput): Promise<void>;
  updateDayCompletion(dayId: string, patch: DayCompletionPatch): Promise<void>;
  saveExerciseUnitPref(input: { exerciseId: string; unit: "lb" | "kg" }): Promise<void>;
  notifyCoachOfFailure(input: { dayId: string; reason: string }): Promise<void>;
}

export class NotImplemented extends Error {
  constructor(method: string, kind: WorkoutContextKind) {
    super(`workout-context adapter (${kind}) does not yet implement ${method}; will be filled in Phase 2`);
    this.name = "NotImplemented";
  }
}