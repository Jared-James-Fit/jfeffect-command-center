/**
 * Program Intelligence: the records a report is built from (exactly as they
 * are in the database, nothing summarized) and the report the deterministic
 * engine makes of them (analyze.ts). No number in a report comes from an AI
 * model: the model only ever reads these.
 */

export type Unit = "kg" | "lb";
export type Lift = "squat" | "bench" | "deadlift";
export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

/** The coaching brain (programming framework) a report is read with. */
export type Brain = "powerlifting" | "bodybuilding" | "powerbuilding" | "general_strength" | "general_fitness" | "hybrid" | "other";
export const BRAINS: Brain[] = ["powerlifting", "bodybuilding", "powerbuilding", "general_strength", "general_fitness", "hybrid", "other"];
export const BRAIN_LABEL: Record<Brain, string> = {
  powerlifting: "Powerlifting",
  bodybuilding: "Bodybuilding / Hypertrophy",
  powerbuilding: "Powerbuilding",
  general_strength: "General strength",
  general_fitness: "General fitness",
  hybrid: "Hybrid / Athletic",
  other: "Other (goal-specific)",
};
/** Brains that read squat, bench and deadlift lift by lift. */
export const STRENGTH_BRAINS: Brain[] = ["powerlifting", "powerbuilding", "general_strength"];
/** Brains that read hard sets per muscle group. */
export const HYPERTROPHY_BRAINS: Brain[] = ["bodybuilding", "powerbuilding"];

/** Which records a report covers. "program" is the current program (its blocks), resolved by the loader. */
export type IntelScopeRequest =
  | { kind: "program" }
  | { kind: "blocks"; blockIds: string[] }
  | { kind: "dates"; from: string; to: string }
  | { kind: "history" };

export type IntelScope = {
  kind: IntelScopeRequest["kind"];
  label: string;
  /** yyyy-mm-dd bounds of the workouts in scope (null = open). */
  from: string | null;
  to: string | null;
  blockIds: string[];
};

// ── Raw records (column names as in the database) ─────────────────────────

export type RawClient = {
  id: string;
  full_name: string | null;
  preferred_weight_unit: string | null;
  timezone: string | null;
  sex: string | null;
  birth_date?: string | null;
  coach_notes: string | null;
  goals: string | null;
  injuries: string | null;
  training_notes: string | null;
  lifestyle_notes: string | null;
  date_of_birth?: string | null;
  height_cm?: number | null;
  committed_training_days?: string[] | null;
  committed_training_frequency?: number | null;
  preferred_training_days?: string[] | null;
  available_training_days?: string[] | null;
  schedule_notes?: string | null;
  schedule_updated_at?: string | null;
  preferred_training_time?: string | null;
  is_powerlifter?: boolean | null;
  intake_training_experience?: string | null;
  intake_injuries?: string | null;
  bodyweight_goal_type?: string | null;
  bodyweight_goal_value?: number | null;
  bodyweight_goal_unit?: string | null;
  program_phase?: string | null;
};

export type RawGoals = {
  main_goal: string | null;
  main_goal_other: string | null;
  goal_target: string | null;
  training_days_per_week: number | null;
  workout_length_minutes: number | null;
  training_experience: string | null;
  training_styles: string[] | null;
  training_location: string | null;
  equipment: string[] | null;
  injuries_has: boolean | null;
  injuries_details: string | null;
  final_notes: string | null;
  available_weekdays?: string[] | null;
  equipment_by_location?: unknown;
  updated_at?: string | null;
  completed_at?: string | null;
  last_reviewed_at?: string | null;
};

export type RawPrep = {
  id: string;
  title: string | null;
  goal_type: string | null;
  event_name: string | null;
  event_date: string | null;
  federation: string | null;
  weight_class: string | null;
  division: string | null;
  status: string | null;
  coach_notes: string | null;
};

export type RawBlock = {
  id: string;
  prep_id: string | null;
  name: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  training_focus: string | null;
  goal: string | null;
  coach_notes: string | null;
  client_visible: boolean | null;
  archived: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  source_template_block_key?: string | null;
};

export type RawWeek = {
  id: string;
  block_id: string;
  week_index: number;
  start_date: string | null;
  end_date: string | null;
  phase: string | null;
  notes: string | null;
};

