import { NewAchievementReveal } from "@/components/portal/new-achievement-reveal";
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trophy, Dumbbell, Activity, CheckCircle2, Flame, Clock, Star, ChevronLeft, Heart, X, Repeat2, CircleX, Sparkles, Medal, Share2, Download } from "lucide-react";
import type { WorkoutSummary } from "@/lib/workout-summary";
import { format } from "date-fns";
import { computeRecoveryScore } from "@/lib/analytics/recovery-score";
import {
  buildWorkoutTakeaways,
  formatPR,
  type CardioTakeawayInput,
  type SessionPR,
} from "@/lib/workout-takeaways";
import type { WorkoutPoints, WorkoutRecords } from "@/lib/training-records";
import { WorkoutPointsCard } from "@/components/records/workout-points-card";
import { SCOPE_LABEL, formatLoad, formatTonnage, repRecordLabel, tonnageRecordLabel, topScope, weightRecordLabel } from "@/lib/training-records";
import { drawWorkoutStory, type StoryRecord } from "@/lib/workout-story-card";
import { NewRecordsSection, TonnageStat, recordsHeadline } from "@/components/records/training-records";
import { RecapPostFooter } from "@/components/community/recap-post";

// The share studio (camera, cards, upload) is only fetched the first time
// someone taps Share workout, so the recap itself stays light.
const WorkoutShareStudio = lazyWithRetry(() => import("@/components/community/workout-share-studio").then((m) => ({ default: m.WorkoutShareStudio })));

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: WorkoutSummary;
  workoutTitle?: string | null;
  durationMin?: number | null;
  workoutDate?: string | Date | null;
  sessionRating?: number | null;
  /** Self-reported session RPE (1–10). Optional. */
  sessionRpe?: number | null;
  /** Client-reported pain flag. Optional. */
  pain?: boolean | null;
  /** PRs hit during this session (already de-duplicated per exercise). */
  prs?: SessionPR[];
  /**
   * Server-derived records for this workout (client workouts). `undefined`
   * means "not supported here" (falls back to session PRs); `null` = loading.
   */
  records?: WorkoutRecords | null;
  /** League + Logging Level points this workout earned (client workouts). */
  points?: WorkoutPoints | null;
  /** Shown on the Instagram Story share image. */
  athleteName?: string | null;
  /** Athlete's preferred unit for loads and tonnage. */
  displayUnit?: "kg" | "lb";
  /** Prescribed cardio status for the same day, when there is one. */
  cardio?: CardioTakeawayInput;
  /**
   * pl_day_completions.id of this finished workout. When present, the footer
   * offers the optional "Share workout" studio (camera → card → community
   * post and/or Instagram story, one screen). Omit it where sharing isn't supported (memberships, coach
   * "View as client"); the legacy story Share/Save buttons remain there.
   */
  completionId?: string | null;
  onClose?: () => void;
};

