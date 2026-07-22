/**
 * Simplified post-workout review — 3-card status check-out.
 *
 * Client-facing UX: 3 large status cards + conditional notes field.
 * Target completion time: under 5 seconds.
 *
 * Analytics compatibility:
 *   The existing pl_workout_feedback schema is preserved unchanged.
 *   Status cards map to legacy required fields so all existing reports,
 *   dashboards, and coach history views continue to work:
 *
 *   Feeling Good  → overall_rating: 5, session_rpe: 5, pain: false
 *   Minor Issue   → overall_rating: 3, session_rpe: 7, pain: false
 *   Need Attention → overall_rating: 2, session_rpe: 8, pain: true, pain_level: 5
 *
 *   strength_feel, fatigue_feel, hit_target: preserved in DB, hidden from UI.
 *   Historical submissions remain fully intact.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { submitOrEditReview, type WorkoutCompletionCtx } from "@/lib/workout-completion.functions";

// ── Status card definitions ───────────────────────────────────────────────────

type StatusKey = "good" | "minor" | "attention";

const STATUS_CARDS: {
  key: StatusKey;
  label: string;
  subtitle: string;
  icon: typeof CheckCircle2;
  // Colour classes
  border: string;
  bg: string;
  activeBorder: string;
  activeBg: string;
  activeText: string;
  iconColor: string;
  // Legacy field mappings for analytics compatibility
  overallRating: number;
  sessionRpe: number;
  pain: boolean;
  painLevel: number | null;
}[] = [
  {
    key: "good",
    label: "Feeling Good",
    subtitle: "Everything went as expected. No issues to report.",
    icon: CheckCircle2,
    border: "border-border",
    bg: "bg-card",
    activeBorder: "border-emerald-500",
    activeBg: "bg-emerald-500/10",
    activeText: "text-emerald-700",
    iconColor: "text-emerald-500",
    overallRating: 5,
    sessionRpe: 5,
    pain: false,
    painLevel: null,
  },
  {
    key: "minor",
    label: "Minor Issue",
    subtitle: "Something worth mentioning — low energy, recovery concerns, minor discomfort.",
    icon: AlertCircle,
    border: "border-border",
    bg: "bg-card",
    activeBorder: "border-amber-500",
    activeBg: "bg-amber-500/10",
    activeText: "text-amber-700",
    iconColor: "text-amber-500",
    overallRating: 3,
    sessionRpe: 7,
    pain: false,
    painLevel: null,
  },
  {
    key: "attention",
    label: "Need Attention",
    subtitle: "Pain, injury, illness, or something affecting training.",
    icon: AlertTriangle,
    border: "border-border",
    bg: "bg-card",
    activeBorder: "border-red-500",
    activeBg: "bg-red-500/10",
    activeText: "text-red-700",
    iconColor: "text-red-500",
    overallRating: 2,
    sessionRpe: 8,
    pain: true,
    painLevel: 5,
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewInitial = {
  overallRating?: number | null;
  sessionRpe?: number | null;
  pain?: boolean | null;
  painLevel?: number | null;
  painArea?: string | null;
  painNote?: string | null;
  clientNote?: string | null;
  editCount?: number | null;
  submittedAt?: string | null;
  strengthFeel?: string | null;
  fatigueFeel?: string | null;
  hitTarget?: string | null;
  recoveryToday?: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: WorkoutCompletionCtx;
  hasCoach?: boolean;
  initial?: ReviewInitial | null;
  onSaved?: () => void;
  onViewScore?: (rating: number | null) => void;
  actAsClientId?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Infer the status key from legacy rating/pain fields for pre-existing reviews. */