export type RawDay = {
  id: string;
  week_id: string;
  day_index: number;
  title: string | null;
  focus: string | null;
  notes: string | null;
  scheduled_date: string | null;
};

export type RawRow = {
  id: string;
  day_id: string;
  sort_order: number | null;
  exercise_id: string | null;
  exercise_name_override: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  percentage: number | null;
  percentage_basis: string | null;
  load_kg: number | null;
  load_lb: number | null;
  load_unit: string | null;
  tempo: string | null;
  rest_seconds: number | null;
  notes: string | null;
  purpose_label: string | null;
  measurement_type: string | null;
  duration_seconds: number | null;
  intensity_techniques: string[] | null;
  progression_method: string | null;
};

/** pl_exercise_blocks: a row's set structure (top set, back-offs, ...) when the coach used one. */
export type RawSetBlock = {
  id: string;
  row_id: string;
  sort_order: number | null;
  block_type: string | null;
  label: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  load_type: string | null;
  load_value: number | null;
  load_unit: string | null;
  amrap: boolean | null;
  notes: string | null;
};

export type RawResult = {
  id: string;
  row_id: string;
  set_index: number;
  actual_load: number | null;
  actual_load_unit: string | null;
  normalized_kg: number | null;
  actual_load_kg: number | null;
  actual_reps: number | null;
  actual_rpe: string | null;
  actual_rpe_num: number | null;
  actual_rir: string | null;
  is_working_set: boolean | null;
  is_bodyweight: boolean | null;
  load_type: string | null;
  completed_at: string | null;
  completed_duration_seconds: number | null;
  notes: string | null;
  mean_concentric_velocity_mps?: number | null;
};

export type RawWarmup = { id: string; row_id: string; load: number | null; reps: number | null; rpe: number | null; unit: string | null };

export type RawCompletion = {
  id: string;
  day_id: string;
  completed_at: string | null;
  started_at: string | null;
  actual_duration_min: number | null;
  logging_percentage: number | null;
  session_rating: number | null;
  skipped_exercises_count: number | null;
  client_notes: string | null;
};

export type RawFeedback = {
  id: string;
  day_id: string | null;
  completion_id: string | null;
  created_at: string | null;
  session_rpe: number | null;
  overall_rating: number | null;
  strength_feel: string | null;
  fatigue_feel: string | null;
  hit_target: string | null;
  recovery_today: number | null;
  sleep_bucket: string | null;
  pain: boolean | null;
  pain_area: string | null;
  pain_level: number | null;
  pain_note: string | null;
  client_note: string | null;
  review_version: number | null;
};

export type RawExerciseNote = { id: string; row_id: string | null; day_id: string | null; exercise_id: string | null; exercise_name: string | null; content: string | null; created_at: string | null };

export type RawExercise = {
  id: string;
  name: string;
  primary_muscle_group: string | null;
  muscle_groups: string[] | null;
  secondary_muscle_groups: string[] | null;
  movement_family: string | null;
  is_competition_lift: boolean | null;
  competition_lift_type: string | null;
  exercise_category: string | null;
  variation_type: string | null;
  counts_toward_volume: boolean | null;
  volume_multiplier: number | null;
  has_video?: boolean;
  equipment?: string | null;
};

export type RawMax = { lift: string | null; exercise_id: string | null; one_rm: number | null; training_max: number | null; estimated_1rm: number | null; unit: string | null; tested_at: string | null; source: string | null; active: boolean | null };
export type RawMeet = { meet_date: string | null; meet_name: string | null; bodyweight_kg: number | null; squat_kg: number | null; bench_kg: number | null; deadlift_kg: number | null; total_kg: number | null; federation: string | null; weight_class_kg: string | null };
export type RawBodyweight = { date: string; kg: number };
export type RawRoadmapNote = { block_id: string; week_id: string | null; ai_style: string | null; ai_label: string | null; coach_label: string | null; coach_summary: string | null; hidden: boolean | null };
export type RawFileNote = { id: string; title: string | null; body: string | null; pinned: boolean | null; created_at: string | null };
/** A submitted form (weekly check-in, nutrition update, ...) with its answered questions in form order. */
export type RawCheckin = { id: string; form: string | null; submitted_at: string | null; period_start: string | null; answers: Array<{ q: string; a: string }> };

