/**
 * Full-screen Program Assignment Planner.
 *
 * One reusable shell drives Content → Method → Calendar → Conflicts →
 * Review steps. State persists to localStorage so a refresh restores the
 * in-progress session. Commit calls commitAssignmentFn server-side which
 * is idempotent on (clientId, templateId, idempotencyKey).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft, Loader2, AlertTriangle, CheckCircle2, XCircle, Calendar, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { normalizeTemplatePayload, getActiveTemplateBlocks } from "@/lib/pl-template-blocks";
import {
  selectAll, clearAll, setNode, getNodeState, summarize,
  dayKey as makeDayKey,
} from "@/lib/program-planner/selection";
import { planAssignmentFn, commitAssignmentFn } from "@/lib/program-planner/planner.functions";
import { loadDraft, saveDraft, clearDraft, newIdempotencyKey, type PlannerDraft } from "@/lib/program-planner/draft-store";
import type {
  AssignmentMethod, ConflictDecision, PlannerSelection, PublishStatus, Weekday,
} from "@/lib/program-planner/types";
import { AssignmentCalendar, type CalendarExistingDay, type CalendarIncomingDay } from "./AssignmentCalendar";

const STEPS = ["Content", "Method", "Calendar", "Conflicts", "Review"] as const;
const WEEKDAYS: Weekday[] = ["mon","tue","wed","thu","fri","sat","sun"];
const WEEKDAY_LABEL: Record<Weekday, string> = { mon:"Mon", tue:"Tue", wed:"Wed", thu:"Thu", fri:"Fri", sat:"Sat", sun:"Sun" };

type Props = {
  clientId: string;
  templateId: string;
  onDone?: () => void;
};

export function ProgramAssignmentPlanner({ clientId, templateId, onDone }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Template payload
  const { data: tpl, isLoading: tplLoading } = useQuery({
    queryKey: ["planner-template", templateId],
    queryFn: async () => (await (supabase as any)
      .from("pl_templates").select("id, name, template_type, payload, weeks").eq("id", templateId).maybeSingle()).data,
  });
  const { data: client } = useQuery({
    queryKey: ["planner-client", clientId],
    queryFn: async () => (await supabase
      .from("clients")
      .select("id, full_name, committed_training_days, available_training_days, preferred_training_days, unavailable_training_days, timezone")
      .eq("id", clientId).maybeSingle()).data,
  });

  const payload = useMemo(() => {
    if (!tpl) return null;
    return normalizeTemplatePayload(tpl.payload, { templateType: tpl.template_type, templateId: tpl.id });
  }, [tpl]);
  const blocks = useMemo(() => (payload ? getActiveTemplateBlocks(payload) : []), [payload]);

  // Draft restore
  const initial = useMemo<PlannerDraft>(() => {
    const d = loadDraft(clientId, templateId);
    if (d) return d;
    const today = new Date().toISOString().slice(0, 10);
    return {
      step: 0,
      selection: { exerciseKeys: [] },
      method: "client_days",
      trainingDays: ["mon","wed","fri"],
      startDate: today,
      manualDateMap: {},
      conflictDecisions: {},
      publishStatus: "published",
      publishAt: null,
      idempotencyKey: newIdempotencyKey(),
      updatedAt: Date.now(),
    };
  }, [clientId, templateId]);

  const [step, setStep] = useState(initial.step);
  const [selection, setSelection] = useState<PlannerSelection>(initial.selection);
  const [method, setMethod] = useState<AssignmentMethod>(initial.method);
  const [trainingDays, setTrainingDays] = useState<Weekday[]>(initial.trainingDays);
  // Resolve the client's saved training days (committed → available →
  // preferred, minus unavailable). The source label is shown in the UI so
  // the admin always knows where the defaults came from.
  const clientTrainingDays = useMemo<{ days: Weekday[]; source: "committed"|"available"|"preferred"|"none" }>(() => {
    const norm = (xs: any): Weekday[] => {
      if (!Array.isArray(xs)) return [];
      const map: Record<string, Weekday> = {
        mon:"mon",tue:"tue",wed:"wed",thu:"thu",fri:"fri",sat:"sat",sun:"sun",
        monday:"mon",tuesday:"tue",wednesday:"wed",thursday:"thu",friday:"fri",saturday:"sat",sunday:"sun",
      };
      const out: Weekday[] = [];
      for (const x of xs) {
        const k = String(x ?? "").trim().toLowerCase();
        const v = map[k];
        if (v && !out.includes(v)) out.push(v);
      }
      return out;
    };
    const unavailable = new Set(norm((client as any)?.unavailable_training_days));
    const filter = (xs: Weekday[]) => xs.filter((d) => !unavailable.has(d));
    const committed = filter(norm((client as any)?.committed_training_days));
    if (committed.length) return { days: committed, source: "committed" };
    const available = filter(norm((client as any)?.available_training_days));
    if (available.length) return { days: available, source: "available" };
    const preferred = filter(norm((client as any)?.preferred_training_days));
    if (preferred.length) return { days: preferred, source: "preferred" };
    return { days: [], source: "none" };
  }, [client]);

  const [startDate, setStartDate] = useState<string | null>(initial.startDate);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string, ConflictDecision>>(initial.conflictDecisions);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>(initial.publishStatus);
  const [publishAt, setPublishAt] = useState<string | null>(initial.publishAt);
  const [idempotencyKey] = useState<string>(initial.idempotencyKey);
  const [committing, setCommitting] = useState(false);

  // Default-select all once payload loads if user has no prior selection.
  useEffect(() => {
    if (payload && selection.exerciseKeys.length === 0 && !loadDraft(clientId, templateId)) {
      setSelection(selectAll(payload));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  // Persist draft
  useEffect(() => {
    saveDraft(clientId, templateId, {
      step, selection, method, trainingDays, startDate, manualDateMap: {},
      conflictDecisions, publishStatus, publishAt, idempotencyKey, updatedAt: Date.now(),
    });
  }, [step, selection, method, trainingDays, startDate, conflictDecisions, publishStatus, publishAt, clientId, templateId, idempotencyKey]);

  const summary = useMemo(() => (payload ? summarize(payload, selection) : { blocks:0, weeks:0, days:0, exercises:0 }), [payload, selection]);

  // Dry-run plan whenever inputs change (debounced lightly via key).
  const planFn = useServerFn(planAssignmentFn);
  const planKey = JSON.stringify({ sel: selection.exerciseKeys.slice().sort(), method, trainingDays, startDate });
  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ["planner-preview", clientId, templateId, planKey],
    enabled: !!payload && selection.exerciseKeys.length > 0,
    queryFn: () => planFn({ data: { clientId, templateId, selection, method, startDate, trainingDays } }),
    staleTime: 5_000,
  });

  // Workouts per week (max across all selected weeks) — used to flag
  // mismatches between the program's training frequency and the client's
  // saved availability.
  const workoutsPerWeek = useMemo(() => {
    const perWeek = new Map<string, number>();
    for (const md of (preview?.placements ?? []) as any[]) {
      const k = `${md.blockKey}::${md.weekIndex}`;
      perWeek.set(k, (perWeek.get(k) ?? 0) + 1);
    }
    let max = 0;
    for (const n of perWeek.values()) if (n > max) max = n;
    return max;
  }, [preview?.placements]);

  // Existing scheduled days for the calendar
  const { data: existingCal = [] as CalendarExistingDay[] } = useQuery({
    queryKey: ["planner-existing-cal", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pl_days")
        .select("id, title, scheduled_date, schedule_locked, archived, pl_weeks!inner(block_id, pl_blocks!inner(name, client_id))")
        .eq("pl_weeks.pl_blocks.client_id", clientId)
        .eq("archived", false)
        .not("scheduled_date", "is", null);
      const dayIds = (data ?? []).map((r: any) => r.id);
      let completed = new Set<string>();
      if (dayIds.length) {
        const { data: comps } = await (supabase as any)
          .from("pl_day_completions").select("day_id").eq("client_id", clientId).in("day_id", dayIds);
        completed = new Set((comps ?? []).map((c: any) => c.day_id));
      }
      return (data ?? []).map((r: any): CalendarExistingDay => ({
        id: r.id, date: r.scheduled_date, title: r.title,
        completed: completed.has(r.id), locked: !!r.schedule_locked,
        blockName: r.pl_weeks?.pl_blocks?.name ?? null,
      }));
    },
  });

  const incomingCal: CalendarIncomingDay[] = useMemo(() => {
    if (!preview) return [];
    const conflictKeys = new Set(preview.conflicts.filter((c: any) => c.type === "date_occupied" || c.type === "completed_protected" || c.type === "locked_destination").map((c: any) => c.incoming.dayKey));
    return preview.placements.filter((p: any) => p.date).map((p: any) => ({
      dayKey: p.dayKey, date: p.date, title: p.title, hasConflict: conflictKeys.has(p.dayKey),
    }));
  }, [preview]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const commitServer = useServerFn(commitAssignmentFn);
  const commit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const result = await commitServer({ data: {
        clientId, templateId, selection, method, startDate, trainingDays,
        conflictDecisions, publishStatus, publishAt, idempotencyKey,
      } as any });
      clearDraft(clientId, templateId);
      toast.success(
        result.idempotent
          ? "Already assigned (idempotent)"
          : `Assigned ${result.counts.added} workout${result.counts.added === 1 ? "" : "s"}`,
      );
      qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
      qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
      qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
      qc.invalidateQueries({ queryKey: ["planner-existing-cal", clientId] });
      if (onDone) onDone();
      else navigate({ to: "/admin/client-programs/$clientId", params: { clientId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Assignment failed");
    } finally {
      setCommitting(false);
    }
  };

  if (tplLoading || !payload || !tpl) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading template…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header / progress */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Assign</div>
            <div className="text-base font-bold">{tpl.name} → {client?.full_name ?? "client"}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(i)}
                className={
                  "rounded px-2 py-1 text-xs " +
                  (i === step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/70")
                }
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{summary.blocks} block{summary.blocks === 1 ? "" : "s"}</Badge>
          <Badge variant="secondary">{summary.weeks} week{summary.weeks === 1 ? "" : "s"}</Badge>
          <Badge variant="secondary">{summary.days} day{summary.days === 1 ? "" : "s"}</Badge>
          <Badge variant="secondary">{summary.exercises} exercise{summary.exercises === 1 ? "" : "s"}</Badge>
          {preview?.coverage?.programmedThrough && (
            <Badge variant="outline">Programmed through {preview.coverage.programmedThrough}</Badge>
          )}
          {preview?.endDate && (
            <Badge variant="outline">Ends {preview.endDate}</Badge>
          )}
          {previewLoading && <span className="inline-flex items-center text-xs"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Updating preview…</span>}
        </div>
      </Card>

      {/* Step body */}
      {step === 0 && (
        <ContentStep payload={payload} blocks={blocks} selection={selection} setSelection={setSelection} />
      )}
      {step === 1 && (
        <MethodStep
          method={method} setMethod={setMethod}
          trainingDays={trainingDays} setTrainingDays={setTrainingDays}
          startDate={startDate} setStartDate={setStartDate}
          clientTrainingDays={clientTrainingDays}
          clientName={client?.full_name ?? null}
          clientTimezone={(client as any)?.timezone ?? null}
          workoutsPerWeek={workoutsPerWeek}
          resolvedTrainingDays={(preview as any)?.resolvedTrainingDays as Weekday[] | undefined}
        />
      )}
      {step === 2 && (
        <Card className="p-3">
          <AssignmentCalendar existing={existingCal as CalendarExistingDay[]} incoming={incomingCal} />
          {preview?.coverage?.gaps?.length ? (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {preview.coverage.gaps.length} programming gap{preview.coverage.gaps.length === 1 ? "" : "s"} detected in the next 12 weeks.
            </div>
          ) : null}
        </Card>
      )}
      {step === 3 && (
        <ConflictsStep
          conflicts={preview?.conflicts ?? []}
          decisions={conflictDecisions}
          setDecisions={setConflictDecisions}
        />
      )}
      {step === 4 && (
        <ReviewStep
          preview={preview}
          publishStatus={publishStatus} setPublishStatus={setPublishStatus}
          publishAt={publishAt} setPublishAt={setPublishAt}
        />
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={back} disabled={step === 0}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { clearDraft(clientId, templateId); window.location.reload(); }}>
            Discard draft
          </Button>
          {step < STEPS.length - 1 && (
            <Button onClick={next} disabled={selection.exerciseKeys.length === 0}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === STEPS.length - 1 && (
            <Button onClick={commit} disabled={committing || !preview || preview.placements.length === 0}>
              {committing ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Assigning…</> : `Assign ${preview?.placements.length ?? 0} workouts`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Step components ---------- */

function TriCheckbox({ state, onChange, label, count }: { state: "on"|"off"|"partial"; onChange: (on: boolean) => void; label: string; count?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={state === "on"}
        ref={(el) => { if (el) el.indeterminate = state === "partial"; }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1">{label}</span>
      {count && <span className="text-[10px] text-muted-foreground">{count}</span>}
    </label>
  );
}

function ContentStep({ payload, blocks, selection, setSelection }: {
  payload: any; blocks: any[]; selection: PlannerSelection; setSelection: (s: PlannerSelection) => void;
}) {
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Select content to assign</div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setSelection(selectAll(payload))}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection(clearAll())}>Clear</Button>
        </div>
      </div>
      <div className="space-y-2 max-h-[55vh] overflow-y-auto">
        {blocks.map((b: any) => {
          const blockState = getNodeState(payload, selection, { blockKey: b.id });
          return (
            <div key={b.id} className="rounded border border-border bg-secondary/20 p-2">
              <TriCheckbox
                state={blockState}
                onChange={(on) => setSelection(setNode(payload, selection, { blockKey: b.id }, on))}
                label={b.name}
                count={`${b.weeks?.length ?? 0} weeks`}
              />
              <div className="mt-1 ml-5 space-y-1">
                {(b.weeks ?? []).map((w: any, wi: number) => {
                  const ws = getNodeState(payload, selection, { blockKey: b.id, weekIndex: wi });
                  const days = Array.isArray(w?.days) ? w.days : Array.isArray(w?.workout_days) ? w.workout_days : [];
                  return (
                    <details key={wi} className="rounded border border-border/50 bg-background/40">
                      <summary className="cursor-pointer px-2 py-1">
                        <TriCheckbox
                          state={ws}
                          onChange={(on) => setSelection(setNode(payload, selection, { blockKey: b.id, weekIndex: wi }, on))}
                          label={`Week ${wi + 1}`}
                          count={`${days.length} days`}
                        />
                      </summary>
                      <div className="ml-5 space-y-1 pb-1">
                        {days.map((d: any, di: number) => {
                          const ds = getNodeState(payload, selection, { blockKey: b.id, weekIndex: wi, dayIndex: di });
                          const exs = Array.isArray(d?.exercises) ? d.exercises : Array.isArray(d?.rows) ? d.rows : [];
                          return (
                            <details key={di} className="ml-1">
                              <summary className="cursor-pointer px-2 py-0.5 text-xs">
                                <TriCheckbox
                                  state={ds}
                                  onChange={(on) => setSelection(setNode(payload, selection, { blockKey: b.id, weekIndex: wi, dayIndex: di }, on))}
                                  label={d.title || d.name || `Day ${di + 1}`}
                                  count={`${exs.length} ex.`}
                                />
                              </summary>
                              <ul className="ml-6 space-y-0.5">
                                {exs.map((e: any, ei: number) => {
                                  const es = getNodeState(payload, selection, { blockKey: b.id, weekIndex: wi, dayIndex: di, exerciseIndex: ei });
                                  const name = e?.exercise_name_override || e?.name || e?.exercise_name || `Exercise ${ei + 1}`;
                                  return (
                                    <li key={ei}>
                                      <TriCheckbox
                                        state={es}
                                        onChange={(on) => setSelection(setNode(payload, selection, { blockKey: b.id, weekIndex: wi, dayIndex: di, exerciseIndex: ei }, on))}
                                        label={name}
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            </details>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MethodStep({ method, setMethod, trainingDays, setTrainingDays, startDate, setStartDate }: {
  method: AssignmentMethod; setMethod: (m: AssignmentMethod) => void;
  trainingDays: Weekday[]; setTrainingDays: (d: Weekday[]) => void;
  startDate: string | null; setStartDate: (d: string | null) => void;
}) {
  const options: Array<{ id: AssignmentMethod; label: string; desc: string }> = [
    { id: "entire_sequence", label: "Entire sequence", desc: "Place workouts on consecutive days starting from the start date." },
    { id: "weekday_map", label: "Weekday map", desc: "Place workouts on the chosen weekdays only." },
    { id: "fill_empty", label: "Fill empty days", desc: "Skip dates that already have a workout." },
    { id: "insert", label: "Insert (push existing)", desc: "Insert into chosen weekdays; later dates remain in order." },
    { id: "replace_range", label: "Replace range", desc: "Overwrite a date range with the selected workouts." },
    { id: "manual_dates", label: "Manual dates", desc: "Pick each workout's date individually on the calendar step." },
  ];
  return (
    <Card className="p-3 space-y-3">
      <div>
        <Label className="text-xs">Start date</Label>
        <Input type="date" value={startDate ?? ""} onChange={(e) => setStartDate(e.target.value || null)} />
      </div>
      <div className="space-y-1">
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded border border-border bg-secondary/20 p-2">
            <input type="radio" name="method" checked={method === o.id} onChange={() => setMethod(o.id)} className="mt-1" />
            <div>
              <div className="text-sm font-semibold">{o.label}</div>
              <div className="text-xs text-muted-foreground">{o.desc}</div>
            </div>
          </label>
        ))}
      </div>
      {(method === "weekday_map" || method === "fill_empty" || method === "insert") && (
        <div>
          <Label className="text-xs">Training days</Label>
          <div className="mt-1 flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTrainingDays(trainingDays.includes(d) ? trainingDays.filter((x) => x !== d) : [...trainingDays, d])}
                className={
                  "rounded px-2 py-1 text-xs " +
                  (trainingDays.includes(d) ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")
                }
              >
                {WEEKDAY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ConflictsStep({ conflicts, decisions, setDecisions }: {
  conflicts: any[];
  decisions: Record<string, ConflictDecision>;
  setDecisions: (d: Record<string, ConflictDecision>) => void;
}) {
  if (!conflicts.length) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
        No conflicts detected.
      </Card>
    );
  }
  return (
    <Card className="p-3 space-y-2">
      <div className="text-sm font-semibold">{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</div>
      <ul className="space-y-2">
        {conflicts.map((c, i) => {
          const dec = decisions[c.incoming.dayKey];
          const choose = (action: ConflictDecision["action"], extra: any = {}) =>
            setDecisions({ ...decisions, [c.incoming.dayKey]: { action, ...extra } });
          const isCompleted = c.type === "completed_protected";
          return (
            <li key={i} className={"rounded border p-2 text-xs " + (isCompleted ? "border-rose-500/50 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5")}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={"h-3.5 w-3.5 shrink-0 " + (isCompleted ? "text-rose-500" : "text-amber-500")} />
                <div className="flex-1">
                  <div className="font-semibold">
                    {c.date ?? "no date"} · {c.incoming.title}
                  </div>
                  <div className="text-muted-foreground">
                    {c.type} {c.existing?.label ? `· ${c.existing.label}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!isCompleted && (
                      <Button size="sm" variant={dec?.action === "replace_existing" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => choose("replace_existing", { dayId: c.existing?.dayId })}>Replace existing</Button>
                    )}
                    <Button size="sm" variant={dec?.action === "skip_incoming" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => choose("skip_incoming")}>Skip incoming</Button>
                    <Button size="sm" variant={dec?.action === "keep_both" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => choose("keep_both")}>Keep both</Button>
                    {isCompleted && !dec && (
                      <span className="text-[10px] text-rose-600">Completed workout — choose Skip unless you really mean to overwrite.</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ReviewStep({ preview, publishStatus, setPublishStatus, publishAt, setPublishAt }: {
  preview: any;
  publishStatus: PublishStatus; setPublishStatus: (s: PublishStatus) => void;
  publishAt: string | null; setPublishAt: (s: string | null) => void;
}) {
  return (
    <Card className="p-3 space-y-3">
      <div className="text-sm font-semibold">Review</div>
      {preview ? (
        <>
          <div className="text-xs text-muted-foreground">
            {preview.placements.length} workouts · {preview.placements.filter((p: any) => p.date).length} scheduled · {preview.conflicts.length} conflicts
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {preview.placements.slice(0, 30).map((p: any) => (
              <li key={p.dayKey} className="flex items-center justify-between border-b border-border/40 py-1">
                <span>{p.title}</span>
                <span className={p.date ? "text-muted-foreground" : "text-rose-500"}>{p.date ?? "no date"}</span>
              </li>
            ))}
            {preview.placements.length > 30 && <li className="text-[10px] text-muted-foreground">…and {preview.placements.length - 30} more</li>}
          </ul>
        </>
      ) : <div className="text-xs text-muted-foreground">Building preview…</div>}
      <div className="space-y-2 border-t border-border pt-2">
        <Label className="text-xs">Publish</Label>
        <div className="flex flex-wrap gap-1">
          {(["draft","published","scheduled"] as PublishStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPublishStatus(s)}
              className={
                "rounded px-2 py-1 text-xs " +
                (publishStatus === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")
              }
            >
              {s === "draft" ? "Save as draft (hidden)" : s === "published" ? "Publish now" : "Schedule publish"}
            </button>
          ))}
        </div>
        {publishStatus === "scheduled" && (
          <Input type="datetime-local" value={publishAt ?? ""} onChange={(e) => setPublishAt(e.target.value || null)} />
        )}
        {publishStatus === "draft" && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><XCircle className="h-3 w-3" />Will not be visible to the client until published.</div>
        )}
      </div>
    </Card>
  );
}

// Re-export for callers that want the dayKey helper.
export { makeDayKey };