export function WorkoutSubmissionSummary({ open, onOpenChange, summary, workoutTitle, durationMin, workoutDate, sessionRating, sessionRpe, pain, prs, records, points, athleteName, displayUnit = "lb", cardio, completionId, onClose }: Props) {
  // Client workouts use the scope-aware server records; the legacy session PR
  // list only remains for surfaces without them (memberships).
  const usesRecords = records !== undefined;
  const prList = usesRecords ? [] : prs ?? [];
  const recordCount = (records?.records?.length ?? 0) + (records?.load_records?.length ?? 0) + (tonnageRecordLabel(records?.tonnage) ? 1 : 0);
  const recordHeadline = recordsHeadline(records);
  const [revealStage, setRevealStage] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const shareCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) {
      setRevealStage(0);
      setDisplayScore(0);
      return;
    }
    setRevealStage(0);
    setDisplayScore(0);
    const intro = window.setTimeout(() => {
      setRevealStage(1);
      void import("@/lib/app-sounds").then(({ playAppSound }) => playAppSound(soundRef.current));
    }, 450);
    const details = window.setTimeout(() => setRevealStage(2), 1450);
    return () => {
      window.clearTimeout(intro);
      window.clearTimeout(details);
    };
  }, [open]);

  useEffect(() => {
    if (!open || revealStage < 1) return;
    const target = Math.max(0, Math.min(100, summary.score));
    const started = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, revealStage, summary.score]);
  const soundRef = useRef<"celebrate" | "success">("success");
  soundRef.current = prList.length > 0 || recordCount > 0 ? "celebrate" : "success";
  const hasAchievement = prList.length > 0 || recordCount > 0 || summary.score >= 90 || summary.completionPct === 100;
  const headline =
    recordHeadline ? recordHeadline
    : prList.length > 0 ? (prList.length === 1 ? "NEW ATPR!" : `${prList.length} NEW ATPRs!`)
    : summary.score >= 90 ? "Crushed it!"
    : summary.score >= 75 ? "Great work!"
    : summary.score >= 50 ? "Solid effort"
    : "Logged — keep going";
  const takeaways = buildWorkoutTakeaways(summary, prList, cardio ?? null);
  // The star rating on the celebration screen represents session quality.
  // Historically it only showed the client's self-reported `overall_rating`,
  // which caused confusing screens like "100/100" alongside "3/5 stars" when
  // the client left the rating at its default. Derive stars from the
  // computed workout score and, when a self-rating exists, take whichever
  // is higher so an intentionally high self-rating still wins.
  const scoreStars = Math.max(0, Math.min(5, Math.round(summary.score / 20)));
  const selfStars = sessionRating != null
    ? Math.max(0, Math.min(5, Math.round(sessionRating)))
    : 0;
  const ratingStars = Math.max(scoreStars, selfStars);
  const dateLabel = (() => {
    if (!workoutDate) return null;
    try { return format(new Date(workoutDate), "EEE, MMM d, yyyy"); } catch { return null; }
  })();
  const recovery = computeRecoveryScore({
    completionPct: summary.completionPct,
    avgRpe: summary.avgRpe ?? null,
    sessionRpe: sessionRpe ?? null,
    overallRating: sessionRating ?? null,
    pain: pain ?? null,
  });

  const displayTakeaways = prList.length > 0
    ? takeaways.filter((t) => !/^🏆/.test(t.trim()))
    : takeaways;

  // Instagram Story card (1080×1920, safe-zone aware) — see workout-story-card.
  const storyRecords = (): StoryRecord[] => {
    const out: StoryRecord[] = [];
    if (records) {
      const loads = new Map((records.load_records ?? []).map((l) => [l.set_id, l]));
      for (const r of records.records ?? []) {
        const scope = topScope(r);
        if (!scope) continue;
        const load = loads.get(r.set_id);
        const loadScope = load ? topScope(load) : null;
        if (load) loads.delete(r.set_id);
        // Same set is a rep record and the heaviest ever → one row.
        const label = load && loadScope === scope ? `${r.reps}-REP + WEIGHT ${SCOPE_LABEL[scope]}` : repRecordLabel(r)!;
        out.push({ label, tier: scope, title: r.exercise_name, detail: `${formatLoad(r.load_kg, displayUnit)} × ${r.reps}` });
        if (load && loadScope && loadScope !== scope) {
          out.push({ label: weightRecordLabel(load)!, tier: loadScope, title: load.exercise_name, detail: `Heaviest ever · ${formatLoad(load.load_kg, displayUnit)}` });
        }
      }
      for (const l of loads.values()) {
        const scope = topScope(l);
        if (scope) out.push({ label: weightRecordLabel(l)!, tier: scope, title: l.exercise_name, detail: `Heaviest ever · ${formatLoad(l.load_kg, displayUnit)} × ${l.reps}` });
      }
      const ton = tonnageRecordLabel(records.tonnage);
      const tonScope = topScope(records.tonnage);
      if (ton && tonScope) out.push({ label: ton.replace("WORKOUT ", ""), tier: tonScope, title: "Workout Tonnage", detail: formatTonnage(records.tonnage_kg, displayUnit) });
    } else if (prList[0]) {
      prList.slice(0, 4).forEach((pr) => out.push({ label: "ALL-TIME PR", tier: "atpr", title: formatPR(pr), detail: "" }));
    }
    const rank = { atpr: 0, program_pr: 1, block_pr: 2 } as const;
    return out.sort((a, b) => rank[a.tier] - rank[b.tier]);
  };

  const buildShareBlob = async (): Promise<Blob | null> => {
    const canvas = shareCanvasRef.current ?? document.createElement("canvas");
    shareCanvasRef.current = canvas;
    const tonnage = records && records.tonnage_kg > 0
      ? formatTonnage(records.tonnage_kg, displayUnit)
      : summary.totalLifted > 0 ? summary.totalLiftedFmt : null;
    const stats = [
      { label: "Sets", value: `${summary.completedSets}/${summary.prescribedSets}` },
      ...(tonnage ? [{ label: "Tonnage", value: tonnage }] : []),
      ...(durationMin && durationMin > 0 ? [{ label: "Minutes", value: String(Math.round(durationMin)) }] : []),
    ];
    await drawWorkoutStory(canvas, {
      athleteName: athleteName?.trim() || null,
      headline,
      score: summary.score,
      workoutTitle: workoutTitle ?? null,
      dateLabel,
      records: storyRecords(),
      stats,
      leaguePoints: points?.league.total ?? null,
      levelPoints: points?.level.total ?? null,
    });
    return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 1));
  };
  const shareWorkout = async () => {
    setSharing(true); try { const blob=await buildShareBlob(); if(!blob)return; const file=new File([blob],"jf-effect-workout.png",{type:"image/png"}); if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:"JF Effect workout"});} else {const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);} } catch(e:any){if(e?.name!=="AbortError") console.warn("Workout share failed",e);} finally {setSharing(false);}
  };
  const saveWorkoutImage = async () => {
    const blob=await buildShareBlob(); if(!blob)return; const file=new File([blob],"jf-effect-workout.png",{type:"image/png"});
    try { if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:"Save JF Effect workout"});return;} } catch(e:any){if(e?.name==="AbortError")return;}
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) onClose?.(); }}>
      <DialogContent
        className="bottom-0 top-auto flex w-full max-w-none translate-x-[-50%] translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-[24px] border-border/80 bg-background p-0 shadow-2xl sm:bottom-auto sm:top-1/2 sm:max-w-[520px] sm:-translate-y-1/2 sm:rounded-[24px] [&>button]:hidden"
        style={{ height: "min(96dvh, 820px)", maxHeight: "96dvh" }}
      >
        <header className="relative shrink-0 overflow-hidden border-b border-border/70 bg-gradient-to-b from-primary/[0.12] via-primary/[0.04] to-background px-4 pb-4 pt-3 sm:px-5">
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/20 sm:hidden" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full text-muted-foreground"
            onClick={() => { onOpenChange(false); onClose?.(); }}
            aria-label="Close workout summary"
          >
            <X className="h-4 w-4" />
          </Button>

          <div className={`mx-auto flex w-full max-w-[calc(100%-4.5rem)] flex-col items-center text-center transition-all duration-500 ${revealStage >= 1 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
            <div className={`relative grid h-14 w-14 place-items-center rounded-full shadow-lg ${prList.length > 0 || recordCount > 0 ? "bg-amber-500 text-white ring-4 ring-amber-500/15" : "bg-primary text-primary-foreground"}`}>
              {prList.length > 0 || recordCount > 0 ? <Trophy className="h-7 w-7 animate-in zoom-in spin-in-6 duration-500" /> : <CheckCircle2 className="h-7 w-7" />}
              {revealStage >= 2 && <Sparkles className="absolute -right-2 -top-1 h-5 w-5 animate-pulse text-primary" />}
            </div>
            <div className="mt-2 text-[10px] font-black uppercase tracking-[0.22em] text-primary">Workout complete</div>
            <DialogHeader className="mx-auto mt-1 flex min-h-0 w-full flex-col items-center space-y-0 !pl-0 text-center sm:text-center">
              <DialogTitle className="block w-full text-center text-2xl font-black leading-tight tracking-tight">{headline}</DialogTitle>
              <DialogDescription className="mt-1 text-[11px]">
                {workoutTitle ?? "Workout"}{dateLabel ? ` · ${dateLabel}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3 grid w-full place-items-center tabular-nums">
              <div className="relative inline-flex items-baseline justify-center">
                <span className="text-5xl font-black leading-none text-primary">{displayScore}</span>
                <span className="absolute left-full ml-1 whitespace-nowrap text-xs font-bold text-muted-foreground">/100</span>
              </div>
            </div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Workout score</div>

            {ratingStars > 0 && revealStage >= 2 && (
              <div className="mt-2 flex items-center gap-0.5 animate-in fade-in zoom-in-95 duration-500">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className={`h-3.5 w-3.5 ${i <= ratingStars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"}`} />
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
          <div className={`space-y-2.5 transition-all duration-500 ${revealStage >= 2 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
            <NewAchievementReveal open={open} />
            {records && <NewRecordsSection records={records} unit={displayUnit} />}
            {points && <WorkoutPointsCard points={points} />}
            {prList.length > 0 && (
              <section className="relative overflow-hidden animate-in zoom-in-90 fade-in slide-in-from-bottom-3 rounded-2xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/[0.14] via-amber-500/[0.06] to-background p-4 shadow-sm duration-700">
                <Sparkles className="absolute right-3 top-3 h-5 w-5 animate-pulse text-amber-500" />
                <div className="mb-2 flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-white shadow-md">
                    <Medal className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Achievement unlocked</div>
                    <div className="text-base font-black leading-tight text-foreground">{prList.length === 1 ? "New all-time record" : `${prList.length} all-time records`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                  <Trophy className="h-3.5 w-3.5" />
                  ATPR breakdown
                </div>
                <div className="mt-1.5 space-y-1">
                  {prList.slice(0, 3).map((pr) => (
                    <div key={`${pr.exerciseName}-${pr.reps}`} className="text-[13px] font-bold leading-snug text-foreground">
                      {formatPR(pr)}
                    </div>
                  ))}
                  {prList.length > 3 && (
                    <div className="text-[11px] font-semibold text-muted-foreground">
                      +{prList.length - 3} more PR{prList.length - 3 === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              </section>
            )}

            {displayTakeaways.length > 0 && (
              <section className="rounded-2xl border border-border/80 bg-card/70 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                  Today's takeaways
                </div>
                <div className="mt-1.5 space-y-1">
                  {displayTakeaways.slice(0, 2).map((t) => (
                    <div key={t} className="text-[12px] leading-[1.35] text-foreground">
                      {t}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-border/80 bg-card">
              <div className="grid grid-cols-2 divide-x divide-y divide-border/70">
                <CompactStat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Completed" value={`${summary.completionPct}%`} />
                <CompactStat icon={<Activity className="h-3.5 w-3.5" />} label="Sets" value={`${summary.completedSets}/${summary.prescribedSets}`} />
                {summary.totalReps > 0 && (
                  <CompactStat icon={<Repeat2 className="h-3.5 w-3.5" />} label="Reps" value={`${summary.totalReps}`} />
                )}
                {durationMin != null && durationMin > 0 && (
                  <CompactStat icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={`${durationMin}m`} />
                )}
                {summary.avgRpe != null && (
                  <CompactStat icon={<Flame className="h-3.5 w-3.5" />} label="Avg RPE" value={`${summary.avgRpe}`} />
                )}
                {recovery.hasData && (
                  <CompactStat
                    icon={<Heart className="h-3.5 w-3.5" />}
                    label="Recovery"
                    value={`${recovery.score}/100`}
                  />
                )}
              </div>
              {records && records.tonnage_kg > 0 ? (
                <TonnageStat records={records} unit={displayUnit} />
              ) : summary.totalLifted > 0 && (
                <div className="flex items-center gap-3 border-t border-border/70 px-3.5 py-3">
                  <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground">Total tonnage</div>
                    <div className="mt-0.5 truncate text-xl font-black leading-tight text-foreground">{summary.totalLiftedFmt}</div>
                  </div>
                </div>
              )}
            </section>

            {prList.length === 0 && recordCount === 0 && displayTakeaways.length === 0 && (
              <section className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-3 text-center">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Baseline logged</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Your trends and achievements will build as you log more sessions.
                </div>
              </section>
            )}

            {cardio && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs">
                <Heart className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">Cardio</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {cardio.status === "logged"
                      ? cardio.minutes && cardio.minutes > 0 ? `Logged · ${cardio.minutes} min` : "Logged"
                      : cardio.status === "skipped" ? "Skipped" : "Not logged yet"}
                  </div>
                </div>
              </div>
            )}

            {summary.missedExercises.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="min-w-0">
                  <div className="font-bold text-amber-700 dark:text-amber-300">
                    {summary.missedExercises.length} missed / not logged
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {summary.missedExercises.slice(0, 4).join(", ")}
                    {summary.missedExercises.length > 4 ? "…" : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          className="shrink-0 border-t border-border/70 bg-background/95 px-3 pt-2 backdrop-blur sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
        >
          {completionId ? (
            // Right after training is when they're proudest: posting is one tap
            // (with what it earns); the camera opens the full studio.
            <RecapPostFooter
              completionId={completionId}
              completedAt={workoutDate ?? null}
              onDone={() => { onOpenChange(false); onClose?.(); }}
              onStudio={() => { setShareMounted(true); setShareOpen(true); }}
            />
          ) : (
            <>
              <div className="grid w-full grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-xl text-xs font-bold" disabled={sharing} onClick={()=>void shareWorkout()}><Share2 className="mr-1.5 h-4 w-4"/>Share</Button>
                <Button type="button" variant="outline" className="h-10 rounded-xl text-xs font-bold" onClick={()=>void saveWorkoutImage()}><Download className="mr-1.5 h-4 w-4"/>Save photo</Button>
              </div>
              <Button className="mt-2 h-10 w-full rounded-xl text-sm font-bold" onClick={() => { onOpenChange(false); onClose?.(); }}>
                <ChevronLeft className="mr-1.5 h-4 w-4" />Back to workout
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {completionId && shareMounted && (
      <Suspense fallback={null}>
        <WorkoutShareStudio
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          completionId={completionId}
          athleteName={athleteName}
          workoutTitle={workoutTitle}
          unit={displayUnit}
        />
      </Suspense>
    )}
    </>
  );
}

function CompactStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-2.5 py-3 text-center">
      <div className="flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-[0.08em] text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 w-full truncate text-center text-[1rem] font-black leading-tight tabular-nums text-foreground">{value}</div>
    </div>
  );
}

// Compact header used inside admin/coach workout review cards.
export function WorkoutReviewSummaryHeader({
  summary,
  difficulty,
  energy,
  pain,
  durationMin,
}: {
  summary: WorkoutSummary;
  difficulty?: number | null;   // session_rpe (1-10)
  energy?: number | null;       // overall_rating (1-5)
  pain?: boolean | null;
  durationMin?: number | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 mb-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Cell label="Score" value={`${summary.score}/100`} highlight />
        <Cell label="Total Tonnage" value={summary.totalLiftedFmt} />
        <Cell label="Completion" value={`${summary.completionPct}%`} />
        <Cell label="Duration" value={durationMin != null && durationMin > 0 ? `${durationMin} min` : "—"} />
        <Cell
          label="Difficulty"
          value={difficulty != null ? `RPE ${difficulty}/10` : "—"}
        />
        <Cell label="Energy" value={energy != null ? `${energy}/5` : "—"} />
        <Cell label="Avg RPE" value={summary.avgRpe != null ? `${summary.avgRpe}` : "—"} />
        <Cell
          label="Pain"
          value={pain ? "Yes" : "No"}
          tone={pain ? "warn" : "ok"}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, highlight, tone }: { label: string; value: string; highlight?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={
        `text-sm font-black ${highlight ? "text-primary" : ""} ${tone === "warn" ? "text-amber-700 dark:text-amber-300" : ""}`
      }>{value}</div>
    </div>
  );
}
