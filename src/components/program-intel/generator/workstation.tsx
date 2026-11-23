/**
 * Program Intelligence, laid out the way a coach works (Nov 23 2026): what you
 * want (typed or spoken to Cleo) → the program's setup → the athlete at a
 * glance → what stands out (one card per issue, facts apart from
 * interpretations) → generate, review and assign. The detailed reads and the
 * full report sit under "Evidence and full report", loaded only when opened.
 * Generate Next Program is this same page (/next-program opens it on the
 * generate step).
 *
 * Under it, the generator's own workflow: Athlete data → performance
 * analysis → programming strategy → program construction → quality audit →
 * coach review → final draft.
 *
 * Everything above the actions is read from the records on the phone (no AI):
 * who the athlete is, what the last program tells us, data quality, patterns,
 * and a recommended setup the coach can accept or change. The fast path
 * builds with the recommended strategy in one tap; "Review strategy first"
 * shows the strategy to approve or edit before anything is built. The result
 * is a hidden draft with a quality scorecard; nothing is assigned until the
 * coach does it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FilePlus2, ListChecks, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { assignIntelDraftFn, discardIntelDraftFn, queueIntelJobFn, retryIntelJobFn } from "@/lib/program-intel/intel.functions";
import { generatedProgramOutcomes } from "@/lib/program-intel/outcomes";
import { findConflicts, horizonFor, redistribution, type GenerationSetup, type SetupField } from "@/lib/program-intel/recommend";
import { DEFAULT_PROGRAM_WEEKS, MAX_PROGRAM_WEEKS } from "@/lib/program-intel/horizon";
import type { Strategy } from "@/lib/program-intel/generator-schemas";
import type { Brain } from "@/lib/program-intel/types";
import { useBrainOverride, useGeneratorIntel, useIntelJobs, useIntelRecords, useJobContext, useObservations, useSaveEquipmentProfile, useSaveLongTermGoal, type IntelJob } from "../use-program-intel";
import { DraftView, PipelineProgress } from "./draft-view";
import { ContextInspector } from "./inspector";
import { OutcomesCard } from "./outcomes-card";
import { DataQualityCard, DevelopmentCard, PatternsCard, ProgramReviewCard } from "./overview";
import { AdvancedControls, ConflictsCard, EquipmentSheet, SetupCard } from "./setup";
import { StrategyReview } from "./strategy-view";
import { FullReport, type IntelSearch } from "../ProgramIntelligencePage";
import { CoachDirectionCard, clearDirectionDraft, readDirectionDraft } from "../workflow/coach-direction";
import { SetupSheet, SetupSummary, setupTiles } from "../workflow/setup-summary";
import { AthleteSnapshot } from "../workflow/athlete-snapshot";
import { InsightList } from "../workflow/insight-cards";
import { buildInsights } from "@/lib/program-intel/insights";
import { directionSend, runInstructions, sameInstructions, type DirectionStage } from "@/lib/program-intel/direction-send";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { EditWithAiSheet } from "@/components/program-ai/edit-with-ai";
import { cn } from "@/lib/utils";

const HISTORY = { kind: "history" } as const;

const REPORT_DEFAULT: IntelSearch = { scope: "program", from: "", to: "", tab: "summary" };

/**
 * prefill: what Adjust program handed over ("rebuild the next 12 weeks…"): the coach's words as notes, and the weeks / days it read from them.
 * reportSearch: the full report's period and tab (Program Intelligence's address); a tab other than the summary opens the report.
 */