/** What a coach set for this client in Program Intelligence (persisted). */
export type EquipmentItem =
  | "barbell"
  | "rack"
  | "bench"
  | "adjustable_bench"
  | "dumbbells"
  | "adjustable_dumbbells"
  | "cable_high"
  | "cable_low"
  | "landmine"
  | "machines"
  | "leg_press"
  | "hack_squat"
  | "smith"
  | "leg_extension"
  | "leg_curl"
  | "lat_pulldown"
  | "seated_row"
  | "hip_thrust_machine"
  | "pullup_bar"
  | "dip_station"
  | "bands"
  | "kettlebells"
  | "trap_bar"
  | "belt_squat"
  | "sled"
  | "cardio";
export type EquipmentProfile = {
  location: string | null;
  items: EquipmentItem[];
  /** cable columns (each with a high and a low position) */
  cableStations: number | null;
  space: string | null;
  notes: string | null;
  confirmedAt?: string | null;
};
export type RawIntelProfile = { brain_override: string | null; equipment_profile: EquipmentProfile | null; updated_at?: string | null };

/** Stored athlete observations (memory across programs): what the coach approved, corrected or rejected. */
export type ObservationStatus = "proposed" | "approved" | "corrected" | "rejected";
export type ObservationKind = "observation" | "decision" | "outcome";
export type RawObservation = {
  id: string;
  kind: ObservationKind;
  category: string | null;
  statement: string;
  corrected_statement: string | null;
  confidence: "fact" | "hypothesis";
  status: ObservationStatus;
  source: "analysis" | "ai" | "coach";
  evidence: unknown;
  block_id: string | null;
  decision_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  finding_key?: string | null;
  job_id?: string | null;
};

export type IntelSettings = {
  e1rmFormula: "epley" | "brzycki";
  workingRpeMin: number;
  muscleTargets: Record<string, { mev?: number; mav?: number; mrv?: number }>;
};

/** A booked PT session's time (pt_sessions), for how long the hour they train in is. */
export type RawPtSession = { starts_at: string | null; ends_at: string | null; status: string | null };

export type IntelRecords = {
  client: RawClient;
  goals: RawGoals | null;
  preps: RawPrep[];
  blocks: RawBlock[];
  weeks: RawWeek[];
  days: RawDay[];
  rows: RawRow[];
  setBlocks: RawSetBlock[];
  results: RawResult[];
  warmups: RawWarmup[];
  completions: RawCompletion[];
  feedback: RawFeedback[];
  exerciseNotes: RawExerciseNote[];
  exercises: RawExercise[];
  maxes: RawMax[];
  meets: RawMeet[];
  bodyweight: RawBodyweight[];
  roadmapNotes: RawRoadmapNote[];
  fileNotes: RawFileNote[];
  observations: RawObservation[];
  /** Submitted forms (check-ins) in the period, answers as text. */
  checkins?: RawCheckin[];
  /** Program Intelligence settings the coach saved for this client. */
  profile?: RawIntelProfile | null;
  /** The client's cardio plan (cardio_targets) and the last weeks of its log. */
  cardioTargets?: import("./cardio").RawCardioTarget[];
  cardioCompletions?: import("./cardio").RawCardioCompletion[];
  /** Their booked PT sessions, 8 weeks back to 4 ahead: the hour they train in, when they train with the coach. */
  ptSessions?: RawPtSession[];
  settings: IntelSettings;
  scope: IntelScope;
  /** yyyy-mm-dd "today" in the athlete's time zone. */
  today: string;
  loadedAt: string;
  /** Anything a read was refused or failed for (named, never silently dropped). */
  unreadable: string[];
};

// ── Report ─────────────────────────────────────────────────────────────────

/** Where a finding comes from: plain facts measured from records, hypotheses that interpret them, or a gap. */
export type FindingKind = "fact" | "hypothesis" | "missing";
export type FindingArea = "improved" | "stalled" | "change" | "next" | "missing";
export type Finding = {
  id: string;
  area: FindingArea;
  kind: FindingKind;
  /** squat / bench / deadlift, a muscle, an exercise name, "adherence", "recovery" ... */
  subject: string;
  title: string;
  detail: string;
  /** Records it rests on, human-readable ("Competition Squat · 2026-10-14 · 150kg×3 @8"). */
  evidence: string[];
};