function inferStatus(initial: ReviewInitial | null | undefined): StatusKey | null {
  if (!initial?.submittedAt) return null;
  if (initial.pain) return "attention";
  const r = initial.overallRating ?? 5;
  if (r >= 4) return "good";
  if (r >= 3) return "minor";
  return "attention";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkoutReviewEditor({
  open,
  onOpenChange,
  ctx,
  hasCoach,
  initial,
  onSaved,
  onViewScore,
  actAsClientId,
}: Props) {
  const submit = useServerFn(submitOrEditReview);
  const isEdit = !!initial?.submittedAt;

  const [status, setStatus] = useState<StatusKey | null>(() => inferStatus(initial));
  const [note, setNote] = useState<string>(initial?.clientNote ?? "");
  const [recoveryToday, setRecoveryToday] = useState<number | null>(initial?.recoveryToday ?? null);

  useEffect(() => {
    if (!open) return;
    setStatus(inferStatus(initial));
    setNote(initial?.clientNote ?? "");
    setRecoveryToday(initial?.recoveryToday ?? null);
  }, [open, initial?.submittedAt]);

  const selectedCard = STATUS_CARDS.find((c) => c.key === status) ?? null;
  const showNotes = status === "minor" || status === "attention";
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error("Please select a workout status");
      return submit({
        data: {
          ...ctx,
          overallRating: selectedCard.overallRating,
          sessionRpe: selectedCard.sessionRpe,
          pain: selectedCard.pain,
          painLevel: selectedCard.painLevel,
          // Constraint pl_workout_feedback_pain_consistency requires:
          // pain=true → pain_level IS NOT NULL AND pain_area IS NOT NULL
          painArea: selectedCard.pain ? "General" : null,
          painNote: null,
          clientNote: note.trim() ? note.trim() : null,
          // Preserve legacy optional fields as null (hidden from UI but kept in DB)
          strengthFeel: null,
          fatigueFeel: null,
          hitTarget: null,
          recoveryToday: recoveryToday,
          actAsClientId: actAsClientId ?? null,
        },
      });
    },
    onSuccess: (res: any) => {
      toast.success(res?.edited ? "Review updated." : "Review saved.");
      onSaved?.();
      onViewScore?.(selectedCard?.overallRating ?? null);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't save review"),
  });

  const canSubmit = status !== null && !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="z-[70] max-h-[92svh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-5 pt-5">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl font-black">
              {isEdit ? "Edit your review" : "Workout Status"}
            </SheetTitle>
            <SheetDescription>
              {hasCoach
                ? "Your coach can see this."
                : "Notes for your own records."}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-3 px-5 pb-4 pt-5">
          {/* 3 large status cards */}
          <div className="space-y-2">
            {STATUS_CARDS.map((card) => {
              const Icon = card.icon;
              const active = status === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setStatus(card.key)}
                  aria-pressed={active}
                  className={cn(
                    "w-full rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99]",
                    active
                      ? `${card.activeBorder} ${card.activeBg}`
                      : `${card.border} ${card.bg} hover:bg-secondary/30`,
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", active ? card.iconColor : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-base font-bold leading-tight", active ? card.activeText : "text-foreground")}>
                        {card.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground leading-snug">
                        {card.subtitle}
                      </div>
                    </div>
                    {active && (
                      <div className={cn("shrink-0 h-5 w-5 rounded-full flex items-center justify-center", card.activeBg, card.activeBorder, "border")}>
                        <div className={cn("h-2.5 w-2.5 rounded-full", card.iconColor.replace("text-", "bg-"))} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Conditional: tell your coach (shown for Minor Issue + Need Attention) */}
          {showNotes && (
            <div className="space-y-1.5 pt-1">
              <label htmlFor="review-concern" className="text-sm font-bold">
                Tell your coach what happened
              </label>
              <Textarea
                id="review-concern"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. shoulder discomfort, knee pain, illness, travel fatigue…"
                rows={3}
                maxLength={600}
                className="resize-none"
              />
            </div>
          )}

          {/* Optional notes (always shown, but not required) */}
          {!showNotes && (
            <div className="space-y-1.5 pt-1">
              <label htmlFor="review-note" className="text-sm font-bold text-muted-foreground">
                {hasCoach ? "Anything your coach should know?" : "Anything you want to note?"}
                <span className="ml-1 font-normal text-xs">(optional)</span>
              </label>
              <Textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Work stress, travel, recovery concerns, nutrition…"
                rows={2}
                maxLength={600}
                className="resize-none"
              />
            </div>
          )}

          {isEdit && initial?.editCount != null && initial.editCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Edited {initial.editCount} time{initial.editCount === 1 ? "" : "s"}.
            </p>
          )}

          {/* Optional single-tap Recovery rating — one input into the Estimated Recovery Score */}
          <div className="space-y-2 pt-2">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-bold">
                Recovery
                <span className="ml-1 font-normal text-xs text-muted-foreground">(optional)</span>
              </label>
              {recoveryToday != null && (
                <button
                  type="button"
                  onClick={() => setRecoveryToday(null)}
                  className="text-[11px] text-muted-foreground underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { v: 1, emoji: "😫", label: "Very Poor" },
                { v: 2, emoji: "😕", label: "Poor" },
                { v: 3, emoji: "😐", label: "Average" },
                { v: 4, emoji: "🙂", label: "Good" },
                { v: 5, emoji: "💪", label: "Excellent" },
              ].map((o) => {
                const active = recoveryToday === o.v;
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setRecoveryToday(active ? null : o.v)}
                    aria-pressed={active}
                    aria-label={`Recovery: ${o.label}`}
                    className={cn(
                      "flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-2 transition-all active:scale-95",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary/30",
                    )}
                  >
                    <span className="text-2xl leading-none" aria-hidden="true">{o.emoji}</span>
                    <span className={cn("text-[10px] font-semibold leading-tight text-center", active ? "text-primary" : "text-muted-foreground")}>
                      {o.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Optional — improves your recovery score accuracy. Skip if unsure.
            </p>
          </div>
        </div>

        <SheetFooter className="sticky bottom-0 z-10 flex-row gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur sm:flex-row">
          <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Close
          </Button>
          <Button
            className="flex-1"
            onClick={() => mutation.mutate()}
            disabled={!status || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Done"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
