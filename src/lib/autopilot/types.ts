/**
 * Cleo Autopilot's shapes (Nov 25 2026). One weekly assessment per coaching
 * client, built from the reads that already exist (weight management's
 * `decide`, cardio's recovery read, the coordinated check-in recommendation,
 * the program and pain reads); see docs/CLEO_AUTOPILOT.md.
 */
import type { CardioStep } from "@/lib/weight-management/treadmill";

export type Domain = "training" | "nutrition" | "cardio";
export const DOMAINS: readonly Domain[] = ["training", "nutrition", "cardio"] as const;
export const DOMAIN_WORD: Record<Domain, string> = { training: "Training", nutrition: "Nutrition", cardio: "Cardio" };

export type Category = "maintain" | "optimize" | "accelerate" | "extend" | "intervene" | "investigate";
export const CATEGORY_LABEL: Record<Category, string> = {
  maintain: "Maintain",
  optimize: "Optimize",
  accelerate: "Accelerate",
  extend: "Extend",
  intervene: "Intervene",
  investigate: "Investigate",
};

/** Where a decision sits on the coach's exception dashboard. */
export type Bucket = "requires_attention" | "awaiting_approval" | "auto_updated" | "missing_info" | "on_track";
export const BUCKETS: readonly Bucket[] = ["requires_attention", "awaiting_approval", "auto_updated", "missing_info", "on_track"] as const;
export const BUCKET_LABEL: Record<Bucket, string> = {
  requires_attention: "Requires attention",
  awaiting_approval: "Awaiting approval",
  auto_updated: "Automatically updated",
  missing_info: "Missing information",
  on_track: "On track",
};

/** Why a decision always goes to the coach, whatever the autonomy settings say. */
export type ProtectedReason = "injury" | "medical" | "unsafe_weight" | "restructure" | "competition" | "coach_draft";
export const PROTECTED_WORD: Record<ProtectedReason, string> = {
  injury: "Pain or injury",
  medical: "A health concern",
  unsafe_weight: "Weight target needs a safer plan",
  restructure: "A bigger program change",
  competition: "Close to a competition",
  coach_draft: "Your own draft is in progress",
};
export type Protection = { reason: ProtectedReason; domain: Domain | "overall"; text: string };

export type EvidenceItem = { domain: Domain | "overall"; text: string; source: "measured" | "reported" | "estimated" };

export type Mode = "draft" | "smart" | "advanced";
export const MODE_LABEL: Record<Mode, string> = { draft: "Draft Only", smart: "Smart Autopilot", advanced: "Advanced" };

export type DomainDecision = {
  domain: Domain;
  /** hold: nothing changes; propose: a change becomes a draft; review: the coach looks first (no draft). */
  change: "hold" | "propose" | "review";
  summary: string;
  /** The words a builder's draft is written from (Edit with AI, Change it with AI, Cleo — Cardio). */
  instruction: string | null;
  reason: string;
  size: "small" | "large" | null;
  /** Nutrition: the daily calorie change. */
  kcalPerDay: number | null;
  /** Cardio: the weight-management engine's one-variable step (deterministic draft), when there is one. */
  cardioStep: CardioStep | null;
  /** Cardio: the weekly minutes this changes by (estimate; for permitted ranges). */
  cardioMinutesDelta: number | null;
  /** Toward the goal faster (true), easing off (false), or neither (null). */
  toward: boolean | null;
};

export type AutopilotAssessment = {
  category: Category;
  headline: string;
  rationale: string;
  expected: string | null;
  reassessOn: string;
  evidence: EvidenceItem[];
  protections: Protection[];
  missing: string[];
  domains: Record<Domain, DomainDecision>;
};

/** How autonomy routed one domain's decision. */
export type Routing = {
  action: "none" | "draft" | "publish";
  bucket: Bucket;
  /** Smart / Advanced would have published this, but shadow mode is on: a draft for the coach. */
  shadowWouldPublish: boolean;
  why: string;
};

export type DraftRef =
  | { kind: "program_ai_edit"; id: string }
  | { kind: "nutrition_plan_edit"; id: string }
  | { kind: "cardio_draft"; savedAt: string; deterministic: boolean };

/** One domain as stored on the decision row (`autopilot_decisions.domains`). */
export type StoredDomain = DomainDecision & {
  routing: Routing;
  draft: DraftRef | null;
  draftError: string | null;
  /** Before / after in the client's words, for the coach and the system card. */
  before: string | null;
  after: string | null;
  published: { at: string; ref: string | null } | null;
  rolledBack: { at: string; by: string | null } | null;
};
