/**
 * Client-safe types and pure helpers for the AI Coaching Review layer.
 *
 * Server-side logic lives in `src/lib/submission-reviews.functions.ts` and
 * `src/lib/ai-config.functions.ts`. This module is import-safe from the
 * browser (no `process.env`, no `supabaseAdmin`).
 */

export type ReviewSourceType = "native" | "fillout" | "application";

export type ReviewStatus =
  | "submitted"
  | "processing"
  | "needs_review"
  | "draft_ready"
  | "coach_editing"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "delivery_failed"
  | "archived";

export type AiStatus = "pending" | "processing" | "ready" | "failed" | "skipped";
export type ReviewPriority = "low" | "normal" | "high" | "urgent";

export type SubmissionReviewRow = {
  id: string;
  source_type: ReviewSourceType;
  source_id: string;
  form_id: string | null;
  client_id: string | null;
  application_id: string | null;
  assigned_coach_user_id: string | null;
  priority: ReviewPriority;
  review_status: ReviewStatus;
  ai_status: AiStatus;
  latest_generation_id: string | null;
  latest_message_id: string | null;
  coach_draft: string | null;
  approved_response: string | null;
  delivered_response: string | null;
  scheduled_at: string | null;
  scheduled_by: string | null;
  schedule_cancelled_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  last_delivery_error: string | null;
  send_idempotency_key: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

export type AiGenerationRow = {
  id: string;
  review_id: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  model: string | null;
  global_config_version: number | null;
  form_config_version: number | null;
  submission_instruction: string | null;
  input_context: unknown;
  structured_output: AiStructuredOutput | null;
  client_response: string | null;
  urgency: string | null;
  error: string | null;
  usage: unknown;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
};

/**
 * Validated structured AI output. Mirrors the Zod schema enforced server-side
 * in `generateSubmissionDraft`.
 */
export type AiStructuredOutput = {
  summary: string;
  wins: string[];
  concerns: string[];
  risks: string[];
  recommendations: string[];
  follow_up_questions: string[];
  suggested_actions: string[];
  urgency: "low" | "normal" | "high" | "urgent";
  client_response: string;
};

export type GlobalAiConfigRow = {
  id: string;
  brand_voice: string | null;
  tone: string | null;
  safety_rules: string | null;
  prohibited_phrases: string[];
  escalation_rules: string | null;
  default_analysis_structure: string | null;
  default_response_structure: string | null;
  default_model: string;
  version: number;
  updated_at: string;
};

export type FormAiConfigRow = {
  id: string;
  form_id: string;
  enabled: boolean;
  instructions: string | null;
  allowed_client_context: string[];
  response_tone: string | null;
  response_length: "short" | "medium" | "long";
  internal_analysis_structure: string | null;
  client_response_structure: string | null;
  escalation_rules: string | null;
  priority_rules: string | null;
  allow_recommend_programming: boolean;
  allow_recommend_nutrition: boolean;
  require_coach_approval: boolean;
  default_assigned_coach: string | null;
  review_sla_hours: number | null;
  model: string | null;
  version: number;
  updated_at: string;
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  submitted: "New",
  processing: "AI processing",
  needs_review: "Needs review",
  draft_ready: "Draft ready",
  coach_editing: "Coach editing",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending…",
  sent: "Sent",
  delivery_failed: "Delivery failed",
  archived: "Archived",
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, string> = {
  submitted:        "bg-sky-500/15 text-sky-300 border-sky-500/40",
  processing:       "bg-amber-500/15 text-amber-300 border-amber-500/40",
  needs_review:     "bg-amber-500/15 text-amber-300 border-amber-500/40",
  draft_ready:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  coach_editing:    "bg-violet-500/15 text-violet-300 border-violet-500/40",
  approved:         "bg-primary/15 text-primary border-primary/40",
  scheduled:        "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
  sending:          "bg-amber-500/15 text-amber-300 border-amber-500/40",
  sent:             "bg-muted text-muted-foreground border-border",
  delivery_failed:  "bg-destructive/15 text-destructive border-destructive/40",
  archived:         "bg-muted text-muted-foreground border-border",
};

export const AI_STATUS_LABELS: Record<AiStatus, string> = {
  pending: "Pending",
  processing: "Generating…",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
};

export const SOURCE_LABELS: Record<ReviewSourceType, string> = {
  native: "Native form",
  fillout: "Fillout",
  application: "Application",
};