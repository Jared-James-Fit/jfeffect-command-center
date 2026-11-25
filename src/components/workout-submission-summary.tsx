import { NewAchievementReveal } from "@/components/portal/new-achievement-reveal";
import { useEffect, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trophy, CheckCircle2, ChevronDown, ChevronLeft, Heart, X, CircleX, Medal, Share2, Download, Info, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StudioShell } from "@/components/community/studio-chunks";
import { explainWorkoutScore, type WorkoutSummary } from "@/lib/workout-summary";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PlanCheck } from "@/lib/workouts/plan-vs-actual";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  buildWorkoutTakeaways,
  formatPR,
  type CardioTakeawayInput,
  type SessionPR,
} from "@/lib/workout-takeaways";
import type { WorkoutPoints, WorkoutRecords } from "@/lib/training-records";
import { WorkoutPointsCard } from "@/components/records/workout-points-card";
import { dualTotal, recordedLoad } from "@/lib/dual-weight";
import { SCOPE_LABEL, repRecordLabel, tonnageRecordLabel, topScope, weightRecordLabel } from "@/lib/training-records";
import { drawWorkoutStory, type StoryRecord } from "@/lib/workout-story-card";
import { NewRecordsSection } from "@/components/records/training-records";
import { headlineFromRecords } from "@/lib/community";
import { RecapFilmLine, RecapShare, RecapShareStatus, useRecapShare } from "@/components/community/recap-post";
import { SaveVideosInline, useEligibleSetVideoSaves } from "@/components/workout-day/set-video-phone-copy";
import { useWorkoutFilm, type WorkoutFilm } from "@/lib/workout-film-client";
import { completionMessage, completionStats, recordsLine, recordsText, ringDash, type RecordsLine } from "@/lib/workouts/completion-screen";
import { useCompletionPreview, usePublicSessionTitle } from "@/lib/community.queries";
import { SoundToggleButton } from "@/components/sound-toggle";
import { feedback } from "@/lib/feedback";

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
  /**
   * The unit each logged set was typed in, by set id: a record reads in it
   * (its other unit beside it), whatever the account's unit says.
   */
  setUnit?: (setId: string) => "kg" | "lb" | null;
  /** Prescribed cardio status for the same day, when there is one. */
  cardio?: CardioTakeawayInput;
  /**
   * pl_day_completions.id of this finished workout. When present, the footer
   * offers the optional "Share workout" studio (camera → card → community
   * post and/or Instagram story, one screen). Omit it where sharing isn't supported (memberships, coach
   * "View as client"); the legacy story Share/Save buttons remain there.
   */
  completionId?: string | null;
  /** The workout (its set videos are its film). */
  dayId?: string | null;
  onClose?: () => void;
  /** Edit workout: closes the recap onto the workout, its sets ready to change (finished workouts). */
  onEdit?: () => void;
};

