/**
 * The Cardio tab's shapes, shared by the server (workspace / publish / Cleo) and
 * the screens, so nothing on a screen imports a server module (Nov 23 2026).
 */
import type { CardioWeekday } from "@/lib/cardio-prescription";
import type { CardioRead } from "@/lib/cardio/insights";
import type { CardioScoreContext } from "@/lib/cardio/quality";
import type { TargetRow } from "@/lib/cardio/publish";
import type { CardioPlan, PlanContext } from "@/lib/cardio/plan";
import type { VersionOutcome, VersionRow } from "@/lib/cardio/history";
import type { SpeedUnit } from "@/lib/weight-management/units";
import type { RecItem } from "@/lib/coaching-recommendation/consolidate";

export type CardioCompletion = {
  id: string;
  cardio_target_id: string | null;
  completed_date: string;
  completed: boolean | null;
  skipped: boolean | null;
  duration_minutes: number | null;
  cardio_type: string | null;
  incline: number | null;
  avg_speed: number | null;
  distance: number | null;
  distance_unit: string | null;
  calories: number | null;
  avg_heart_rate: number | null;
  rpe: number | null;
  completion_target: string | null;
};

export type CardioProposalRow = {
  id: string;
  created_at: string;
  instructions: string;
  answer: string | null;
  sessions: any;
  change_lines: string[];
  nutrition_note: string | null;
  status: "proposed" | "applied" | "dismissed" | "answered" | "failed";
  decided_at: string | null;
  decision_note: string | null;
  model: string | null;
  error: string | null;
};

export type CardioWorkspaceView = {
  /** The cardio workspace's tables exist (the migration is applied). */
  available: boolean;
  clientId: string;
  firstName: string;
  hasLogin: boolean;
  today: string;
  speedUnit: SpeedUnit;
  weightUnit: "kg" | "lb";
  ctx: PlanContext & { heavyLowerDays: CardioWeekday[] };
  rows: TargetRow[];
  live: CardioPlan;
  /** A change waiting for its date: the plan it starts, and what publishing again would take back. */
  pending: { effective: string; plan: CardioPlan; versionId: string | null; createdIds: string[]; closes: Array<{ id: string; prevEnd: string | null }> } | null;
  programs: Array<{ name: string; sessions: number }>;
  baseHash: string;
  draft: { plan: CardioPlan; effectiveDate: string | null; note: string | null; updatedAt: string; baseHash: string | null; stale: boolean } | null;
  versions: Array<VersionRow & { state: string; published_by: string | null; message_id: string | null; sessions: any }>;
  outcomes: VersionOutcome[];
  completions: CardioCompletion[];
  weighIns: Array<{ date: string; kg: number }>;
  read: CardioRead;
  scoreCtx: CardioScoreContext;
  proposals: CardioProposalRow[];
  /** The weight-management engine's call, in words, for the coach's context. */
  wmHeadline: string;
  /** The nutrition phase in force, if any. */
  phase: string | null;
};

export type CardioProposal = {
  id: string | null;
  answer: string;
  change: boolean;
  plan: CardioPlan | null;
  changeLines: string[];
  reasons: string[];
  nutritionNote: string | null;
  problems: Array<{ level: "error" | "warn"; text: string }>;
  confidence: "high" | "moderate" | "low";
  quality: { before: number | null; after: number | null };
  model: string;
};

export type PublishResult = {
  unchanged: boolean;
  versionId: string | null;
  versionNo: number | null;
  effective: string;
  scheduled: boolean;
  changeLines: string[];
  messaged: boolean;
  messageReason: string | null;
};

export type RecommendationRow = {
  id: string;
  client_id: string;
  checkin_id: string | null;
  headline: string;
  hold: boolean;
  items: RecItem[];
  status: "open" | "applied" | "edited" | "dismissed" | "superseded";
  coach_note: string | null;
  decided_at: string | null;
  created_at: string;
};
