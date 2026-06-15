/**
 * Program Assignment Planner — shared types.
 *
 * Phase 1 scope: types + helpers + dry-run server fn.
 *
 * Keys (used for cross-cutting selection + audit):
 *   - blockKey     : TemplateBlockV2.id (uuid or "legacy:<tpl>:<src>:<pos>")
 *   - weekKey      : `${blockKey}::w${weekIndex}`         (weekIndex zero-based)
 *   - dayKey       : `${weekKey}::d${dayIndex}`           (dayIndex zero-based)
 *   - exerciseKey  : `${dayKey}::e${exerciseIndex}`       (exerciseIndex zero-based)
 *
 * Keys are deterministic, so a saved selection survives reload as long as
 * the template payload is structurally unchanged.
 */

export type AssignmentMethod =
  | "client_days"
  | "entire_sequence"
  | "weekday_map"
  | "manual_dates"
  | "fill_empty"
  | "insert"
  | "replace_range";

export type PublishStatus = "draft" | "scheduled" | "published";

export interface PlannerSelection {
  /** Selected exercise keys (the most granular signal we store).
   *  block/week/day selection are derived in `selection.ts`. */
  exerciseKeys: string[];
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PlannerInput {
  clientId: string;
  templateId: string;
  selection: PlannerSelection;
  method: AssignmentMethod;
  startDate: string | null;          // ISO yyyy-mm-dd
  trainingDays: Weekday[];           // for weekday_map / fill_empty
  /** dayKey → ISO date for manual_dates mode. */
  manualDateMap?: Record<string, string>;
  /** [startISO, endISO] for replace_range. */
  replaceRange?: [string, string];
}

export interface PlannerPlacement {
  /** Stable template-day key being placed. */
  dayKey: string;
  blockKey: string;
  weekIndex: number;
  dayIndex: number;
  /** ISO date this day will land on, or null if no date could be assigned. */
  date: string | null;
  title: string;
  /** Exercise keys actually included for this day (after exercise filtering). */
  exerciseKeys: string[];
}

export type ConflictType =
  | "date_occupied"            // existing pl_day already scheduled on the same date
  | "block_overlap"            // existing client block overlaps the destination window
  | "completed_protected"      // destination date contains a completed workout
  | "duplicate_incoming"       // two placements landed on the same date
  | "locked_destination"       // destination workout is schedule_locked
  | "no_date";                 // placement could not be mapped to a date

export interface PlannerConflict {
  type: ConflictType;
  date: string | null;
  incoming: { dayKey: string; title: string };
  existing?: {
    dayId?: string;
    blockId?: string;
    label?: string;
    completed?: boolean;
    locked?: boolean;
  };
}

export type ConflictAction =
  | "keep_both"
  | "merge"
  | "replace_existing"
  | "move_existing"
  | "move_incoming"
  | "skip_incoming"
  | "review";

export interface ConflictDecision {
  action: ConflictAction;
  /** When moving incoming/existing, the new ISO date to apply. */
  newDate?: string;
}

export interface PlannerCoverage {
  /** ISO date through which this client has scheduled programming, or null. */
  programmedThrough: string | null;
  /** Whole future weeks programmed from today. */
  futureWeeks: number;
  /** Gap windows of consecutive empty days inside the next 12 weeks. */
  gaps: Array<{ start: string; end: string; days: number }>;
  workoutsThisMonth: number;
  drafts: number;
  published: number;
}

export interface PlannerSummary {
  blocks: number;
  weeks: number;
  days: number;
  exercises: number;
}

export interface PlannerPreview {
  placements: PlannerPlacement[];
  conflicts: PlannerConflict[];
  coverage: PlannerCoverage;
  summary: PlannerSummary;
  /** ISO date the last placement lands on, or null. */
  endDate: string | null;
  /** Stable identifier; the client sends it back on commit for idempotency. */
  idempotencyKey: string;
  /**
   * For method="client_days": the weekday list actually used and where it
   * came from (committed > available > preferred > none). Empty when N/A.
   */
  resolvedTrainingDays?: Weekday[];
  trainingDaysSource?:
    | "committed"
    | "available"
    | "preferred"
    | "manual"
    | "none";
}

export interface PlannerBatch {
  id: string;
  clientId: string;
  templateId: string;
  createdAt: string;
  publishStatus: PublishStatus;
  publishAt: string | null;
  publishedAt: string | null;
  workoutsAdded: number;
  workoutsMerged: number;
  workoutsReplaced: number;
  workoutsSkipped: number;
  workoutsMoved: number;
  undoneAt: string | null;
}