export function WorkoutSubmissionSummary({ open, onOpenChange, summary, workoutTitle, durationMin, workoutDate, sessionRating, sessionRpe, pain, prs, records, points, athleteName, displayUnit = "lb", setUnit, cardio, completionId, dayId, onClose, onEdit }: Props) {
  // Client workouts use the scope-aware server records; the legacy session PR
  // list only remains for surfaces without them (memberships).
  const usesRecords = records !== undefined;
  const prList = usesRecords ? [] : prs ?? [];
  const recordCount = (records?.records?.length ?? 0) + (records?.load_records?.length ?? 0) + (tonnageRecordLabel(records?.tonnage) ? 1 : 0);
  // The PR this workout leads with (headlinePr: an all-time PR at 10 reps or fewer on the session's
  // main lift, or on a barbell squat / bench / deadlift). Only it gets the trophy, the PR headline and
  // the full sting; every other record is still listed under New records, just not shouted.
  const { data: shareStats } = useCompletionPreview(completionId ?? null, open && !!completionId);
  const lead = usesRecords ? headlineFromRecords(records, shareStats?.top_lift?.exercise_name ?? null) : null;
  const bigMoment = usesRecords ? !!lead : prList.length > 0;
  const [revealStage, setRevealStage] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  // fetched while this build is still the live one (a session can outlast a publish), so Share opens
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void WorkoutShareStudio.preload(), 800);
    return () => window.clearTimeout(t);
  }, [open]);
  // A caption started in the recap's footer, carried into the studio.
  const [draftCaption, setDraftCaption] = useState("");
  const shareCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) {
      setRevealStage(0);
      setDisplayScore(0);
      return;
    }
    setRevealStage(0);
    setDisplayScore(0);
    const intro = window.setTimeout(() => setRevealStage(1), 450);
    const details = window.setTimeout(() => setRevealStage(2), 1450);
    return () => {
      window.clearTimeout(intro);
      window.clearTimeout(details);
      // The sting stops the moment the recap closes.
      stingPlayedRef.current = false;
      stopStingRef.current();
      stopStingRef.current = () => {};
    };
  }, [open]);

  // The sting lands with the reveal, once the records are in (they're worked
  // out on the server and can trail the reveal): a PR day gets the full
  // build-and-drop, never the short one by mistake. Waits at most 2 s.
  useEffect(() => {
    if (!open || revealStage < 1 || stingPlayedRef.current) return;
    const fire = () => {
      if (stingPlayedRef.current) return;
      stingPlayedRef.current = true;
      // the finish's tap lands with the reveal (a headline PR its success tap); the sting is its sound
      feedback(stingRef.current === "pr" ? "pr" : "workout", { sound: false });
      void import("@/lib/achievement-music").then(({ playSting }) => {
        if (stingPlayedRef.current) stopStingRef.current = playSting(stingRef.current);
      });
    };
    // (and the session's main lift, which says which record is the headline)
    if (!usesRecords || (records !== null && (!completionId || shareStats !== undefined))) { fire(); return; }
    const wait = window.setTimeout(fire, 2000);
    return () => window.clearTimeout(wait);
  }, [open, revealStage, usesRecords, records, completionId, shareStats]);

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
  // A headline PR gets the full build-and-drop; a finished workout (a quieter record or two included) the short one.
  const stingRef = useRef<"pr" | "workout">("workout");
  stingRef.current = bigMoment ? "pr" : "workout";
  const stopStingRef = useRef<() => void>(() => {});
  const stingPlayedRef = useRef(false);
  const hasAchievement = prList.length > 0 || recordCount > 0 || summary.score >= 90 || summary.completionPct === 100;
  const headline =
    lead ? `${lead.exercise_name} PR`
    : prList.length > 0 ? (prList.length === 1 ? "New all-time PR" : `${prList.length} new all-time PRs`)
    // the score counts what was done, not how hard it ran: no cheering over a plan that ran hot
    : summary.plan?.lines.some((l) => l.kind === "harder" || l.kind === "short") ? "Workout done"
    : summary.score >= 90 ? "Crushed it!"
    : summary.score >= 75 ? "Great work!"
    : summary.score >= 50 ? "Solid effort"
    : "Logged — keep going";
  const takeaways = buildWorkoutTakeaways(summary, prList, cardio ?? null);
  // No stars here (Nov 25 2026): the ring is the score, and stars beside it said the same thing twice.
  const dateLabel = (() => {
    if (!workoutDate) return null;
    try { return format(new Date(workoutDate), "EEE, MMM d, yyyy"); } catch { return null; }
  })();

  const displayTakeaways = prList.length > 0
    ? takeaways.filter((t) => !/^🏆/.test(t.trim()))
    : takeaways;

  // Instagram Story card (1080×1920, safe-zone aware) — see workout-story-card.
  // a record in the unit its set was typed in, the other unit beside it ("315 lb (142.9 kg)")
  const recordLoad = (kg: number, setId: string) => {
    const d = recordedLoad(kg, setUnit?.(setId), displayUnit);
    return `${d.primary} (${d.secondary})`;
  };
  const dualLoadTotalText = (kg: number, u: "kg" | "lb") => {
    const t = dualTotal(kg, u);
    return `${t.primary} (${t.secondary})`;
  };
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
        out.push({ label, tier: scope, title: r.exercise_name, detail: `${recordLoad(r.load_kg, r.set_id)} × ${r.reps}` });
        if (load && loadScope && loadScope !== scope) {
          out.push({ label: weightRecordLabel(load)!, tier: loadScope, title: load.exercise_name, detail: `Heaviest ever · ${recordLoad(load.load_kg, load.set_id)}` });
        }
      }
      for (const l of loads.values()) {
        const scope = topScope(l);
        if (scope) out.push({ label: weightRecordLabel(l)!, tier: scope, title: l.exercise_name, detail: `Heaviest ever · ${recordLoad(l.load_kg, l.set_id)} × ${l.reps}` });
      }
      const ton = tonnageRecordLabel(records.tonnage);
      const tonScope = topScope(records.tonnage);
      if (ton && tonScope) out.push({ label: ton.replace("WORKOUT ", ""), tier: tonScope, title: "Workout Tonnage", detail: dualLoadTotalText(records.tonnage_kg, displayUnit) });
    } else if (prList[0]) {
      prList.slice(0, 4).forEach((pr) => out.push({ label: "ALL-TIME PR", tier: "atpr", title: formatPR(pr), detail: "" }));
    }
    const rank = { atpr: 0, program_pr: 1, block_pr: 2 } as const;
    return out.sort((a, b) => rank[a.tier] - rank[b.tier]);
  };

  const { data: publicTitle } = usePublicSessionTitle({ completionId }, open);
  const buildShareBlob = async (): Promise<Blob | null> => {
    const canvas = shareCanvasRef.current ?? document.createElement("canvas");
    shareCanvasRef.current = canvas;
    const ton = records && records.tonnage_kg > 0 ? dualTotal(records.tonnage_kg, displayUnit) : null;
    const tonnage = ton ? ton.primary : summary.totalLifted > 0 ? summary.totalLiftedFmt : null;
    const stats = [
      { label: "Sets", value: `${summary.completedSets}/${summary.prescribedSets}` },
      ...(tonnage ? [{ label: "Tonnage", value: tonnage, sub: ton?.secondary ?? null }] : []),
      ...(durationMin && durationMin > 0 ? [{ label: "Minutes", value: String(Math.round(durationMin)) }] : []),
    ];
    await drawWorkoutStory(canvas, {
      athleteName: athleteName?.trim() || null,
      headline,
      score: summary.score,
      // the shareable image says where they are in the program, not the coach's day name
      workoutTitle: publicTitle ?? null,
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

  // ---- the screen's words and numbers (completion-screen.ts): achievement, then performance ----
  const film = useWorkoutFilm(completionId ?? null, dayId ?? null);
  const message = completionMessage({
    headlinePr: bigMoment,
    completedSets: summary.completedSets,
    prescribedSets: summary.prescribedSets,
    score: summary.score,
    planLines: summary.plan?.lines ?? null,
    pain,
  });
  const recLine: RecordsLine | null = usesRecords
    ? recordsLine(records, lead?.exercise_name ?? null)
    : prList.length > 0
      ? { count: prList.length, names: [...new Set(prList.map((p) => p.exerciseName))], allTime: true }
      : null;
  const volume = records && records.tonnage_kg > 0 ? dualTotal(records.tonnage_kg, displayUnit).primary : summary.totalLifted > 0 ? summary.totalLiftedFmt : null;
  const stats = completionStats({
    durationMin,
    completedSets: summary.completedSets,
    prescribedSets: summary.prescribedSets,
    filmed: completionId ? film.clips + film.uploading : 0,
    volume,
    prs: recLine?.count ?? 0,
    leaguePoints: points?.league.total ?? 0,
  });
  const [recordsOpen, setRecordsOpen] = useState(false);
  const ring = ringDash(displayScore, 42);
  const close = () => { onOpenChange(false); onClose?.(); };
  const filmRetry = async () => {
    const res = await film.postNow();
    if (res?.status === "posted") toast.success("Your film is in the feed");
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) onClose?.(); }}>
      <DialogContent
        className="bottom-0 top-auto flex w-full max-w-none translate-x-[-50%] translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-[24px] border-border/80 bg-background p-0 shadow-2xl sm:bottom-auto sm:top-1/2 sm:max-w-[520px] sm:-translate-y-1/2 sm:rounded-[24px] [&>button]:hidden"
        style={{ height: "min(96dvh, 820px)", maxHeight: "96dvh" }}
      >
        {/* the only scroll on the screen: everything but Done (no box scrolls inside it) */}
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden" data-recap-body>
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-muted-foreground/20 sm:hidden" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full text-muted-foreground"
            onClick={close}
            aria-label="Close workout summary"
          >
            <X className="h-4 w-4" />
          </Button>
          <SoundToggleButton className="absolute left-3 top-3 z-10" onMute={() => stopStingRef.current()} />

          {/* 1. Achievement: done, the workout, the score, one honest line */}
          <header className={`mx-auto flex w-full max-w-[calc(100%-4.5rem)] flex-col items-center text-center transition-all duration-500 ${revealStage >= 1 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`} data-recap-header>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground" data-recap-moment={bigMoment ? "pr" : "done"}>
              {bigMoment ? <Trophy className="h-4 w-4 text-amber-500 animate-in zoom-in duration-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
              Workout complete
            </div>
            <DialogHeader className="mx-auto mt-1 flex min-h-0 w-full flex-col items-center space-y-0 !pl-0 text-center sm:text-center">
              <DialogTitle className="block w-full text-center text-xl font-bold leading-tight tracking-tight">{workoutTitle ?? "Workout"}</DialogTitle>
              {dateLabel && <DialogDescription className="mt-0.5 text-[12px]">{dateLabel}</DialogDescription>}
            </DialogHeader>
          </header>

          <div className={`mt-3 flex flex-col items-center transition-all duration-500 ${revealStage >= 1 ? "opacity-100" : "opacity-0"}`}>
            {/* the score: one tap on it for how it's scored; the formula is unchanged */}
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex flex-col items-center rounded-2xl px-2 pt-0.5 active:bg-muted/60" aria-label={`Workout score ${summary.score} out of 100. How it's scored`} data-score-help>
                  <span className="relative grid h-[104px] w-[104px] place-items-center">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
                      <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" className="stroke-muted" />
                      <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" strokeLinecap="round" className={bigMoment ? "stroke-amber-500" : "stroke-primary"} strokeDasharray={ring.dash} />
                    </svg>
                    <span className="flex flex-col items-center leading-none tabular-nums">
                      <span className="text-[34px] font-bold leading-none text-foreground">{displayScore}</span>
                      <span className="mt-1 text-[10px] font-semibold text-muted-foreground">/100</span>
                    </span>
                  </span>
                  <span className="mt-1 inline-flex min-h-6 items-center gap-1 text-[12px] font-medium text-muted-foreground">
                    Workout score <Info className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" className="w-[min(300px,calc(100vw-32px))] space-y-1.5 p-3 text-left text-[13px] leading-snug" data-score-help-text>
                <div className="font-semibold">How it's scored</div>
                {explainWorkoutScore(summary, { pain, ownRating: sessionRating, stars: false }).map((l) => (
                  <p key={l} className="text-muted-foreground">{l}</p>
                ))}
              </PopoverContent>
            </Popover>
            <p className="mt-1.5 text-[15px] font-semibold text-foreground" data-recap-message>{message}</p>
            <div className="flex flex-wrap items-center justify-center gap-1">
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted-foreground active:bg-muted"
                  data-recap-edit
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Edit workout
                </button>
              )}
            </div>
          </div>

          {/* 2. Performance: the numbers this workout has, records, then anything worth a look */}
          <div className={`mt-3 space-y-2.5 transition-all duration-500 ${revealStage >= 2 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
            {stats.length > 0 && (
              <section className="flex divide-x divide-border/70 rounded-2xl border border-border/80 bg-card py-2.5" data-recap-stats={stats.map((x) => x.key).join(" ")}>
                {stats.map((x) => (
                  <div key={x.key} className="flex min-w-0 flex-1 flex-col items-center px-1 text-center" data-recap-stat={x.key}>
                    <span className="w-full truncate text-[16px] font-bold leading-tight tabular-nums text-foreground">{x.value}</span>
                    <span className="mt-0.5 text-[11px] font-medium text-muted-foreground">{x.label}</span>
                  </div>
                ))}
              </section>
            )}

            {recLine && (
              <section className={cn("overflow-hidden rounded-2xl border", bigMoment ? "border-amber-500/40 bg-amber-500/[0.07]" : "border-border/80 bg-card")} data-recap-records={bigMoment ? "headline" : "quiet"}>
                <button type="button" onClick={() => setRecordsOpen((v) => !v)} className="flex min-h-12 w-full items-center gap-2.5 px-3 text-left" aria-expanded={recordsOpen}>
                  <Medal className={cn("h-4 w-4 shrink-0", bigMoment ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} aria-hidden />
                  <span className={cn("min-w-0 flex-1 text-[13px] font-semibold leading-snug", bigMoment ? "text-amber-800 dark:text-amber-200" : "text-foreground")}>{recordsText(recLine)}</span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", recordsOpen && "rotate-180")} aria-hidden />
                </button>
                {recordsOpen && (
                  <div className="space-y-2 px-2 pb-2">
                    {records && <NewRecordsSection records={records} unit={displayUnit} setUnit={setUnit} highlight={!!lead} />}
                    {prList.length > 0 && (
                      <ul className="space-y-1 px-1.5 pb-1">
                        {prList.map((pr) => (
                          <li key={`${pr.exerciseName}-${pr.reps}`} className="text-[13px] font-semibold leading-snug text-foreground">{formatPR(pr)}</li>
                        ))}
                      </ul>
                    )}
                    {points && <WorkoutPointsCard points={points} />}
                  </div>
                )}
              </section>
            )}

            <NewAchievementReveal open={open} />

            {/* how it went against the plan, only when it strayed (the line above says when it didn't) */}
            {summary.plan && summary.plan.setsPlanned > 0 ? (
              !summary.plan.asPlanned && (summary.plan.lines.length > 0 || summary.plan.next) && <PlanSection plan={summary.plan} />
            ) : displayTakeaways.length > 0 && (
              <section className="rounded-2xl border border-border/80 bg-card/70 px-3 py-2.5">
                {displayTakeaways.slice(0, 2).map((t) => (
                  <div key={t} className="text-[12px] leading-[1.35] text-foreground">{t}</div>
                ))}
              </section>
            )}

            {summary.missedExercises.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="min-w-0">
                  <span className="font-bold text-amber-700 dark:text-amber-300">{summary.missedExercises.length} not logged</span>
                  <span className="text-muted-foreground"> · {summary.missedExercises.slice(0, 3).join(", ")}{summary.missedExercises.length > 3 ? "…" : ""}</span>
                </div>
              </div>
            )}

            {cardio && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs">
                <Heart className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-semibold">Cardio</span>
                <span className="truncate text-muted-foreground">
                  {cardio.status === "logged"
                    ? cardio.minutes && cardio.minutes > 0 ? `Logged · ${cardio.minutes} min` : "Logged"
                    : cardio.status === "skipped" ? "Skipped" : "Not logged yet"}
                </span>
              </div>
            )}

            {/* 3. Sharing, optional: the film, where it already is, one Share workout */}
            {completionId ? (
              <ClientShareSection
                completionId={completionId}
                completedAt={workoutDate ?? null}
                unit={displayUnit}
                workoutTitle={workoutTitle}
                athleteName={athleteName}
                dayId={dayId ?? null}
                film={film}
                onFilmRetry={() => void filmRetry()}
                onStudio={(caption) => { setDraftCaption(caption); setShareMounted(true); setShareOpen(true); }}
              />
            ) : (
              <div className="grid w-full grid-cols-2 gap-2 pt-1">
                <Button type="button" variant="outline" className="h-11 rounded-xl text-[13px] font-semibold" disabled={sharing} onClick={()=>void shareWorkout()}><Share2 className="mr-1.5 h-4 w-4"/>Share</Button>
                <Button type="button" variant="outline" className="h-11 rounded-xl text-[13px] font-semibold" onClick={()=>void saveWorkoutImage()}><Download className="mr-1.5 h-4 w-4"/>Save photo</Button>
              </div>
            )}
          </div>
        </div>

        {/* 4. Done: one full-width button, clear of the home indicator */}
        <DialogFooter
          className="shrink-0 border-t border-border/70 bg-background px-4 pt-2.5 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <Button className="h-12 w-full rounded-xl text-[15px] font-semibold" onClick={close} data-recap-done>
            {completionId ? "Done" : <><ChevronLeft className="mr-1.5 h-4 w-4" />Back to workout</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {completionId && shareMounted && (
      <StudioShell onClose={() => setShareOpen(false)}>
        <WorkoutShareStudio
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          completionId={completionId}
          athleteName={athleteName}
          workoutTitle={workoutTitle}
          unit={displayUnit}
          draftCaption={draftCaption}
        />
      </StudioShell>
    )}
    </>
  );
}

/**
 * The recap's sharing for a client workout: the film's line, where it already
 * is (said once), one Share workout, and the one-time "Save N videos to
 * device". Its own component so its hooks run only where sharing exists.
 */
function ClientShareSection({
  completionId,
  completedAt,
  unit,
  workoutTitle,
  athleteName,
  dayId,
  film,
  onFilmRetry,
  onStudio,
}: {
  completionId: string;
  completedAt: string | Date | null;
  unit: "kg" | "lb";
  workoutTitle?: string | null;
  athleteName?: string | null;
  dayId: string | null;
  film: WorkoutFilm;
  onFilmRetry: () => void;
  onStudio: (caption: string) => void;
}) {
  const share = useRecapShare({ completionId, completedAt, unit, workoutTitle, athleteName });
  const videos = useEligibleSetVideoSaves(dayId);
  const postFilm = async () => {
    const res = await film.postNow();
    if (res?.status === "posted") toast.success("Your film is in the feed");
    else if (res?.status === "up_to_date") toast.success("It's already in the feed");
    else if (res?.status === "no_crew") toast.error("Crew isn't on for your account.");
    else if (res?.status === "no_clips") toast.error("No clips fit a Crew post yet (90 seconds a clip).");
  };
  return (
    <div className="space-y-2 pt-1" data-recap-sharing>
      {film.clips + film.uploading > 0 && (
        <RecapFilmLine film={film} onRetry={onFilmRetry} className="rounded-2xl border border-border/80 bg-card px-3 py-1.5" />
      )}
      <RecapShareStatus share={share} film={film} />
      <RecapShare
        share={share}
        film={film}
        onFilmPost={postFilm}
        videos={videos.targets}
        onWarmVideos={() => videos.warm(videos.targets)}
        onSaveVideos={() => videos.save(videos.targets)}
        onStudio={onStudio}
      />
      <SaveVideosInline dayId={dayId} workoutKey={completionId} />
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
        `text-sm font-bold ${highlight ? "text-primary" : ""} ${tone === "warn" ? "text-amber-700 dark:text-amber-300" : ""}`
      }>{value}</div>
    </div>
  );
}

/** "Done as planned", or what strayed from it, and one line for next time. */
function PlanSection({ plan }: { plan: PlanCheck }) {
  const onTarget = [plan.checked.reps && "reps", plan.checked.effort && "effort"].filter(Boolean).join(" and ");
  return (
    <section className="rounded-2xl border border-border/80 bg-card/70 p-3" data-plan-check={plan.asPlanned ? "as-planned" : "off"}>
      {/* the set count is the Sets tile's; this is only how it went against the plan */}
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        {plan.asPlanned && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
        {plan.asPlanned ? "Done as planned" : "Vs the plan"}
        {plan.asPlanned && onTarget && <span className="font-normal text-muted-foreground">· {onTarget} on target</span>}
      </div>
      {plan.lines.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {plan.lines.slice(0, 3).map((l) => (
            <li key={l.text} className="flex items-start gap-2 text-[12px] leading-snug text-foreground" data-plan-line={l.kind}>
              <span aria-hidden className={cn("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", l.kind === "easier" || l.kind === "extra" ? "bg-muted-foreground/50" : "bg-warning")} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.next && <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{plan.next}</p>}
    </section>
  );
}
