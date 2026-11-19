/**
 * Quick post-workout review. One compact screen, session questions first:
 *
 *   How hard was it?  — Easy … Max, stored as session RPE (the one required tap)
 *   Anything hurt?    — No/Yes; Yes asks where (any number of places, each
 *                       with an optional side) + how bad (feeds coach flags)
 *   Sleep last night  — <5h / 5–6h / 6–7h / 7–8h / 8h+ (optional)
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
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { FilmAudienceChoice } from "@/components/workout/shared/workout-film";
import { PhoneCopyReminder } from "@/components/workout-day/set-video-phone-copy";
import { useServiceTier } from "@/lib/service-tier";
import { pushWorkoutNote } from "@/lib/workout-notes";
import {
  EFFORT_OPTIONS,
  PAIN_AREAS,
  PAIN_SEVERITY,
  PAIN_SIDES,
  SIDED_PAIN_AREAS,
  composePainAreas,
  parsePainAreas,
  type PainPick,
  type PainSide,
  REVIEW_VERSION,
  SLEEP_OPTIONS,
  deriveOverallRating,
  checkoutCta,
  effortChip,
  initialEffort,
  sleepChip,
} from "@/lib/workout-review";
import type { SleepBucket } from "@/lib/analytics/recovery-score";
import { HapticTap } from "@/components/haptic-tap";

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
  { v: 1, emoji: "😫", label: "Drained" },
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
  /**
   * Opens the workout recap. Called only after this sheet has fully closed,
   * so two overlays never animate at once (that left the page frozen), and
   * only for a first review: saving an edit just closes.
   */
  onViewScore?: (rating: number | null) => void;
  /** Show the recap even when the save was an edit (the finish-by-review flow). */
  scoreAfterEdit?: boolean;
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
  scoreAfterEdit,
  actAsClientId,
}: Props) {
  const submit = useServerFn(submitOrEditReview);
  const qc = useQueryClient();
  // A member has no coach: nothing here says it goes to one (their notes stay theirs).
  const { isSelfServe } = useServiceTier();
  const coached = hasCoach && !isSelfServe;
  // Fixed for the whole open → save → close cycle: saving writes the review,
  // which flips `initial.submittedAt` before the sheet has finished closing.
  const [isEdit, setIsEdit] = useState(!!initial?.submittedAt);
  const savingRef = useRef(false);
  // Runs once the sheet has fully closed (onCloseAutoFocus below).
  const afterCloseRef = useRef<(() => void) | null>(null);

  const [effort, setEffort] = useState<number | null>(() => initialEffort(initial));
  const [sleepBucket, setSleepBucket] = useState<SleepBucket | null>(initial?.sleepBucket ?? null);
  const [recoveryToday, setRecoveryToday] = useState<number | null>(initial?.recoveryToday ?? null);
  // null = not answered. Edits show the stored value; new reviews start blank.
  const [pain, setPain] = useState<boolean | null>(initial?.submittedAt ? !!initial.pain : null);
  // A stored area splits into chips + optional sides ("Neck, Shoulder (R)");
  // anything no chip matches (older reviews: "General") shows as written, as a
  // picked chip that a tap takes off.
  const initialPain = () => parsePainAreas(initial?.pain ? initial?.painArea ?? null : null);
  const [painPicks, setPainPicks] = useState<PainPick[]>(() => initialPain().picks);
  const [otherAreas, setOtherAreas] = useState<string[]>(() => initialPain().other);
  const [painLevel, setPainLevel] = useState<number>(initial?.painLevel ?? 5);
  const [note, setNote] = useState<string>(initial?.clientNote ?? "");
  const [noteOpen, setNoteOpen] = useState<boolean>(!!(initial?.clientNote ?? "").trim());

  useEffect(() => {
    if (!open || savingRef.current) return;
    setIsEdit(!!initial?.submittedAt);
    setEffort(initialEffort(initial));
    setSleepBucket(initial?.sleepBucket ?? null);
    setRecoveryToday(initial?.recoveryToday ?? null);
    setPain(initial?.submittedAt ? !!initial.pain : null);
    const p = initialPain();
    setPainPicks(p.picks);
    setOtherAreas(p.other);
    setPainLevel(initial?.painLevel ?? 5);
    setNote(initial?.clientNote ?? "");
    setNoteOpen(!!(initial?.clientNote ?? "").trim());
  }, [open, initial?.submittedAt]);

  const storedArea = composePainAreas(painPicks, otherAreas);
  const placeCount = painPicks.length + otherAreas.length;
  const sidedPicks = painPicks.filter((p) => SIDED_PAIN_AREAS.includes(p.area));
  const toggleArea = (area: string) =>
    setPainPicks((prev) =>
      prev.some((p) => p.area === area) ? prev.filter((p) => p.area !== area) : [...prev, { area, side: null }],
    );
  const pickSide = (area: string, side: PainSide) =>
    setPainPicks((prev) => prev.map((p) => (p.area === area ? { ...p, side: p.side === side ? null : side } : p)));
  const cta = checkoutCta({ isEdit, effort, pain, painArea: storedArea, sleepBucket, recoveryToday });

  const mutation = useMutation({
    mutationFn: async () => {
      if (effort == null) throw new Error("Pick how hard it was");
      if (pain && !storedArea) throw new Error("Pick where it hurts");
      savingRef.current = true;
      const wasEdit = isEdit;
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
          painArea: pain ? storedArea : null,
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
      return { res, overallRating, wasEdit };
    },
    onSuccess: async ({ res, overallRating, wasEdit }: any) => {
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

      // a note or pain went to the coach's Messages (made by the database): tell them, push the coach
      const toCoach = coached && !actAsClientId && !!res?.coachMessageId;
      if (toCoach) void pushWorkoutNote(res.coachMessageId);
      toast.success(res?.edited ? "Review updated." : "Workout complete.", toCoach ? { description: "Your coach has your note in Messages." } : undefined);
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
      if (onViewScore && (!wasEdit || scoreAfterEdit)) {
        afterCloseRef.current = () => onViewScore(overallRating ?? null);
      }
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't save review"),
    onSettled: () => {
      savingRef.current = false;
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        onCloseAutoFocus={(e) => {
          const next = afterCloseRef.current;
          if (!next) return;
          afterCloseRef.current = null;
          e.preventDefault();
          next();
        }}
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
            <SheetTitle className="text-lg font-bold leading-tight">
              {isEdit ? "Edit your review" : "How'd it go?"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {coached ? "4 quick taps. Your coach sees this." : "4 quick taps. Tunes your next session."}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          <Row title="How hard was it?" hint={effort == null ? "Required" : undefined}>
            <div className="grid grid-cols-5 gap-1.5">
              {EFFORT_OPTIONS.map((o, i) => (
                <Chip
                  key={o.v}
                  active={effortChip(effort) === o.v}
                  onClick={() => setEffort(o.v)}
                  label={`Effort: ${o.label}`}
                  className="gap-1"
                >
                  {/* Rising bars show the order without numbers. */}
                  <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((b) => (
                      <span
                        key={b}
                        className={cn("w-1 rounded-sm bg-current", b > i && "opacity-20")}
                        style={{ height: 6 + b * 2 }}
                      />
                    ))}
                  </span>
                  <span className="text-[11px] font-bold">{o.label}</span>
                </Chip>
              ))}
            </div>
          </Row>

          <Row title="Anything hurt?">
            <div className="grid grid-cols-2 gap-1.5">
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
            {pain && (
              <div className="space-y-3" data-pain-details>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground" data-testid="pain-where">
                    {placeCount ? "Where" : "Where? Tap all that apply"}
                  </p>
                  {/* head to toe, three across; any number of places */}
                  <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Where it hurts">
                    {PAIN_AREAS.map((a) => (
                      <Chip
                        key={a}
                        active={painPicks.some((p) => p.area === a)}
                        onClick={() => toggleArea(a)}
                        label={a}
                        className="text-[13px] font-semibold"
                      >
                        {a}
                      </Chip>
                    ))}
                    {/* an older answer no chip matches, kept as written until it's tapped off */}
                    {otherAreas.map((o) => (
                      <Chip
                        key={o}
                        active
                        onClick={() => setOtherAreas((prev) => prev.filter((x) => x !== o))}
                        label={`${o}, tap to remove`}
                        className="text-[13px] font-semibold"
                      >
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
                {sidedPicks.length > 0 && (
                  <div className="space-y-1.5" data-pain-sides>
                    <p className="text-xs font-semibold text-muted-foreground">
                      Which side? <span className="font-normal">Optional</span>
                    </p>
                    {sidedPicks.map((p) => (
                      <div key={p.area} className="flex items-center gap-2" role="group" aria-label={`${p.area}: which side`}>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.area}</span>
                        <div className="grid w-[11.5rem] shrink-0 grid-cols-3 rounded-lg border border-border p-0.5">
                          {PAIN_SIDES.map((o) => (
                            <button
                              key={o.v}
                              type="button"
                              onClick={() => pickSide(p.area, o.v)}
                              aria-pressed={p.side === o.v}
                              className={cn(
                                "h-10 rounded-md text-xs font-semibold transition-colors",
                                p.side === o.v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {placeCount > 1 ? "How bad? The worst one" : "How bad?"}
                  </p>
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
              </div>
            )}
          </Row>

          <Row title="Sleep last night">
            <div className="grid grid-cols-5 gap-1.5">
              {SLEEP_OPTIONS.map((o) => {
                // An older review may hold 8_9 / 9h+; it shows as "8h+" and
                // keeps its stored value unless the athlete changes it.
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
            <div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={pain ? (painPicks.some((p) => p.area === "Other") ? "Where does it hurt, and on which movement?" : "What happened? Which movement?") : coached ? "Anything your coach should know?" : "Anything to remember about today?"}
                rows={2}
                maxLength={600}
                className="resize-none"
                aria-label="Note"
              />
              {/* say where it goes, so nobody wonders if the coach saw it */}
              {coached && (
                <p className="mt-1 text-[11px] text-muted-foreground" data-review-to-coach>
                  {pain ? "This and your pain report go to your coach in Messages." : "Goes to your coach in Messages."}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {coached ? "Add a note for your coach" : "Add a note"}
            </button>
          )}

          {/* clips they filmed in the app and haven't saved to the phone: one tap saves them all */}
          {ctx.kind === "client" && !actAsClientId && <PhoneCopyReminder dayId={ctx.dayId} />}

          {/* their film: Crew (posts by itself) or Coach only (saved on the account) */}
          {ctx.kind === "client" && !actAsClientId && <FilmAudienceChoice dayId={ctx.dayId} />}

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
          <Button type="button" className="relative flex-1" onClick={() => mutation.mutate()} disabled={!cta.enabled || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {cta.label}
            {/* the iPhone's tap as the workout is finished (haptic-tap.tsx) */}
            {cta.enabled && !mutation.isPending && <HapticTap />}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
