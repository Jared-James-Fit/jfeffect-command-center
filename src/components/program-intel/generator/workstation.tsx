/**
 * Generate Next Program, the coach's workstation: Athlete data → performance
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
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { assignIntelDraftFn, discardIntelDraftFn, queueIntelJobFn, retryIntelJobFn } from "@/lib/program-intel/intel.functions";
import { generatedProgramOutcomes } from "@/lib/program-intel/outcomes";
import { blockStructure, findConflicts, redistribution, type GenerationSetup, type SetupField } from "@/lib/program-intel/recommend";
import type { Strategy } from "@/lib/program-intel/generator-schemas";
import type { Brain } from "@/lib/program-intel/types";
import { useBrainOverride, useGeneratorIntel, useIntelJobs, useIntelRecords, useJobContext, useObservations, useSaveEquipmentProfile, type IntelJob } from "../use-program-intel";
import { DraftView, PipelineProgress } from "./draft-view";
import { ContextInspector } from "./inspector";
import { OutcomesCard } from "./outcomes-card";
import { AthleteOverview, DataQualityCard, DevelopmentCard, PatternsCard, ProgramReviewCard } from "./overview";
import { AdvancedControls, ConflictsCard, EquipmentSheet, ProgramNotesCard, SetupCard } from "./setup";
import { StrategyReview } from "./strategy-view";

const HISTORY = { kind: "history" } as const;

/** prefill: what Edit with AI handed over ("rebuild the next 12 weeks…"): the coach's words as notes, and the weeks / days it read from them. */
export function NextProgramWorkstation({ clientId, prefill }: { clientId: string; prefill?: { notes?: string; weeks?: number; days?: number } }) {
  const { viewOnly } = useAuth();
  const qc = useQueryClient();
  const records = useIntelRecords(clientId, HISTORY);
  const brain = useBrainOverride(clientId);
  const intel = useGeneratorIntel(records.data, brain.override);
  const jobs = useIntelJobs(clientId);
  const observations = useObservations(clientId);
  const saveEquipment = useSaveEquipmentProfile(clientId);
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
      if (field === "weeks" && !ed.has("blocks")) {
        const meetWeeks = next.meetDate ? Math.round((Date.parse(next.meetDate) - Date.parse(intel.ctx.today)) / (7 * 86_400_000)) : null;
        next.blocks = blockStructure(next.brain, next.weeks, meetWeeks);
      }
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
    if (prefill.weeks && prefill.weeks >= 1 && prefill.weeks <= 52) change("weeks", prefill.weeks);
    if (prefill.days && prefill.days >= 1 && prefill.days <= 7) change("daysPerWeek", prefill.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, intel, prefill]);
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
    const lookup = (r: { id: string | null; name: string }) => (r.id ? intel.exercises.get(r.id) ?? null : null) ?? { name: r.name, equipment: null };
    return findConflicts(setup, intel.ctx, intel.recommendation.baseline, lookup, intel.recommendation.setup);
  }, [intel, setup]);
  const red = useMemo(() => (intel && setup ? redistribution(setup, intel.recommendation.baseline) : null), [intel, setup]);
  const blockers = conflicts.filter((c) => c.severity === "blocker");

  const all = jobs.data ?? [];
  const consumed = new Set(all.filter((j) => j.kind === "generate" && j.strategy_job_id).map((j) => j.strategy_job_id as string));
  const activeGenerate = all.find((j) => j.kind === "generate" && ["pending", "running", "error", "ready"].includes(j.status)) ?? null;
  const activeStrategy = activeGenerate ? null : all.find((j) => j.kind === "strategy" && ["pending", "running", "error", "ready"].includes(j.status) && !consumed.has(j.id)) ?? null;
  const earlier = all.filter((j) => j.kind === "generate" && j !== activeGenerate && j.status !== "discarded");
  const strategyCtx = useJobContext(activeStrategy?.status === "ready" ? activeStrategy.id : null);
  const assigned = all.filter((j) => j.kind === "generate" && j.status === "assigned");
  const outcomes = useMemo(() => (records.data ? generatedProgramOutcomes(records.data, assigned as any) : []), [records.data, assigned]);
  const recordedKeys = useMemo(() => new Set((observations.data ?? []).map((o) => o.finding_key ?? "").filter((k) => k.startsWith("outcome:"))), [observations.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["program-intel-jobs", clientId] });
    void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
  };
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const start = (kind: "strategy" | "generate", extra: { strategy?: Strategy; strategyJobId?: string; setup?: GenerationSetup; edited?: string[] } = {}) =>
    run(
      () =>
        queue({
          data: {
            clientId,
            kind,
            scope: { kind: "history" },
            brain: (extra.setup ?? setup)!.brain,
            options: { setup: extra.setup ?? setup!, edited: extra.edited ?? [...edited], ...(extra.strategy ? { strategy: extra.strategy, strategyJobId: extra.strategyJobId } : {}), dataHash: intel?.dataHash },
            privacySafe,
          },
        }),
      kind === "strategy" ? "Writing the strategy. You can leave; it keeps going." : "Building the program. You can leave; it keeps going.",
    );

  if (viewOnly)
    return (
      <>
        <PageHeader title="Next program" backTo={`/admin/client-programs/${clientId}/intelligence`} backLabel="Program Intelligence" />
        <div className="p-4 text-sm text-muted-foreground">Generating programs is for coaches. It isn't available in a view-only login.</div>
      </>
    );

  const name = records.data?.client.full_name ?? "";
  const running = (j: IntelJob | null) => !!j && (j.status === "pending" || j.status === "running");
  return (
    <>
      <PageHeader title={intel?.firstProgram ? "First program" : "Next program"} subtitle={name || undefined} backTo={`/admin/client-programs/${clientId}/intelligence`} backLabel="Program Intelligence" />
      <div className="mx-auto w-full max-w-3xl space-y-3 p-3 pb-28 sm:p-6" data-testid="next-program-workstation">
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
            {activeGenerate && (running(activeGenerate) || activeGenerate.status === "error") && (
              <PipelineProgress job={activeGenerate} busy={busy} onRetry={() => run(() => retry({ data: { jobId: activeGenerate.id } }), "Picking up where it stopped")} onDiscard={() => run(() => discard({ data: { jobId: activeGenerate.id } }), "Discarded")} />
            )}
            {activeGenerate?.status === "ready" && (
              <DraftView
                job={activeGenerate}
                today={intel.ctx.today}
                busy={busy}
                onInspect={() => setInspecting(activeGenerate)}
                onAssign={(startDate, ack) => run(() => assign({ data: { jobId: activeGenerate.id, startDate, acknowledgeAudit: ack } }), "Assigned to the client")}
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
                  onRegenerate={() => run(async () => { await discard({ data: { jobId: activeStrategy.id } }); await queue({ data: { clientId, kind: "strategy", scope: { kind: "history" }, brain: setup.brain, options: { setup, edited: [...edited], dataHash: intel.dataHash }, privacySafe } }); }, "Writing a new strategy")}
                  onDiscard={() => run(() => discard({ data: { jobId: activeStrategy.id } }), "Strategy discarded")}
                />
              )
            )}

            <AthleteOverview intel={intel} />
            {!intel.firstProgram && <DevelopmentCard intel={intel} clientId={clientId} />}
            <OutcomesCard clientId={clientId} outcomes={outcomes} recordedKeys={recordedKeys} />
            <ProgramReviewCard intel={intel} />
            <DataQualityCard intel={intel} />
            <PatternsCard intel={intel} />
            <SetupCard intel={intel} setup={setup} edited={edited} onChange={change} onBrain={setBrain} onReset={resetSetup} redistribution={red} onEditEquipment={() => setEquipmentOpen(true)} />
            <ProgramNotesCard intel={intel} value={setup.coachNotes} edited={edited.has("coachNotes")} onChange={(v) => change("coachNotes", v)} />
            <AdvancedControls intel={intel} setup={setup} edited={edited} onChange={change} />
            <ConflictsCard conflicts={conflicts} />

            <Card className="space-y-2 p-3.5" data-testid="gen-actions">
              <Button className="h-12 w-full text-[14px]" disabled={busy || blockers.length > 0 || running(activeGenerate) || running(activeStrategy)} onClick={() => start("generate")} data-testid="gen-fast">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} Generate with the recommended strategy
              </Button>
              <Button variant="outline" className="h-11 w-full" disabled={busy || blockers.length > 0 || running(activeGenerate) || running(activeStrategy)} onClick={() => start("strategy")} data-testid="gen-review-first">
                <ListChecks className="mr-2 h-4 w-4" /> Review the strategy first
              </Button>
              {blockers.length > 0 && <p className="text-[11px] text-destructive">Fix the conflicts above first: {blockers.map((b) => b.title).join("; ")}.</p>}
              <label className="flex items-start gap-2 pt-1 text-[11px] text-muted-foreground">
                <Switch checked={privacySafe} onCheckedChange={setPrivacySafe} aria-label="Privacy-safe" />
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Privacy-safe: the AI gets the training data without the athlete's name, their own notes or check-ins.</span>
              </label>
              <p className="text-[11px] text-muted-foreground">
                {intel.firstProgram
                  ? <>No training logged yet: the AI writes their first program from their Goals & Setup (goal, experience, days, session length, equipment, injuries), the starting point above and your notes & ideas, builds each block from your library ({intel.ctx.equipment.confidence === "unknown" ? "any equipment" : "only exercises their equipment allows"}, demo videos first), keeps week 1 easier to find their working weights, and never makes up a starting weight. It's audited before you see it and never assigned for you.</>
                  : <>The AI reads everything above ({intel.history.coverage.loggedSets} set records, the previous program set by set) plus your setup and notes, writes the strategy, builds each block from your library ({intel.ctx.equipment.confidence === "unknown" ? "any equipment" : "only exercises their equipment allows"}), and the result is audited before you see it. It never assigns anything.</>}
              </p>
            </Card>

            {earlier.length > 0 && (
              <details className="text-xs" data-testid="gen-earlier">
                <summary className="cursor-pointer select-none font-semibold text-muted-foreground">Earlier programs generated ({earlier.length})</summary>
                <div className="mt-2 space-y-2">
                  {earlier.map((j) => (
                    <DraftView key={j.id} job={j} today={intel.ctx.today} busy={busy} onInspect={() => setInspecting(j)} onAssign={(startDate, ack) => run(() => assign({ data: { jobId: j.id, startDate, acknowledgeAudit: ack } }), "Assigned to the client")} onDiscard={() => run(() => discard({ data: { jobId: j.id } }), "Draft discarded")} />
                  ))}
                </div>
              </details>
            )}
            {equipmentOpen && <EquipmentSheet open={equipmentOpen} onOpenChange={setEquipmentOpen} intel={intel} saving={saveEquipment.isPending} onSave={(p) => saveEquipment.mutateAsync(p)} />}
            <ContextInspector open={!!inspecting} onOpenChange={(v) => !v && setInspecting(null)} job={inspecting} />
          </>
        )}
      </div>
    </>
  );
}
