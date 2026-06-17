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
}

export class NotImplemented extends Error {
  constructor(method: string, kind: WorkoutContextKind) {
    super(`workout-context adapter (${kind}) does not yet implement ${method}; will be filled in Phase 2`);
    this.name = "NotImplemented";
  }
}