/**
 * Quick post-workout review. One compact screen, session questions first:
 *
 *   How hard was it?  — session RPE 6–10 (the one required tap)
 *   Anything hurt?    — No/Yes; Yes asks where + how bad (feeds coach flags)
 *   Sleep last night  — <5h / 5–6h / 6–7h / 7h+ (optional)
 *   Energy going in   — 1–5 (optional)
 *   Note              — behind "Add a note"
 *
 * Nothing is pre-selected, so every stored answer is one the athlete tapped.
 * Fastest finish is two taps (effort, then the button); the button says how
 * many optional answers that skips, which nudges filling them in.
 *
 * These are the markers the recovery score and the load suggestions use.
 * See src/lib/workout-review.ts for the mapping and why v1 was replaced.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Plus } from "lucide-react";
import { submitOrEditReview, type WorkoutCompletionCtx } from "@/lib/workout-completion.functions";
import {
  EFFORT_OPTIONS,
  PAIN_AREAS,
  PAIN_SEVERITY,
  REVIEW_VERSION,
  SLEEP_OPTIONS,
  deriveOverallRating,
  checkoutCta,
  initialEffort,
  sleepChip,
} from "@/lib/workout-review";
import type { SleepBucket } from "@/lib/analytics/recovery-score";

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
  sleepBucket?: SleepBucket | null;
  sleepNotes?: string | null;
  reviewVersion?: number | null;
};

export type { SleepBucket };

const RECOVERY_OPTIONS: { v: number; emoji: string; label: string }[] = [
  { v: 1, emoji: "😫", label: "Wrecked" },
  { v: 2, emoji: "🙁", label: "Low" },
  { v: 3, emoji: "😐", label: "Okay" },
  { v: 4, emoji: "🙂", label: "Good" },
  { v: 5, emoji: "💪", label: "Fresh" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: WorkoutCompletionCtx;
  hasCoach?: boolean;
  initial?: ReviewInitial | null;
  onSaved?: () => Promise<void> | void;
  onViewScore?: (rating: number | null) => void;
  actAsClientId?: string | null;
};

// ── Component ─────────────────────────────────────────────────────────────────

function Chip({
  active,
  onClick,
  label,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex min-h-[44px] flex-col items-center justify-center rounded-xl border-2 px-1 py-1.5 text-xs font-bold leading-tight transition-all active:scale-95",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:bg-secondary/30",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

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
  const qc = useQueryClient();
  const isEdit = !!initial?.submittedAt;

  const [effort, setEffort] = useState<number | null>(() => initialEffort(initial));
  const [sleepBucket, setSleepBucket] = useState<SleepBucket | null>(initial?.sleepBucket ?? null);
  const [recoveryToday, setRecoveryToday] = useState<number | null>(initial?.recoveryToday ?? null);
  // null = not answered. Edits show the stored value; new reviews start blank.
  const [pain, setPain] = useState<boolean | null>(initial?.submittedAt ? !!initial.pain : null);
  const [painArea, setPainArea] = useState<string | null>(initial?.pain ? initial?.painArea ?? null : null);
  const [painLevel, setPainLevel] = useState<number>(initial?.painLevel ?? 5);
  const [note, setNote] = useState<string>(initial?.clientNote ?? "");
  const [noteOpen, setNoteOpen] = useState<boolean>(!!(initial?.clientNote ?? "").trim());

  useEffect(() => {
    if (!open) return;
    setEffort(initialEffort(initial));
    setSleepBucket(initial?.sleepBucket ?? null);
    setRecoveryToday(initial?.recoveryToday ?? null);
    setPain(initial?.submittedAt ? !!initial.pain : null);
    setPainArea(initial?.pain ? initial?.painArea ?? null : null);
    setPainLevel(initial?.painLevel ?? 5);
    setNote(initial?.clientNote ?? "");
    setNoteOpen(!!(initial?.clientNote ?? "").trim());
  }, [open, initial?.submittedAt]);

  const cta = checkoutCta({ isEdit, effort, pain, painArea, sleepBucket, recoveryToday });

  const mutation = useMutation({
    mutationFn: async () => {
      if (effort == null) throw new Error("Pick how hard it was");
      if (pain && !painArea) throw new Error("Pick where it hurts");
      const overallRating = deriveOverallRating({
        pain: !!pain,
        sessionRpe: effort,
        recoveryToday,
      });
      const res = await submit({
        data: {
          ...ctx,
          overallRating,
          sessionRpe: effort,
          // Skipped = "no pain reported"; the column is NOT NULL.
          pain: !!pain,
          // Constraint pl_workout_feedback_pain_consistency requires:
          // pain=true → pain_level IS NOT NULL AND pain_area IS NOT NULL
          painLevel: pain ? painLevel : null,
          painArea: pain ? painArea : null,
          painNote: null,
          clientNote: note.trim() ? note.trim() : null,
          // Legacy optional fields: preserved in DB, no longer asked.
          strengthFeel: initial?.strengthFeel ?? null,
          fatigueFeel: initial?.fatigueFeel ?? null,
          hitTarget: initial?.hitTarget ?? null,
          recoveryToday,
          sleepBucket,
          sleepNotes: initial?.sleepNotes ?? null,
          reviewVersion: REVIEW_VERSION,
          actAsClientId: actAsClientId ?? null,
        },
      });
      return { res, overallRating };
    },
    onSuccess: async ({ res, overallRating }: any) => {
      // Some flows use the review itself as the final completion action.
      // Wait for that parent finalization before showing "Workout complete"
      // or closing the sheet, so the UI never claims success early.
      try {
        await onSaved?.();
      } catch (e: any) {
        toast.error("Review saved, but the workout still needs finishing.", {
          description: e?.message,
        });
        return;
      }

      toast.success(res?.edited ? "Review updated." : "Workout complete.");
      // Review answers feed the Training Readiness ring and tomorrow's load
      // suggestions — refresh both.
      qc.invalidateQueries({ queryKey: ["training-readiness"] });
      qc.invalidateQueries({ queryKey: ["load-readiness"] });
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.startsWith("recovery") || k === "readiness");
        },
      });
      onViewScore?.(overallRating ?? null);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't save review"),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        // Radix focuses the first button on open, which paints a focus ring
        // on touch devices before the athlete has done anything.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="z-[70] flex max-h-[92svh] flex-col gap-0 rounded-t-3xl p-0"
      >
        <div
          className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur"
          // The sheet is capped at 92svh, so its top edge already sits 8svh
          // below the viewport top. Pad only by the part of the safe area
          // (status bar / Dynamic Island) the sheet actually overlaps.
          style={{ paddingTop: "max(calc(env(safe-area-inset-top) - 8svh), 0px)" }}
        >
          <SheetHeader className="min-h-0 space-y-0.5 px-5 pb-3 pt-4 text-left">
            <SheetTitle className="text-lg font-black leading-tight">
              {isEdit ? "Edit your review" : "How'd it go?"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {hasCoach ? "4 quick taps. Your coach sees this." : "4 quick taps. Tunes your next session."}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          <Row title="How hard was it?" hint={effort == null ? "Required" : undefined}>
            <div className="grid grid-cols-5 gap-1.5">
              {EFFORT_OPTIONS.map((o) => (
                <Chip
                  key={o.v}
                  active={effort === o.v}
                  onClick={() => setEffort(o.v)}
                  label={`Effort ${o.v} ${o.label}`}
                >
                  <span className="text-base tabular-nums">{o.v}</span>
                  <span className="text-[10px] font-semibold opacity-80">{o.label}</span>
                </Chip>
              ))}
            </div>
          </Row>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">Anything hurt?</span>
              <div className="grid w-40 shrink-0 grid-cols-2 gap-1.5">
                <Chip active={pain === false} onClick={() => setPain(false)} label="No pain">
                  No
                </Chip>
                <Chip
                  active={pain === true}
                  onClick={() => {
                    setPain(true);
                    setNoteOpen(true);
                  }}
                  label="Yes, pain"
                >
                  Yes
                </Chip>
              </div>
            </div>
            {pain && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {PAIN_AREAS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setPainArea(a)}
                      aria-pressed={painArea === a}
                      className={cn(
                        "h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
                        painArea === a
                          ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300"
                          : "border-border bg-card text-foreground hover:bg-secondary/30",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAIN_SEVERITY.map((o) => (
                    <Chip
                      key={o.v}
                      active={painLevel === o.v}
                      onClick={() => setPainLevel(o.v)}
                      label={`Pain ${o.label}`}
                    >
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Row title="Sleep last night">
            <div className="grid grid-cols-4 gap-1.5">
              {SLEEP_OPTIONS.map((o) => {
                // An older review may hold 7_8 / 8_9 / 9h+; it shows as "7h+"
                // and keeps its stored value unless the athlete changes it.
                const active = sleepChip(sleepBucket) === o.v;
                return (
                  <Chip
                    key={o.v}
                    active={active}
                    onClick={() => setSleepBucket(active ? null : o.v)}
                    label={`Sleep ${o.label}`}
                    className="text-sm"
                  >
                    {o.label}
                  </Chip>
                );
              })}
            </div>
          </Row>

          <Row title="Energy going in">
            <div className="grid grid-cols-5 gap-1.5">
              {RECOVERY_OPTIONS.map((o) => (
                <Chip
                  key={o.v}
                  active={recoveryToday === o.v}
                  onClick={() => setRecoveryToday(recoveryToday === o.v ? null : o.v)}
                  label={`Energy ${o.label}`}
                >
                  <span className="text-xl leading-none" aria-hidden="true">
                    {o.emoji}
                  </span>
                  <span className="text-[10px] font-semibold opacity-80">{o.label}</span>
                </Chip>
              ))}
            </div>
          </Row>

          {noteOpen ? (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={pain ? "What happened? Which movement?" : "Anything your coach should know?"}
              rows={2}
              maxLength={600}
              className="resize-none"
              aria-label="Note"
            />
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add a note
            </button>
          )}

          {isEdit && initial?.editCount != null && initial.editCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Edited {initial.editCount} time{initial.editCount === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        <SheetFooter
          className="flex-row gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur sm:flex-row"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Close
          </Button>
          <Button className="flex-1" onClick={() => mutation.mutate()} disabled={!cta.enabled || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {cta.label}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