export type SetLine = {
  resultId: string;
  setIndex: number;
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  e1rm: number | null;
  /** counts toward a prescribed set: logged, not a warm-up, reps (or time) recorded. Effort doesn't decide this. */
  done: boolean;
  /** used for volume and strength reads: done and at or above the working-set effort floor (when an effort was logged) */
  working: boolean;
  hard: boolean;
  /** mean concentric velocity (m/s) when logged */
  velocity: number | null;
  loadType: "external" | "bodyweight" | "assisted";
  logged: boolean;
  completedAt: string | null;
  notes: string | null;
};

/** One prescribed exercise on one day and what was actually done. */
export type RowCompare = {
  rowId: string;
  dayId: string;
  exerciseId: string | null;
  exercise: string;
  lift: Lift | null;
  competition: boolean;
  role: string | null;
  prescribed: {
    sets: number | null;
    reps: string | null;
    repRange: [number, number] | null;
    rpe: string | null;
    rpeRange: [number, number] | null;
    rir: string | null;
    percentage: number | null;
    loadKg: number | null;
    tempo: string | null;
    restSeconds: number | null;
    notes: string | null;
    setBlocks: Array<{ type: string | null; sets: number | null; reps: string | null; rpe: string | null; load: string | null }>;
  };
  actual: SetLine[];
  warmups: number;
  status: "done" | "partial" | "skipped" | "upcoming" | "unscheduled";
  /** sets that count toward the prescription (see SetLine.done), all of them */
  setsDone: number;
  workingSetsDone: number;
  repsHitPct: number | null;
  rpeDelta: number | null;
  loadDeltaKg: number | null;
  bestE1rm: number | null;
  topSet: SetLine | null;
  clientNotes: string[];
};

export type DayStatus = "completed" | "partial" | "missed" | "upcoming" | "unscheduled";
export type DayCompare = {
  dayId: string;
  weekKey: string;
  title: string;
  dayIndex: number;
  date: string | null;
  status: DayStatus;
  rows: RowCompare[];
  durationMin: number | null;
  sessionRating: number | null;
  clientNotes: string | null;
  feedback: RawFeedback | null;
};

export type LiftWeek = { sets: number; reps: number; tonnageKg: number; topE1rm: number | null; sessions: number; avgRpe: number | null };

export type WeekMetrics = {
  key: string;
  blockId: string;
  blockName: string;
  blockNumber: number;
  weekIndex: number;
  label: string;
  phase: string | null;
  start: string | null;
  end: string | null;
  plannedDays: number;
  dueDays: number;
  completedDays: number;
  partialDays: number;
  missedDays: number;
  upcomingDays: number;
  prescribedSetsDue: number;
  /** prescribed sets completed: per exercise, sets done up to the prescribed count */
  completedSets: number;
  workingSetsLogged: number;
  hardSets: number;
  setAdherencePct: number | null;
  sessionAdherencePct: number | null;
  tonnageKg: number;
  avgRpe: number | null;
  avgRpeDelta: number | null;
  hardSetsByMuscle: Record<string, number>;
  lifts: Record<Lift, LiftWeek>;
  sessionRpe: number | null;
  painReports: number;
};

export type Exposure = {
  date: string | null;
  dayId: string;
  weekKey: string;
  exerciseId: string | null;
  exercise: string;
  competition: boolean;
  topSet: SetLine | null;
  e1rm: number | null;
  workingSets: number;
  backoffSets: number;
  avgRpe: number | null;
  prescribedRpe: string | null;
};

export type TrendStat = {
  first: number | null;
  last: number | null;
  peak: number | null;
  changePct: number | null;
  /** least-squares slope, kg per week */
  slopePerWeek: number | null;
  points: Array<{ date: string; value: number }>;
};

export type LiftReport = {
  lift: Lift;
  competitionExercise: string | null;
  exposures: Exposure[];
  compTrend: TrendStat;
  allTrend: TrendStat;
  frequencyPerWeek: number | null;
  setsPerWeek: number | null;
  repsPerWeek: number | null;
  tonnagePerWeekKg: number | null;
  avgRelativeIntensityPct: number | null;
  rpeBuckets: { easy: number; moderate: number; hard: number; unknown: number };
  repBuckets: { r1_3: number; r4_6: number; r7_10: number; r11p: number };
  avgRpeDelta: number | null;
  heavySingles: number;
  backoffCompletionPct: number | null;
  variations: Array<{ exercise: string; exerciseId: string | null; exposures: number; trend: TrendStat; weeks: string[]; compChangeDuringPct: number | null }>;
  stalled: boolean;
  maxOnFileKg: number | null;
  bestMeetKg: number | null;
};

