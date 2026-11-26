/**
 * Athlete Intelligence (Nov 26 2026): what's known about an athlete from
 * information people upload or type (training logs, programs, meet results,
 * their coach's notes, warm-ups, attempt plans, cues), kept as checked facts
 * that each point back to their source, and fed into the competition
 * engines, the gameplan and Cleo. Pure shapes shared by the phone, the server
 * and the tests. Every load is kilograms once it's a fact (the unit it was
 * written in is kept beside it).
 */
import type { Lift } from "@/lib/competition/types";

export type { Lift };

/** Who the information originally came from (never who uploaded it: that's `uploaded_by`). */
export type Provider = "primary_coach" | "athlete" | "handler" | "other_coach" | "other" | "unknown";

/** What the information is for. A source can be several (`auto` = let Cleo decide). */
export type Purpose =
  | "program"
  | "logs"
  | "competition_history"
  | "coach_recommendations"
  | "warmups"
  | "attempts"
  | "technical"
  | "other";

export type SourceKind = "xlsx" | "csv" | "docx" | "pdf" | "image" | "video" | "text" | "manual";

export type SourceStatus =
  /** waiting for the file to arrive (an upload in progress) */
  | "uploading"
  /** queued for analysis */
  | "queued"
  /** being read (deterministic, then AI when it's needed) */
  | "reading"
  /** AI can't be used for this athlete yet: what could be read without it is in */
  | "waiting_consent"
  /** waiting on the AI provider (no attempt used) */
  | "waiting_ai"
  /** analyzed and incorporated */
  | "ready"
  /** kept for reference, nothing to read (a video) */
  | "stored"
  | "failed"
  /** a newer version replaced it */
  | "replaced"
  /** in Recently deleted (restorable for 30 days) */
  | "deleted";

export type FactKind =
  | "training"
  | "meet"
  | "attempt_plan"
  | "warmup"
  | "cue"
  | "technique"
  | "instruction"
  | "equipment"
  | "preference"
  | "bodyweight"
  | "risk"
  | "taper"
  | "note";

export type Completion = "completed" | "prescribed" | "unknown";
export type Standard = "competition" | "variation" | "unclear";
export type Unit = "kg" | "lb";
export type Confidence = "high" | "medium" | "low";

export type TrainingData = {
  exercise: string;
  standard: Standard;
  sets: number;
  reps: number;
  /** kg; null for a % prescription or a bodyweight movement */
  loadKg: number | null;
  /** as written, in its own unit */
  load: number | null;
  unit: Unit | null;
  pct: number | null;
  rpe: number | null;
  rir: number | null;
  completion: Completion;
  /** what was prescribed when the source shows both (completed sets keep their plan beside them) */
  planned?: { sets: number | null; reps: number | null; loadKg: number | null; rpe: number | null } | null;
  week?: number | null;
  day?: number | null;
  /** an undated row's position (sheet order) to date it later when a start date is known */
  order?: number | null;
};

export type MeetData = {
  name: string | null;
  federation: string | null;
  weightClass: string | null;
  bodyweightKg: number | null;
  squat: number | null;
  bench: number | null;
  deadlift: number | null;
  total: number | null;
  place: string | null;
  attempts: { s: Array<number | null>; b: Array<number | null>; d: Array<number | null> } | null;
};

export type AttemptPlanData = { opener: number | null; second: number | null; third: number | null };
export type WarmupData = { rows: Array<{ kg: number | null; pct: number | null; reps: number }> };
export type TextData = { text: string };
export type EquipmentData = {
  rackHeight?: string | null;
  safety?: string | null;
  footBlocks?: string | null;
  gear?: string[];
  text?: string | null;
};
export type BodyweightData = { kg: number };
export type RiskData = { text: string; place: string | null; status: "current" | "resolved" | "unknown" };

export type FactData =
  | TrainingData
  | MeetData
  | AttemptPlanData
  | WarmupData
  | TextData
  | EquipmentData
  | BodyweightData
  | RiskData;

/** A fact as a reader produces it, before it's stored. */
export type RawFact = {
  kind: FactKind;
  lift: Lift | null;
  /** the date it's about (a session, a meet, a note), yyyy-mm-dd */
  date: string | null;
  data: FactData;
  /** the words in the source it was read from (≤ 300) */
  quote: string | null;
  /** where in the source ("Sheet Week 9, row 14", "page 2") */
  location: string | null;
  confidence: Confidence;
  /** "meet": about this competition; "athlete": long-term */
  scope?: "meet" | "athlete";
  /** who the source says it's from, when it says (a "Coach notes" heading) */
  providerHint?: Provider | null;
};

export type FactStatus = "active" | "superseded" | "dismissed" | "outdated";
export type FactBasis = "source" | "coach" | "answer";

/** A stored fact (athlete_intel_facts). */
export type Fact = RawFact & {
  id: string;
  client_id: string;
  competition_id: string | null;
  source_id: string | null;
  provider: Provider;
  provider_name: string | null;
  basis: FactBasis;
  status: FactStatus;
  dedupe_key: string;
  /** the upload order (the source's created_at), for "the newer one wins" */
  received_at: string;
};

export type SourceRow = {
  id: string;
  client_id: string;
  competition_id: string | null;
  kind: SourceKind;
  file_name: string | null;
  provider: Provider;
  provider_name: string | null;
  purposes: Purpose[];
  detected_purposes: Purpose[];
  context: string | null;
  status: SourceStatus;
  error: string | null;
  summary: SourceSummary | null;
  created_at: string;
  updated_at: string;
  replaces_id: string | null;
  uploaded_by: string | null;
  via_link_id: string | null;
  bytes: number | null;
};

export type SourceSummary = {
  /** one line: what was read */
  line: string;
  counts: Partial<Record<FactKind, number>>;
  completedSets: number;
  prescribedSets: number;
  unknownSets: number;
  /** read with AI, without it, or only partly (AI not allowed yet) */
  method: "parsed" | "ai" | "both" | "none";
  notes: string[];
  /** the expected total before and after this source, when it moved it */
  impact?: { competitionId: string; before: number | null; after: number | null } | null;
  /** the same file was uploaded before: nothing was read twice */
  duplicateOf?: string | null;
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  primary_coach: "Primary coach",
  athlete: "Athlete",
  handler: "Me (handler)",
  other_coach: "Another coach",
  other: "Other",
  unknown: "Unknown",
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  program: "Training program",
  logs: "Completed training",
  competition_history: "Competition history",
  coach_recommendations: "Coach recommendations",
  warmups: "Warm-ups",
  attempts: "Attempt selection",
  technical: "Technical feedback",
  other: "Other",
};

export const PURPOSES = Object.keys(PURPOSE_LABEL) as Purpose[];
export const PROVIDERS = Object.keys(PROVIDER_LABEL) as Provider[];

export const KG_PER_LB = 0.45359237;
export const toKg = (v: number, unit: Unit) => (unit === "lb" ? Math.round(v * KG_PER_LB * 100) / 100 : v);