export function NextProgramWorkstation({ clientId, prefill, reportSearch }: { clientId: string; prefill?: { notes?: string; weeks?: number; days?: number; duration?: "goal" }; reportSearch?: IntelSearch }) {
  const { viewOnly, role } = useAuth();
  const cleo = useCleoAccess();
  // The run's inspector (models, prompts, calls) is AI infrastructure: the admin's, never a coach's.
  const canInspect = role === "admin";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const records = useIntelRecords(clientId, HISTORY);
  const brain = useBrainOverride(clientId);
  const intel = useGeneratorIntel(records.data, brain.override);
  const jobs = useIntelJobs(clientId);
  const observations = useObservations(clientId);
  const saveEquipment = useSaveEquipmentProfile(clientId);
  const saveGoal = useSaveLongTermGoal(clientId);
  const queue = useServerFn(queueIntelJobFn);
  const retry = useServerFn(retryIntelJobFn);
  const assign = useServerFn(assignIntelDraftFn);
  const discard = useServerFn(discardIntelDraftFn);
  const [setup, setSetup] = useState<GenerationSetup | null>(null);
  const [edited, setEdited] = useState<Set<SetupField>>(new Set());
  const editedRef = useRef(edited);
  editedRef.current = edited;
  const [privacySafe, setPrivacySafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [inspecting, setInspecting] = useState<IntelJob | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Adjust program on the program they're on now (the instructions box's "change the current program")
  const [adjust, setAdjust] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(() => !!reportSearch && reportSearch.tab !== "summary");
  const generateRef = useRef<HTMLDivElement | null>(null);
  // /next-program opens on the generate step
  useEffect(() => {
    if (!prefill && reportSearch) return;
    const t = window.setTimeout(() => generateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The recommendation follows the records (and the framework); what the coach changed stays theirs.
  useEffect(() => {
    if (!intel) return;
    setSetup((prev) => {
      const rec = intel.recommendation.setup;
      if (!prev) return rec;
      const next = { ...rec } as any;
      for (const k of editedRef.current) next[k] = (prev as any)[k];
      return next;
    });
  }, [intel]);

  const change = <K extends SetupField>(field: K, value: GenerationSetup[K]) => {
    setSetup((s) => {
      if (!s || !intel) return s;
      const next = { ...s, [field]: value } as GenerationSetup;
      const ed = editedRef.current;
      // blocks the coach set must still add up; otherwise the AI picks them for the new length
      if (field === "weeks" && !ed.has("blocks")) next.blocks = [];
      if (field === "daysPerWeek" && !ed.has("trainingDays") && next.trainingDays.length !== next.daysPerWeek) {
        const pool = intel.ctx.schedule.committedDays.length === next.daysPerWeek ? intel.ctx.schedule.committedDays : intel.ctx.schedule.observedWeekdays.length === next.daysPerWeek ? intel.ctx.schedule.observedWeekdays : [];
        next.trainingDays = pool;
      }
      return next;
    });
    // a setting put back to the recommendation is no longer the coach's change
    const same = intel ? JSON.stringify(intel.recommendation.setup[field]) === JSON.stringify(value) : false;
    setEdited((e) => {
      const n = new Set(e);
      if (same) n.delete(field);
      else n.add(field);
      return n;
    });
  };
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !setup || !intel || !prefill) return;
    prefilled.current = true;
    if (prefill.notes?.trim()) change("coachNotes", prefill.notes.trim().slice(0, 2000));
    // "Create the next program based on the goal timeline" / "Build the remaining 17 weeks until Nationals" / "a 6-week block"
    if (prefill.duration === "goal") {
      change("durationMode", "goal");
      change("weeks", horizonFor(intel.ctx, "goal", null, setup.startDate).weeks);
    } else if (prefill.weeks && prefill.weeks >= 1 && prefill.weeks <= MAX_PROGRAM_WEEKS) {
      change("durationMode", prefill.weeks === DEFAULT_PROGRAM_WEEKS ? "default" : "custom");
      change("weeks", prefill.weeks);
    }
    if (prefill.days && prefill.days >= 1 && prefill.days <= 7) change("daysPerWeek", prefill.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, intel, prefill]);
  // what the coach typed last time and didn't generate with yet (kept on this device)
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current || !setup || !intel || prefill?.notes) return;
    draftLoaded.current = true;
    const d = readDirectionDraft(clientId);
    if (d.trim() && !setup.coachNotes.trim()) change("coachNotes", d.slice(0, 2000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, intel]);
  const setBrain = (b: Brain) => {
    brain.set.mutate(b === intel?.classification.auto ? null : b, { onError: (e: any) => toast.error(e?.message ?? "Couldn't save") });
    setEdited((e) => {
      const n = new Set(e);
      if (b === intel?.classification.auto) n.delete("brain");
      else n.add("brain");
      return n;
    });
  };
  const resetSetup = () => {
    setEdited(new Set());
    if (intel) setSetup(intel.recommendation.setup);
    if (brain.override) brain.set.mutate(null);
  };

  const conflicts = useMemo(() => {
    if (!intel || !setup) return [];
    const lookup = (r: { id: string | null; name: string }) => (r.id ? intel.exercises.get(r.id) : undefined) ?? { name: r.name, equipment: null };
    return findConflicts(setup, intel.ctx, intel.recommendation.baseline, lookup, intel.recommendation.setup);
  }, [intel, setup]);
  const red = useMemo(() => (intel && setup ? redistribution(setup, intel.recommendation.baseline) : null), [intel, setup]);
  const blockers = conflicts.filter((c) => c.severity === "blocker");
  // where an assigned program goes: after the one running now, aligned to the deadline on file
  const assignPlan = useMemo(() => {
    if (!intel) return undefined;
    const h = horizonFor(intel.ctx, "goal");
    return { start: h.start, currentEnd: intel.ctx.schedule.currentEnd ?? null, deadline: h.deadline ? { name: h.deadline.name, date: h.deadline.date } : null };
  }, [intel]);

  const approved = useMemo(
    () => (observations.data ?? []).filter((o) => (o.status === "approved" || o.status === "corrected") && o.kind !== "decision").map((o) => ({ statement: o.corrected_statement ?? o.statement, date: o.reviewed_at?.slice(0, 10) ?? o.created_at.slice(0, 10), category: o.category })),
    [observations.data],
  );
  const insights = useMemo(() => (intel ? buildInsights(intel, approved) : []), [intel, approved]);
  const tiles = useMemo(() => (intel && setup ? setupTiles(intel, setup, edited, conflicts) : []), [intel, setup, edited, conflicts]);
  const addToNotes = (line: string) => {
    if (!setup) return;
    const t = setup.coachNotes.trim();
    if (t.includes(line)) return;
    change("coachNotes", (t ? `${t}\n${line}` : line).slice(0, 2000));
    toast.success("Added to your instructions");
  };
  const all = jobs.data ?? [];
  const consumed = new Set(all.filter((j) => j.kind === "generate" && j.strategy_job_id).map((j) => j.strategy_job_id as string));
  const activeGenerate = all.find((j) => j.kind === "generate" && ["pending", "running", "error", "ready"].includes(j.status)) ?? null;
  const activeStrategy = activeGenerate ? null : all.find((j) => j.kind === "strategy" && ["pending", "running", "error", "ready"].includes(j.status) && !consumed.has(j.id)) ?? null;
  // a run that finishes (or stops) while the coach is watching says so, with a way straight to it
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const j of [activeGenerate, activeStrategy]) {
      if (!j) continue;
      const before = seen.current.get(j.id);
      seen.current.set(j.id, j.status);
      if (before !== "pending" && before !== "running") continue;
      if (j.status === "ready") {
        const blockId: string | undefined = j.result?.blockIds?.[0];
        if (j.kind === "generate" && blockId)
          toast.success("The program is ready", {
            description: "Hidden from the client until you assign it.",
            action: { label: "Open it", onClick: () => void navigate({ to: "/admin/blocks/$blockId", params: { blockId } }) },
            duration: 12_000,
          });
        else toast.success(j.kind === "strategy" ? "The strategy is ready to review" : "The program is ready", { duration: 8_000 });
        document.querySelector<HTMLElement>('[data-testid="gen-scorecard"], [data-testid="gen-strategy"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (j.status === "error") toast.error("The run stopped", { description: "What happened is on the card, with Try again.", duration: 8_000 });
    }
  }, [activeGenerate, activeStrategy, navigate]);
  const earlier = all.filter((j) => j.kind === "generate" && j !== activeGenerate && j.status !== "discarded");
  const strategyCtx = useJobContext(activeStrategy?.status === "ready" ? activeStrategy.id : null);
  const assigned = all.filter((j) => j.kind === "generate" && j.status === "assigned");
  const outcomes = useMemo(() => (records.data ? generatedProgramOutcomes(records.data, assigned as any) : []), [records.data, assigned]);
  const recordedKeys = useMemo(() => new Set((observations.data ?? []).map((o) => o.finding_key ?? "").filter((k) => k.startsWith("outcome:"))), [observations.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["program-intel-jobs", clientId] });
    void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
  };
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      refresh();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work");
      return false;
    } finally {
      setBusy(false);
    }
  };
  type RunExtra = { strategy?: Strategy; strategyJobId?: string; setup?: GenerationSetup; edited?: string[] };
  const queueRun = (kind: "strategy" | "generate", extra: RunExtra = {}) => {
    const runSetup = extra.setup ?? setup!;
    return queue({
      data: {
        clientId,
        kind,
        scope: { kind: "history" },
        brain: runSetup.brain,
        options: { setup: runSetup, edited: extra.edited ?? [...edited], ...(extra.strategy ? { strategy: extra.strategy, strategyJobId: extra.strategyJobId } : {}), dataHash: intel?.dataHash },
        privacySafe,
      },
    }).then((r) => {
      // the instructions are on the run now: the draft on this phone is done with. A run started
      // from older words (an approved strategy keeps what it was written with) leaves the new ones kept.
      if (sameInstructions(runSetup.coachNotes, setup?.coachNotes)) clearDirectionDraft(clientId);
      return r;
    });
  };
  const start = (kind: "strategy" | "generate", extra: RunExtra = {}, ok?: string) =>
    run(() => queueRun(kind, extra), ok ?? (kind === "strategy" ? "Writing the strategy. You can leave; it keeps going." : "Building the program. You can leave; it keeps going."));

  if (viewOnly)
    return (
      <>
        <PageHeader title="Program Intelligence" backTo={`/admin/client-programs/${clientId}`} backLabel="Training Program" />
        <div className="p-4 text-sm text-muted-foreground">Generating programs is for coaches. It isn't available in a view-only login.</div>
      </>
    );

  const name = records.data?.client.full_name ?? "";
  const running = (j: IntelJob | null) => !!j && (j.status === "pending" || j.status === "running");
  const busyRun = running(activeGenerate) || running(activeStrategy);
  // where the generate step stands: setup → (strategy) → build → review → assigned
  const stage: "setup" | "strategy" | "building" | "review" = activeGenerate?.status === "ready" ? "review" : running(activeGenerate) ? "building" : activeStrategy ? "strategy" : "setup";
  const STEPS: Array<[typeof stage, string]> = [["setup", "Set up"], ["strategy", "Strategy"], ["building", "Build"], ["review", "Review"]];
  const stepAt = STEPS.findIndex(([k]) => k === stage);
  // what Send does with the instructions right now (direction-send.ts)
  const directionStage: DirectionStage = running(activeGenerate)
    ? "building"
    : activeGenerate?.status === "ready"
      ? "draft_ready"
      : activeGenerate?.status === "error"
        ? "draft_error"
        : running(activeStrategy)
          ? "strategy_running"
          : activeStrategy?.status === "ready"
            ? "strategy_ready"
            : activeStrategy?.status === "error"
              ? "strategy_error"
              : "setup";
  const directionJob = activeGenerate ?? activeStrategy;
  const sendInfo = setup ? directionSend({ stage: directionStage, notes: setup.coachNotes, used: runInstructions(directionJob), blocked: blockers.length > 0, cleo }) : null;
  const strategyStale = !!activeStrategy && activeStrategy.status === "ready" && !!setup?.coachNotes.trim() && !sameInstructions(setup.coachNotes, runInstructions(activeStrategy));
  const toRun = () => window.setTimeout(() => generateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  const rewriteStrategy = (ok = "Writing a new strategy") =>
    activeStrategy ? run(async () => { await discard({ data: { jobId: activeStrategy.id } }); await queueRun("strategy"); }, ok) : Promise.resolve(false);
  const sendDirection = async () => {
    const who = cleo ? "Cleo's" : "It's";
    let ok = false;
    switch (sendInfo?.action) {
      case "strategy":
        ok = await start("strategy", {}, `Sent. ${who} writing the strategy with your instructions. You can leave; it keeps going.`);
        break;
      case "rewrite":
        ok = await rewriteStrategy(`Sent. ${who} rewriting the strategy with your instructions.`);
        break;
      case "rebuild":
        ok = await start("generate", {}, "Sent. Building a new draft with your instructions. The last one is under Earlier programs.");
        break;
      case "restart": {
        const stopped = directionJob;
        if (!stopped) return;
        ok = await run(async () => { await discard({ data: { jobId: stopped.id } }); await queueRun(stopped.kind === "strategy" ? "strategy" : "generate"); }, "Sent. Starting over with your instructions.");
        break;
      }
      default:
        return;
    }
    if (ok) toRun();
  };
  return (
    <>
      <PageHeader title="Program Intelligence" subtitle={name || undefined} backTo={`/admin/client-programs/${clientId}`} backLabel="Training Program" />
      <div className="mx-auto w-full max-w-3xl space-y-4 p-3 pb-28 sm:p-6" data-testid="next-program-workstation">
        {records.isLoading || !intel || !setup ? (
          records.isError ? (
            <Card className="space-y-2 p-4 text-sm">
              <div className="font-semibold text-destructive">Couldn't read this client's records</div>
              <div className="text-xs text-muted-foreground">{(records.error as Error)?.message}</div>
              <Button size="sm" variant="outline" onClick={() => records.refetch()}>Try again</Button>
            </Card>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )
        ) : (
          <>
            {/* a run under way or a draft waiting: said first, the detail is in step 5 */}
            {(busyRun || activeGenerate?.status === "ready" || activeGenerate?.status === "error" || activeStrategy?.status === "ready") && (
              <button
                type="button"
                onClick={() => generateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm"
                data-workflow-status={stage}
              >
                {busyRun ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0 text-success" />}
                <span className="min-w-0 flex-1 truncate">
                  {running(activeGenerate) ? "Building the program…" : running(activeStrategy) ? "Writing the strategy…" : activeGenerate?.status === "ready" ? "A draft is ready to review" : activeGenerate?.status === "error" ? "The last run stopped" : "The strategy is ready to review"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Go to it ↓</span>
              </button>
            )}

            {/* 1. What the coach wants */}
            <CoachDirectionCard
              intel={intel}
              clientId={clientId}
              value={setup.coachNotes}
              onChange={(v) => change("coachNotes", v)}
              onAdjustCurrent={intel.ctx.previous || intel.ctx.schedule.currentEnd ? (text) => setAdjust(text) : undefined}
              send={sendInfo}
              sending={busy}
              onSend={() => void sendDirection()}
            />

            {/* 2. The program's setup */}
            <SetupSummary tiles={tiles} editedCount={edited.size} onEdit={() => setSetupOpen(true)} onReset={resetSetup} />
            {conflicts.length > 0 && <ConflictsCard conflicts={conflicts} />}

            {/* 3. The athlete at a glance */}
            <AthleteSnapshot intel={intel} />

            {/* 4. What stands out */}
            <InsightList insights={insights} onAdd={addToNotes} notes={setup.coachNotes} extra={<OutcomesCard clientId={clientId} outcomes={outcomes} recordedKeys={recordedKeys} />} />

            {/* 5. Generate, review, assign */}
            <section ref={generateRef} className="scroll-mt-20 space-y-3" data-workflow-section="generate">
              <Card className="space-y-3 p-4" data-testid="gen-actions">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 text-base font-semibold">{intel.firstProgram ? "Generate their first program" : "Generate the next program"}</h2>
                </div>
                <ol className="grid grid-cols-4 gap-1" aria-label="Steps" data-generate-steps>
                  {STEPS.map(([k, label], i) => (
                    <li key={k} className="min-w-0">
                      <div className={cn("h-1 rounded-full", i < stepAt ? "bg-success" : i === stepAt ? "bg-foreground" : "bg-muted")} />
                      <div className={cn("mt-1 truncate text-[11px]", i === stepAt ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</div>
                    </li>
                  ))}
                </ol>
                {stage === "setup" && (
                  <>
                    <Button className="h-12 w-full text-[15px]" disabled={busy || blockers.length > 0 || busyRun} onClick={() => start("generate")} data-testid="gen-fast">
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />} Generate the program
                    </Button>
                    <Button variant="outline" className="h-11 w-full" disabled={busy || blockers.length > 0 || busyRun} onClick={() => start("strategy")} data-testid="gen-review-first">
                      <ListChecks className="mr-2 h-4 w-4" /> Review the strategy first
                    </Button>
                    {blockers.length > 0 && <p className="text-xs text-destructive">Fix the conflicts above first: {blockers.map((b) => b.title).join("; ")}.</p>}
                    <p className="text-xs text-muted-foreground">
                      {intel.firstProgram
                        ? <>Built from their Goals & Setup, your instructions and the setup above, from your library ({intel.ctx.equipment.confidence === "unknown" ? "any equipment" : "only exercises their equipment allows"}, demo videos first). Week 1 finds their working weights; no starting weight is ever made up. Checked before you see it; never assigned for you.</>
                        : <>Reads every record ({intel.history.coverage.loggedSets} sets, the previous program set by set), your instructions and the setup, writes the strategy and builds each block from your library ({intel.ctx.equipment.confidence === "unknown" ? "any equipment" : "only exercises their equipment allows"}). Checked before you see it; never assigned for you.</>}
                    </p>
                  </>
                )}
                {stage === "review" && <p className="text-xs text-muted-foreground">Open it in the builder to run Program Check (quick polish or a deep review) before you assign it.</p>}
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Switch checked={privacySafe} onCheckedChange={setPrivacySafe} aria-label="Privacy-safe" />
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Privacy-safe: the program writer gets the training data without their name, their own notes or check-ins.</span>
                </label>
              </Card>

              {activeGenerate && (running(activeGenerate) || activeGenerate.status === "error") && (
                <PipelineProgress job={activeGenerate} busy={busy} onRetry={() => run(() => retry({ data: { jobId: activeGenerate.id } }), "Picking up where it stopped")} onDiscard={() => run(() => discard({ data: { jobId: activeGenerate.id } }), "Discarded")} />
              )}
              {activeGenerate?.status === "ready" && (
                <DraftView
                  job={activeGenerate}
                  today={intel.ctx.today}
                  busy={busy}
                  onInspect={canInspect ? () => setInspecting(activeGenerate) : undefined}
                  plan={assignPlan} onAssign={(startDate, ack, allowOverlap) => run(() => assign({ data: { jobId: activeGenerate.id, startDate, acknowledgeAudit: ack, allowOverlap } }), "Assigned to the client")}
                  onDiscard={() => run(() => discard({ data: { jobId: activeGenerate.id } }), "Draft discarded")}
                />
              )}
              {activeStrategy && (running(activeStrategy) || activeStrategy.status === "error") && (
                <PipelineProgress job={activeStrategy} busy={busy} onRetry={() => run(() => retry({ data: { jobId: activeStrategy.id } }), "Picking up where it stopped")} onDiscard={() => run(() => discard({ data: { jobId: activeStrategy.id } }), "Discarded")} />
              )}
              {activeStrategy?.status === "ready" && activeStrategy.result?.strategy && (
                strategyCtx.isLoading ? (
                  <Skeleton className="h-40 rounded-2xl" />
                ) : (
                  <StrategyReview
                    strategy={activeStrategy.result.strategy}
                    busy={busy}
                    onApprove={(s) => start("generate", { strategy: s, strategyJobId: activeStrategy.id, setup: strategyCtx.data?.setup ?? setup, edited: strategyCtx.data?.edited ?? [...edited] })}
                    onRegenerate={() => void rewriteStrategy(strategyStale ? "Rewriting the strategy with your instructions" : "Writing a new strategy")}
                    onDiscard={() => run(() => discard({ data: { jobId: activeStrategy.id } }), "Strategy discarded")}
                    staleInstructions={strategyStale}
                  />
                )
              )}
              {earlier.length > 0 && (
                <details className="rounded-2xl border border-border bg-card px-4 py-3 text-sm" data-testid="gen-earlier">
                  <summary className="cursor-pointer select-none font-medium">Earlier programs generated ({earlier.length})</summary>
                  <div className="mt-3 space-y-2">
                    {earlier.map((j) => (
                      <DraftView key={j.id} job={j} today={intel.ctx.today} busy={busy} onInspect={canInspect ? () => setInspecting(j) : undefined} plan={assignPlan} onAssign={(startDate, ack, allowOverlap) => run(() => assign({ data: { jobId: j.id, startDate, acknowledgeAudit: ack, allowOverlap } }), "Assigned to the client")} onDiscard={() => run(() => discard({ data: { jobId: j.id } }), "Draft discarded")} />
                    ))}
                  </div>
                </details>
              )}
            </section>

            {/* Evidence: the detailed reads and the full report, mounted only when opened */}
            <section className="rounded-2xl border border-border bg-card" data-workflow-section="evidence">
              <button type="button" onClick={() => setReportOpen((v) => !v)} aria-expanded={reportOpen} className="flex min-h-[52px] w-full items-center gap-2 px-4 py-2 text-left" data-evidence-toggle>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">Evidence and full report</span>
                  <span className="block text-xs text-muted-foreground">Development, the previous program set by set, data quality, patterns, lifts, muscles, weeks, blocks, downloads</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", reportOpen && "rotate-180")} />
              </button>
              {reportOpen && (
                <div className="space-y-3 border-t border-border p-3">
                  {!intel.firstProgram && <DevelopmentCard intel={intel} clientId={clientId} />}
                  <ProgramReviewCard intel={intel} />
                  <DataQualityCard intel={intel} />
                  <PatternsCard intel={intel} />
                  <FullReport
                    clientId={clientId}
                    search={reportSearch ?? REPORT_DEFAULT}
                    onSearch={reportSearch ? (next) => void navigate({ to: "/admin/client-programs/$clientId/intelligence", params: { clientId }, search: next as any, replace: true }) : undefined}
                  />
                </div>
              )}
            </section>

            <SetupSheet open={setupOpen} onOpenChange={setSetupOpen}>
              <SetupCard intel={intel} setup={setup} edited={edited} onChange={change} onBrain={setBrain} onReset={resetSetup} redistribution={red} onEditEquipment={() => setEquipmentOpen(true)} onSaveGoal={async (g) => { await saveGoal.mutateAsync(g); }} />
              <AdvancedControls intel={intel} setup={setup} edited={edited} onChange={change} />
              <ConflictsCard conflicts={conflicts} />
            </SetupSheet>
            {adjust != null && (
              <EditWithAiSheet open onOpenChange={(o) => { if (!o) setAdjust(null); }} target={{ kind: "client", clientId }} title={name || "Current program"} initialText={adjust} onApplied={refresh} />
            )}
            {equipmentOpen && <EquipmentSheet open={equipmentOpen} onOpenChange={setEquipmentOpen} intel={intel} saving={saveEquipment.isPending} onSave={(p) => saveEquipment.mutateAsync(p)} />}
            {canInspect && <ContextInspector open={!!inspecting} onOpenChange={(v) => !v && setInspecting(null)} job={inspecting} />}
          </>
        )}
      </div>
    </>
  );
}