export type MuscleReport = {
  muscle: string;
  avgHardSetsPerWeek: number | null;
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  frequencyPerWeek: number | null;
  exercises: string[];
  target: { mev?: number; mav?: number; mrv?: number } | null;
  status: "below" | "within" | "above" | "no_target";
  weekly: Array<{ weekKey: string; sets: number }>;
};

export type ExerciseReport = {
  key: string;
  exerciseId: string | null;
  name: string;
  lift: Lift | null;
  competition: boolean;
  muscles: string[];
  exposures: number;
  setsPrescribedDue: number;
  workingSetsLogged: number;
  adherencePct: number | null;
  trend: TrendStat;
  bestSet: SetLine | null;
  repsTrend: { first: number | null; last: number | null } | null;
  avgRpe: number | null;
  stalled: boolean;
  lastDate: string | null;
  blocks: string[];
  notes: number;
};

export type BlockReport = {
  blockId: string;
  number: number;
  name: string;
  status: string | null;
  start: string | null;
  end: string | null;
  focus: string | null;
  goal: string | null;
  weeks: number;
  sessionAdherencePct: number | null;
  setAdherencePct: number | null;
  avgHardSetsPerWeek: number | null;
  avgRpe: number | null;
  avgRpeDelta: number | null;
  liftChange: Record<Lift, { fromKg: number | null; toKg: number | null; changePct: number | null }>;
  topMuscles: Array<{ muscle: string; setsPerWeek: number }>;
  painReports: number;
  hidden: boolean;
  archived: boolean;
};

export type Coverage = {
  blocks: number;
  weeks: number;
  plannedDays: number;
  dueDays: number;
  completedDays: number;
  partialDays: number;
  missedDays: number;
  upcomingDays: number;
  unscheduledDays: number;
  prescribedRows: number;
  prescribedSetsDue: number;
  /** prescribed sets completed on due workouts (per exercise, capped at what was prescribed) */
  completedSets: number;
  /** sets done beyond the prescription (extra sets) */
  extraSets: number;
  /** prescribed sets of exercises with nothing logged on a due workout */
  skippedSets: number;
  /** prescribed sets missing from exercises that were partly done */
  incompleteSets: number;
  /** done sets outside the prescribed rep range */
  modifiedSets: number;
  /** every logged set record (incl. warm-ups and records without reps) */
  loggedSets: number;
  /** logged records that don't count as a set (flagged warm-up, or no reps / time) */
  nonCountedRecords: number;
  workingSets: number;
  warmupSets: number;
  setsWithLoad: number;
  setsWithRpe: number;
  /** of the sets that count, the share with an RPE or RIR logged */
  setsWithRpePct: number | null;
  setsWithoutRpePct: number | null;
  setsWithVelocity: number;
  unmappedRows: number;
  feedbackEntries: number;
  exerciseNotes: number;
  coachNotes: number;
  bodyweightEntries: number;
  maxesOnFile: number;
  meetResults: number;
  firstDate: string | null;
  lastDate: string | null;
  unreadable: string[];
};

export type Classification = {
  auto: Brain;
  scores: { powerlifting: number; bodybuilding: number; strength?: number; general?: number; hybrid?: number };
  reasons: string[];
};

export type IntelReport = {
  version: number;
  generatedAt: string;
  dataHash: string;
  client: { id: string; name: string; unit: Unit };
  scope: IntelScope;
  brain: Brain;
  brainSource: "auto" | "override";
  classification: Classification;
  coverage: Coverage;
  days: DayCompare[];
  weeks: WeekMetrics[];
  lifts: LiftReport[];
  muscles: MuscleReport[];
  exercises: ExerciseReport[];
  blocks: BlockReport[];
  recovery: {
    sessionRpeAvg: number | null;
    ratingAvg: number | null;
    painReports: Array<{ date: string | null; area: string | null; level: number | null; note: string | null }>;
    fatigue: Record<string, number>;
    sleep: Record<string, number>;
  };
  bodyweight: { first: number | null; last: number | null; changeKg: number | null; entries: number };
  findings: Finding[];
};
