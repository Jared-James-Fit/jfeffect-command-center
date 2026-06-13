import { Sparkles, UserRoundCheck, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";

export type AiAssistanceState =
  | { kind: "coach_written" }
  | { kind: "ai_assisted_draft" } // AI-only, no human review/edit
  | { kind: "ai_assisted_coach_edited" } // AI draft + coach edits, not formally approved
  | { kind: "ai_assisted_coach_approved" }; // AI draft + coach approved

/**
 * Derives the accurate disclosure state for a message/response from the
 * underlying submission_reviews / submission_ai_generations metadata.
 *
 * RULES:
 *  - never returns "coach_reviewed" unless we have an actual approved_by + approved_at.
 *  - if AI was not used at all, returns coach_written.
 */
export function deriveAiAssistance(input: {
  ai_used?: boolean | null;
  coach_edited?: boolean | null;
  approved_by?: string | null;
  approved_at?: string | null;
}): AiAssistanceState {
  if (!input.ai_used) return { kind: "coach_written" };
  if (input.approved_by && input.approved_at) return { kind: "ai_assisted_coach_approved" };
  if (input.coach_edited) return { kind: "ai_assisted_coach_edited" };
  return { kind: "ai_assisted_draft" };
}

export interface AiAssistanceLabelProps {
  state: AiAssistanceState;
  className?: string;
  size?: "sm" | "xs";
}

const COPY: Record<AiAssistanceState["kind"], { label: string; icon: any; tone: string }> = {
  coach_written: { label: "Coach-written", icon: PencilLine, tone: "text-muted-foreground" },
  ai_assisted_draft: { label: "AI-assisted draft", icon: Sparkles, tone: "text-violet-600 dark:text-violet-400" },
  ai_assisted_coach_edited: { label: "AI-assisted · coach-edited", icon: Sparkles, tone: "text-violet-600 dark:text-violet-400" },
  ai_assisted_coach_approved: { label: "AI-assisted · coach-reviewed", icon: UserRoundCheck, tone: "text-emerald-600 dark:text-emerald-400" },
};

export function AiAssistanceLabel({ state, className, size = "xs" }: AiAssistanceLabelProps) {
  const c = COPY[state.kind];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 leading-none",
        size === "xs" ? "text-[10px]" : "text-xs",
        c.tone,
        className,
      )}
      title={c.label}
    >
      <Icon className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {c.label}
    </span>
  );
}