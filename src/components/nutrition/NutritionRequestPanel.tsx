/**
 * Client profile → Nutrition: send the native Nutrition Update Request and
 * work the AI output (targets + paste-ready meal plan) into the client's
 * nutrition targets.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, PencilLine, RefreshCw, Send, Sparkles, Undo2, Wand2 } from "lucide-react";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { clientPlansQuery, publishAiPlan } from "@/lib/nutrition-targets/plan-publish";
import { nextPlanDates, planDate, planPeriod, splitPlans } from "@/lib/nutrition-targets/plan-history";
import { todayLocalISO } from "@/lib/today";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Accordion } from "@/components/ui/accordion";
import { CardHeader, DayRows, MoreButton, PlanDaysView, Section, StatusChip, type ChipTone, type PlanViewDay } from "@/components/nutrition/nutrition-ui";
import { NUTRITION_PHASES, PHASE_GOAL, phaseFromPlanText, phaseFromText } from "@/lib/nutrition-cardio";
import { MEAL_PLAN_PROMPT, REVISE_MAX_CHARS, TARGETS_PROMPT, answerFor, clientBasicsLines, manualMealPlanPrompt, manualRevisePrompt, manualTargetsPrompt, nutritionSubmissionSummary, type WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";
import { lastPlanSummary, previousMealsText, previousPlanText, type PreviousPlan } from "@/lib/nutrition-history";
import { WorkoutMealsSelect } from "@/components/nutrition/WorkoutMealsSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { currentRequest, planMissing } from "@/lib/form-request-state";
import {
  generateNutritionPlanFn,
  listNutritionRequestsFn,
  markNutritionPlanAppliedFn,
  reviseNutritionPlanFn,
  sendNutritionRequestFn,
  undoNutritionRevisionFn,
} from "@/lib/nutrition-ai-plans.functions";
import { parseFoodWeighingRules, parseMealPlan } from "@/components/nutrition/MealPlanBulkPaste";
import { NutritionTargetDialog } from "@/components/nutrition-target-dialog";
import { dayKey, parseAiCardio } from "@/lib/nutrition-cardio-sync";
import { LEAN_GROCERY_LIST, hardToFindFoods, planFoodStats, prepDrift, prepDriftLine, type HardToFind, type PlanFoodStats, type PrepDrift } from "@/lib/nutrition-targets/plan-foods";
import { bodyweightAnswerKg, coachChecks, coachNotesFlags, parseAiTargets, safetyNotes, withoutCoachNotes } from "@/lib/nutrition-targets/nutrition-intel";

type Req = {
  id: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  answers: Array<{ label: string; value: string }>;
  plan: null | {
    status: "pending" | "generating" | "ready" | "error";
    targets_text: string | null;
    meal_plan_text: string | null;
    error: string | null;
    generated_at: string | null;
    applied_at: string | null;
    updated_at?: string | null;
    phase: string | null;
    workout_meals?: WorkoutMealsMode | null;
    /** The plan they were on when they sent this, and how it went (nutrition-history.ts). */
    previous_plan?: PreviousPlan | null;
    /** A coach update waiting to be written (or kept after a failed try, with `error`). */
    revise_instructions?: string | null;
    /** Coach updates already written, newest last (Undo restores the plan before the last one). */
    revisions?: Array<{ at: string; instructions: string }> | null;
  };
};

const PHASES = NUTRITION_PHASES.filter((p) => p !== "Custom");
const AUTO = "__auto";

function PhaseSelect({ value, onChange, autoLabel }: { value: string; onChange: (v: string) => void; autoLabel: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{autoLabel}</SelectItem>
        {PHASES.map((p) => (
          <SelectItem key={p} value={p}>{p}<span className="text-muted-foreground"> · {PHASE_GOAL[p]}</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied — paste it into ChatGPT or Claude`);
  } catch {
    toast.error("Couldn't copy");
  }
}

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

function structureFor(labels: string[]) {
  const has = (k: string) => labels.some((l) => l.toLowerCase().includes(k));
  const training = labels.some((l) => /^training/i.test(l));
  const rest = has("non-training") || has("rest");
  if (training && rest && has("high")) return "Training / Rest / High";
  if (training && rest) return "Training / Rest";
  if (has("high") && has("low")) return "High / Low";
  return labels.length === 1 ? "Same Every Day" : "Custom";
}

export function NutritionRequestPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNutritionRequestsFn);
  const sendFn = useServerFn(sendNutritionRequestFn);
  const genFn = useServerFn(generateNutritionPlanFn);
  const appliedFn = useServerFn(markNutritionPlanAppliedFn);
  const reviseFn = useServerFn(reviseNutritionPlanFn);
  const undoFn = useServerFn(undoNutritionRevisionFn);
  const [change, setChange] = useState("");
  const [changing, setChanging] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { data: plans = [] } = useQuery(clientPlansQuery(clientId));
  const currentPlan = splitPlans(plans).current[0] ?? null;
  const [sendOpen, setSendOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [sendPhase, setSendPhase] = useState<string>(AUTO);
  const [regenPhase, setRegenPhase] = useState<string>(AUTO);
  const [sendWorkoutMeals, setSendWorkoutMeals] = useState<WorkoutMealsMode>("auto");
  const [regenWorkoutMeals, setRegenWorkoutMeals] = useState<WorkoutMealsMode | null>(null);

  const key = ["nutrition-requests", clientId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { clientId } }),
    refetchInterval: (q) => {
      const reqs = (q.state.data as any)?.requests as Req[] | undefined;
      const r = currentRequest(reqs ?? [], (q.state.data as any)?.requestedAt ?? null);
      const waiting = r && r.status !== "in_progress" && (!r.plan || r.plan.status === "generating" || r.plan.status === "pending");
      return waiting ? 4000 : false;
    },
  });
  const requests = (data?.requests ?? []) as Req[];
  const latest = currentRequest(requests, data?.requestedAt ?? null);
  const submitted = latest && latest.status !== "in_progress";
  const plan = latest?.plan ?? null;
  // A coach update being written: the plan stays on screen until it lands.
  const revising = !!plan?.revise_instructions && (plan.status === "pending" || plan.status === "generating");
  const updateFailed = plan?.status === "ready" && !!plan.revise_instructions && !!plan.error;
  const revisions = plan?.revisions ?? [];
  const lastChangeAt = revisions[revisions.length - 1]?.at ?? null;
  // Sent, but no plan being written (or one that stalled): write it now, once.
  const kicked = useRef<string | null>(null);
  useEffect(() => {
    if (!latest || !submitted || !planMissing(plan) || kicked.current === latest.id) return;
    kicked.current = latest.id;
    void genFn({ data: { submissionId: latest.id } })
      .catch(() => {})
      .finally(() => qc.invalidateQueries({ queryKey: key }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, submitted, plan?.status, plan?.updated_at]);

  const prefill = useMemo(() => {
    if (!plan?.meal_plan_text) return null;
    const days = parseMealPlan(plan.meal_plan_text);
    return {
      days,
      structure: structureFor(days.map((d) => d.day_label)),
      food_weighing_rules: parseFoodWeighingRules(plan.meal_plan_text),
      // COACH NOTES (reasoning, health flags) never reaches the client-readable plan.
      admin_notes: withoutCoachNotes(plan.targets_text ?? null),
      phase: plan.phase ?? phaseFromPlanText(plan.meal_plan_text) ?? phaseFromText(plan.targets_text?.match(/^Goal:\s*(.+)$/m)?.[1]),
      // Daily steps + cardio sessions ride along into the editor.
      targetsText: plan.targets_text ?? null,
    };
  }, [plan?.meal_plan_text, plan?.targets_text, plan?.phase]);
  const [manualOpen, setManualOpen] = useState(false);

  // The plan at a glance: each day's numbers + steps + cardio, from the AI output.
  const preview = useMemo(() => {
    if (!prefill?.days.length) return [];
    const cardio = parseAiCardio(plan?.targets_text);
    return prefill.days.map((d: any) => {
      const c = cardio.get(dayKey(d.day_label));
      return {
        label: d.day_label as string,
        kcal: d.calories as number | null,
        p: d.protein as number | null,
        c: d.carbs as number | null,
        f: d.fats as number | null,
        steps: c?.steps ?? null,
        cardio: !c ? "—" : c.none ? "none" : [c.minutes ? `${c.minutes} min` : null, c.kcal ? `~${c.kcal} kcal` : null].filter(Boolean).join(" · ") || "—",
        cardioMin: c && !c.none ? c.minutes : null,
        noCardio: !!c?.none,
      };
    });
  }, [prefill, plan?.targets_text]);

  // What to look at before publishing: the targets' own math, floors, health mentions, the AI's flags.
  const checks = useMemo(() => {
    if (!plan?.targets_text) return [];
    const answers = latest?.answers ?? [];
    const out = coachChecks({
      days: parseAiTargets(plan.targets_text),
      bodyweightKg: bodyweightAnswerKg(answerFor(answers, "bodyweight")),
      female: /female/i.test(String(data?.client?.sex ?? "")),
      safety: safetyNotes(answers),
    });
    const flags = coachNotesFlags(plan.targets_text);
    return flags ? [...out, `AI: ${flags}`] : out;
  }, [plan?.targets_text, latest?.answers, data?.client?.sex]);

  /** Everything for this plan as one block (to paste into a doc, a chat or another AI). */
  const everything = () => {
    const client = data?.client ?? data?.clientName ?? "Client";
    return [
      latest && submitted ? nutritionSubmissionSummary({ client, qas: latest.answers, phase: plan?.phase ?? data?.requestedPhase ?? null, submittedAt: latest.submitted_at }) : "",
      previousPlanText(plan?.previous_plan),
      data?.programText ? `TRAINING PROGRAM\n${data.programText}` : "",
      data?.cardioText ?? "",
      plan?.targets_text ? `AI TARGETS\n${plan.targets_text}` : "",
      plan?.meal_plan_text ? `AI MEAL PLAN\n${plan.meal_plan_text}` : "",
    ].filter(Boolean).join("\n\n------------------------\n\n");
  };

  const send = async () => {
    setSending(true);
    try {
      await sendFn({ data: { clientId, note: note.trim() || null, phase: sendPhase === AUTO ? null : sendPhase, workoutMeals: sendWorkoutMeals } });
      toast.success("Nutrition update request sent to the client's messages");
      setSendOpen(false);
      setNote("");
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the request");
    } finally {
      setSending(false);
    }
  };

  const regenerate = async () => {
    if (!latest) return;
    setRegenerating(true);
    try {
      qc.setQueryData(key, (old: any) => old && ({
        ...old,
        requests: old.requests.map((r: Req, i: number) => i === 0 ? { ...r, plan: { ...(r.plan ?? {}), status: "generating" } } : r),
      }));
      const res = await genFn({
        data: {
          submissionId: latest.id,
          force: true,
          phase: regenPhase === AUTO ? null : regenPhase,
          workoutMeals: regenWorkoutMeals ?? plan?.workout_meals ?? null,
        },
      });
      if (res.status === "error") toast.error("AI couldn't finish — try again");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't run the AI");
    } finally {
      setRegenerating(false);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const sendChange = async (text = change) => {
    const instructions = text.trim();
    if (!latest || instructions.length < 3) return;
    setChanging(true);
    try {
      qc.setQueryData(key, (old: any) => old && ({
        ...old,
        requests: old.requests.map((r: Req) => r.id === latest.id && r.plan ? { ...r, plan: { ...r.plan, status: "pending", revise_instructions: instructions, error: null } } : r),
      }));
      await reviseFn({ data: { submissionId: latest.id, instructions } });
      setChange("");
      toast.success("Updating the plan. About a minute, and you can leave this page.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the change");
    } finally {
      setChanging(false);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const undoChange = async () => {
    if (!latest) return;
    setChanging(true);
    try {
      const res = await undoFn({ data: { submissionId: latest.id } });
      toast.success(`Undone: “${res.instructions}”`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't undo");
    } finally {
      setChanging(false);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const firstName = String((data?.client as any)?.name ?? data?.clientName ?? "").trim().split(/\s+/)[0] || "the client";

  /** One tap: the AI plan becomes the client's plan from today; the one before it goes to Previous plans. */
  const publish = async () => {
    if (!latest || !plan?.meal_plan_text || !prefill?.days.length) return;
    setPublishing(true);
    try {
      const res = await publishAiPlan({
        clientId,
        phase: prefill.phase ?? null,
        structure: prefill.structure,
        days: prefill.days,
        targetsText: plan.targets_text,
        foodWeighingRules: prefill.food_weighing_rules,
      });
      await appliedFn({ data: { submissionId: latest.id } }).catch(() => {});
      fireAppEvent("nutrition_targets_updated", clientId);
      const cardio = res.cardio && res.cardio.updated + res.cardio.inserted ? " · cardio synced" : "";
      toast.success(`${firstName}'s plan is updated${res.archived ? " · the old one is in Previous plans" : ""}${cardio}`);
      if (res.cardioError) toast.error(`Plan updated, but cardio didn't sync: ${res.cardioError}. Fix it in Cardio Targets.`);
      setPublishOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update the plan");
    } finally {
      setPublishing(false);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
      for (const k of [["cardio-targets", clientId], ["cal-client-cardio", clientId], ["client-cardio-resolved", clientId], ["week-sched-data"]]) {
        qc.invalidateQueries({ queryKey: k });
      }
      void invalidateGroceryList(qc, clientId);
    }
  };

  // What the card is about right now. A plan waiting on the coach opens its review; a
  // published one is one line until the coach asks to see it again.
  const ready = !!submitted && !!plan && (plan.status === "ready" || revising);
  const changedSincePublish = !!(plan?.applied_at && lastChangeAt && lastChangeAt > plan.applied_at);
  const published = !!plan?.applied_at && !changedSincePublish;
  const reviewOpen = ready && (!published || showDetails);
  const writing = !!submitted && !revising && (!plan || plan.status === "generating" || plan.status === "pending");
  const answered = latest?.answers.filter((a) => a.value).length ?? 0;

  const status: { tone: ChipTone; label: string } | null = isLoading
    ? null
    : !latest
      ? data?.requestedAt ? { tone: "neutral", label: `Waiting on ${firstName}` } : null
      : !submitted ? { tone: "neutral", label: "Filling it in" }
      : revising ? { tone: "neutral", label: "Updating…" }
      : plan?.status === "error" ? { tone: "error", label: "Didn't finish" }
      : changedSincePublish ? { tone: "attention", label: "Changed · publish again" }
      : published ? { tone: "done", label: `Published ${shortDate(plan!.applied_at)}` }
      : plan?.status === "ready" ? { tone: "attention", label: "Ready to review" }
      : { tone: "neutral", label: "Writing…" };

  // The written plan a day at a time (targets, then meals), each day against the plan they're on now.
  const reviewDays: PlanViewDay[] = useMemo(() => {
    const now = new Map<string, any>(
      ((currentPlan as any)?.nutrition_target_days ?? []).map((d: any) => [dayKey(String(d.day_label ?? "")), d]),
    );
    return preview.map((r, k) => {
      const d: any = prefill?.days[k] ?? null;
      const was = published ? null : now.get(dayKey(r.label)) ?? null;
      return {
        label: r.label,
        kcal: r.kcal,
        protein: r.p,
        carbs: r.c,
        fat: r.f,
        fibre: d?.fibre ?? null,
        steps: r.steps,
        cardio: r.noCardio ? "None" : r.cardioMin ? `${r.cardioMin} min` : null,
        meals: d?.notes ?? null,
        was: was ? { kcal: was.calories ?? null, protein: was.protein ?? null, carbs: was.carbs ?? null, fat: was.fats ?? null } : null,
      };
    });
  }, [preview, prefill, currentPlan, published]);

  return (
    <Card className="space-y-4 border-border bg-card p-4 md:col-span-3 md:p-6" data-nutrition-update>
      <CardHeader
        icon={Sparkles}
        title="Nutrition update"
        chip={status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label="Nutrition update options" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => setSendOpen(true)}>
                <Send className="mr-2 h-4 w-4" /> {latest || data?.requestedAt ? "Send a new request" : "Send request"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setManualOpen(true)}>
                <PencilLine className="mr-2 h-4 w-4" /> Build a plan by hand
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCopyOpen(true)}>
                <Copy className="mr-2 h-4 w-4" /> Copy prompts and text…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* One line for where it stands, and the one thing to do next when there is one. */}
      {isLoading ? (
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      ) : !latest && !data?.requestedAt ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Send {firstName} the Nutrition Update form. The AI writes their targets and meal plan from the answers, ready for you to check. It also goes out by itself in the last week of each plan.
          </p>
          <Button variant={currentPlan ? "outline" : "default"} className="w-full gap-2 sm:w-auto" onClick={() => setSendOpen(true)}>
            <Send className="h-4 w-4" /> Send request
          </Button>
        </div>
      ) : !latest ? (
        <p className="text-sm text-muted-foreground">
          Sent {shortDate(data?.requestedAt)}. When {firstName} fills it in, the AI writes the plan here.
        </p>
      ) : !submitted ? (
        <p className="text-sm text-muted-foreground">{firstName} has started the form. The AI writes the plan when they send it.</p>
      ) : writing ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Writing the targets and meal plan. A minute or two; you can leave this page.
        </p>
      ) : plan?.status === "error" ? (
        <div className="space-y-3">
          <p className="text-sm">
            The AI couldn't finish: <span className="text-muted-foreground">{plan.error ?? "unknown error"}</span>
          </p>
          <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={regenerate} disabled={regenerating}>
            <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} /> Try again
          </Button>
        </div>
      ) : ready ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {[`${firstName} sent it ${shortDate(latest.submitted_at)}`, plan?.phase].filter(Boolean).join(" · ")}
          </p>
          {published && (
            <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              {showDetails ? "Hide" : "Details"} <ChevronDown className={cn("h-4 w-4 transition", showDetails && "rotate-180")} />
            </Button>
          )}
        </div>
      ) : null}

      {reviewOpen && plan && (
        <div className="space-y-3">
          {lastPlanSummary(plan.previous_plan ?? null) && (
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">Last plan:</span> {lastPlanSummary(plan.previous_plan ?? null)}
            </p>
          )}
          {checks.length > 0 && (
            <div data-coach-checks className="rounded-xl border border-warning/40 px-3 py-2.5 text-[13px]">
              <div className="flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Check before publishing
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <PlanDaysView days={reviewDays} compareLabel="Their plan now" />
          {prefill && (
            <PrepLine
              foods={planFoodStats(prefill.days)}
              drift={prepDrift(prefill.days.map((d) => ({ label: d.day_label, notes: d.notes })))}
              hardToFind={hardToFindFoods(prefill.days.map((d) => ({ label: d.day_label, notes: d.notes })), latest?.answers ?? [])}
            />
          )}
          {prefill && !prefill.days.length && (
            <p className="text-[13px] text-warning">The meal plan didn't read as days. Copy it and paste it into Build a plan by hand, or regenerate.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Default: one tap updates the client's plan. The editor is there for anything to change by hand. */}
            <Button
              variant={published ? "outline" : "default"}
              className="h-11 gap-2"
              onClick={() => setPublishOpen(true)}
              disabled={!prefill?.days.length || revising}
            >
              <Check className="h-4 w-4" /> {published ? "Publish again" : changedSincePublish ? "Publish the changes" : `Update ${firstName}'s plan`}
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={() => setApplyOpen(true)} disabled={!prefill?.days.length || revising}>
              <PencilLine className="h-4 w-4" /> Review & edit first
            </Button>
          </div>
        </div>
      )}

      {submitted && (reviewOpen || !ready) && (
        <Accordion type="multiple" className="rounded-xl border border-border">
          {reviewOpen && plan && (
            <Section value="change" title="Change something" meta={revising ? "Updating…" : revisions.length ? `${revisions.length} made` : null}>
              <div className="space-y-2">
                {revising ? (
                  <p className="flex items-start gap-2 text-sm">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    <span>Updating: <span className="text-muted-foreground">“{plan.revise_instructions}”</span></span>
                  </p>
                ) : (
                  <>
                    {updateFailed && (
                      <p className="text-[13px]">
                        <span className="text-destructive">Couldn't apply “{plan.revise_instructions}”:</span>{" "}
                        <span className="text-muted-foreground">{plan.error}. The plan is unchanged.</span>{" "}
                        <button type="button" className="font-medium underline" onClick={() => sendChange(plan.revise_instructions ?? "")} disabled={changing}>
                          Try again
                        </button>
                      </p>
                    )}
                    <Textarea
                      id="plan-change"
                      rows={3}
                      maxLength={REVISE_MAX_CHARS}
                      value={change}
                      onChange={(e) => setChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void sendChange();
                        }
                      }}
                      placeholder="e.g. salmon instead of beef on rest days · 4 meals instead of 5 · 30 g fewer carbs on training days"
                    />
                    <p className="text-[13px] text-muted-foreground">Only what you ask changes; the portions rebalance to the targets.</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button variant="outline" className="h-10 gap-1.5" onClick={() => sendChange()} disabled={changing || change.trim().length < 3}>
                        {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Make the change
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-10 gap-1.5"
                        disabled={change.trim().length < 3 || !plan.meal_plan_text}
                        title="The same change as a prompt, to run in ChatGPT or Claude yourself"
                        onClick={() =>
                          plan.meal_plan_text &&
                          copyText(
                            manualRevisePrompt({
                              qas: latest!.answers,
                              targetsText: plan.targets_text ?? "",
                              mealPlanText: plan.meal_plan_text,
                              instructions: change,
                              phase: plan.phase,
                              workoutMeals: plan.workout_meals ?? null,
                              history: data?.trainingPattern ?? null,
                              foodNotes: data?.foodNotes ?? null,
                            }),
                            "Change prompt",
                          )
                        }
                      >
                        <Copy className="h-4 w-4" /> Copy as a prompt
                      </Button>
                    </div>
                  </>
                )}
                {revisions.length > 0 && (
                  <div className="space-y-1 border-t border-border pt-2">
                    <ol className="space-y-0.5 text-[13px] text-muted-foreground">
                      {revisions.slice().reverse().map((r) => (
                        <li key={r.at} className="truncate" title={r.instructions}>
                          <span className="text-foreground">{fmt(r.at)}</span> · {r.instructions}
                        </li>
                      ))}
                    </ol>
                    {!revising && (
                      <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={undoChange} disabled={changing}>
                        <Undo2 className="h-4 w-4" /> Undo the last change
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}
          {reviewOpen && plan?.targets_text && (
            <Section value="targets" title="AI targets">
              <TextBlock title="AI targets" text={plan.targets_text} />
            </Section>
          )}
          {reviewOpen && plan?.meal_plan_text && (
            <Section value="meals" title="Meal plan as text">
              <TextBlock title="Meal plan" text={plan.meal_plan_text} />
            </Section>
          )}
          {latest.answers.length > 0 && (
            <Section value="answers" title="Client answers" meta={`${answered} answered`}>
              <div className="space-y-3">
                {data?.client && (
                  <div className="rounded-lg bg-muted px-3 py-2 text-[13px]">
                    {clientBasicsLines(data.client, latest.answers).map((l) => (
                      <div key={l}>{l}</div>
                    ))}
                  </div>
                )}
                <dl className="space-y-2.5">
                  {latest.answers.map((a) => (
                    <div key={a.label}>
                      <dt className="text-[13px] text-muted-foreground">{a.label}</dt>
                      <dd className="whitespace-pre-wrap text-sm">{a.value || "—"}</dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant="outline"
                  className="h-10 gap-1.5"
                  onClick={() =>
                    copyText(
                      nutritionSubmissionSummary({ client: data?.client ?? data?.clientName ?? "Client", qas: latest.answers, phase: plan?.phase ?? data?.requestedPhase ?? null, submittedAt: latest.submitted_at }),
                      "Client answers",
                    )
                  }
                >
                  <Copy className="h-4 w-4" /> Copy all answers
                </Button>
              </div>
            </Section>
          )}
          {reviewOpen && plan && (
            <Section value="regenerate" title="Regenerate" meta={plan.phase ?? null}>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Phase</Label>
                  <PhaseSelect value={regenPhase} onChange={setRegenPhase} autoLabel={plan.phase ? `Keep ${plan.phase}` : "From their answers"} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Pre / post-workout meals</Label>
                  <WorkoutMealsSelect value={regenWorkoutMeals ?? plan.workout_meals ?? "auto"} onChange={setRegenWorkoutMeals} />
                  {data?.trainingPattern && (
                    <p className="text-[13px] text-muted-foreground" title="From their logged workouts in the last 8 weeks. Places the pre / post-workout meals when their answer is 'It varies' or blank.">
                      They train: {data.trainingPattern.summary}
                    </p>
                  )}
                </div>
                <Button variant="outline" className="h-10 w-full gap-2 sm:w-auto" onClick={regenerate} disabled={regenerating || revising}>
                  <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} /> Regenerate
                </Button>
              </div>
            </Section>
          )}
        </Accordion>
      )}

      <CopyDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        items={[
          { group: "Prompts to run it yourself", label: "Targets, steps and cardio prompt", hint: "with every answer and the context", disabled: !submitted, run: () => latest && copyText(manualTargetsPrompt(data?.client ?? data?.clientName ?? "Client", latest.answers, plan?.phase ?? null, previousPlanText(plan?.previous_plan), { program: data?.programText ?? null, cardio: data?.cardioText ?? null, foodNotes: data?.foodNotes ?? null }), "Targets prompt") },
          { group: "Prompts to run it yourself", label: "Meal plan prompt", hint: "with the AI targets", disabled: !plan?.targets_text || !latest, run: () => plan?.targets_text && latest && copyText(manualMealPlanPrompt(latest.answers, plan.targets_text, plan.phase, regenWorkoutMeals ?? plan.workout_meals ?? data?.requestedWorkoutMeals ?? null, data?.trainingPattern ?? null, previousMealsText(plan.previous_plan), data?.foodNotes ?? null), "Meal plan prompt") },
          { group: "Prompts to run it yourself", label: "Blank targets formula", run: () => copyText(TARGETS_PROMPT, "Targets formula") },
          { group: "Prompts to run it yourself", label: "Blank meal plan formula", run: () => copyText(MEAL_PLAN_PROMPT, "Meal plan formula") },
          { group: "Text", label: "Client answers", disabled: !submitted, run: () => latest && copyText(nutritionSubmissionSummary({ client: data?.client ?? data?.clientName ?? "Client", qas: latest.answers, phase: plan?.phase ?? data?.requestedPhase ?? null, submittedAt: latest.submitted_at }), "Client answers") },
          { group: "Text", label: "AI targets, steps and cardio", disabled: !plan?.targets_text, run: () => plan?.targets_text && copyText(plan.targets_text, "AI targets") },
          { group: "Text", label: "AI meal plan", disabled: !plan?.meal_plan_text, run: () => plan?.meal_plan_text && copyText(plan.meal_plan_text, "AI meal plan") },
          { group: "Text", label: "Last plan and how it went", disabled: !plan?.previous_plan, run: () => copyText(previousPlanText(plan?.previous_plan), "Last plan + results") },
          { group: "Text", label: "Last plan's meals", disabled: !plan?.previous_plan, run: () => copyText(previousMealsText(plan?.previous_plan), "Last plan's meals") },
          { group: "Text", label: "Current cardio", disabled: !data?.cardioText, run: () => data?.cardioText && copyText(data.cardioText, "Current cardio") },
          { group: "Text", label: "Training program", disabled: !data?.programText, run: () => data?.programText && copyText(data.programText, "Training program") },
          { group: "Text", label: "Everything in one block", run: () => copyText(everything(), "Everything") },
        ]}
      />

      <Dialog open={sendOpen} onOpenChange={(o) => !sending && setSendOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send the Nutrition Update</DialogTitle>
            <DialogDescription>
              It lands in {firstName}'s messages as a form. When they send it, the AI writes their targets and meal plan here. It also goes out by itself in the last week of each plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-muted-foreground">Phase for this plan</Label>
            <PhaseSelect value={sendPhase} onChange={setSendPhase} autoLabel="Let their answer decide" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-muted-foreground">Pre / post-workout meals</Label>
            <WorkoutMealsSelect value={sendWorkoutMeals} onChange={setSendWorkoutMeals} />
          </div>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional message, e.g. “New phase starting Monday, fill this out so I can build your plan”"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={sending} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manualOpen && (
        <NutritionTargetDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          clientId={clientId}
          onSaved={() => qc.invalidateQueries({ queryKey: ["nutrition-targets"] })}
        />
      )}

      {applyOpen && prefill && (
        <NutritionTargetDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          clientId={clientId}
          prefill={prefill}
          onSaved={() => {
            // The editor archives the plan it replaces (dated, in Previous plans).
            qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
            if (latest) void appliedFn({ data: { submissionId: latest.id } }).then(() => qc.invalidateQueries({ queryKey: key }));
          }}
        />
      )}

      <Dialog open={publishOpen} onOpenChange={(o) => !publishing && setPublishOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update {firstName}'s plan?</DialogTitle>
            <DialogDescription>The AI plan goes live as it is. Use Review & edit first to change anything.</DialogDescription>
          </DialogHeader>
          <DayRows rows={preview.map((r) => ({ label: r.label, kcal: r.kcal, protein: r.p, carbs: r.c, fat: r.f }))} />
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>Starts today. The next update is due {planDate(nextPlanDates(todayLocalISO()).end_date)}, and {firstName} keeps this plan until a new one replaces it.</li>
            {currentPlan && <li>The current plan ({planPeriod(currentPlan)}) moves to Previous plans with its dates.</li>}
            <li>Meals, steps and cardio update together; water and notes to {firstName} carry over.</li>
            <li>{firstName} gets a notification.</li>
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setPublishOpen(false); setApplyOpen(true); }} disabled={publishing}>Review & edit first</Button>
            <Button onClick={publish} disabled={publishing} className="gap-2">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Update plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const shortDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : "—");

/** The AI's text as it'll be pasted or read, with Copy. */
function TextBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${title} copied`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy. Press and hold the text to copy it.");
    }
  };
  return (
    <div className="space-y-2">
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 font-mono text-[12px] leading-relaxed">{text}</pre>
      <Button variant="outline" className="h-10 gap-1.5" onClick={copy}>
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** One line on how the plan shops and preps: the grocery list size, and anything weighed differently from meal to meal (prepDrift). */
function PrepLine({ foods, drift, hardToFind = [] }: { foods: PlanFoodStats; drift: PrepDrift[]; hardToFind?: HardToFind[] }) {
  if (!foods.total) return null;
  const heavy = foods.total > LEAN_GROCERY_LIST;
  const parts = [
    `${foods.total} foods to shop for${foods.days > 1 ? `, ${foods.everyDay} every day` : ""}`,
    drift.length ? `weighed differently between meals: ${drift.slice(0, 2).map(prepDriftLine).join("; ")}${drift.length > 2 ? ` and ${drift.length - 2} more` : ""}` : "every main meal is the same container",
    ...(hardToFind.length ? [`hard to find in stores: ${hardToFind.map((h) => h.food).join(", ")}`] : []),
  ];
  const warn = heavy || drift.length || hardToFind.length;
  return (
    <p
      data-prep-check={drift.length ? "drift" : "same"}
      data-shelf-check={hardToFind.length ? "hard-to-find" : "staples"}
      className={cn("text-[13px]", warn ? "text-warning" : "text-muted-foreground")}
      title={[foods.foods.join(", "), ...drift.flatMap((d) => d.odd)].join("\n")}
    >
      {parts.join(" · ")}
      {heavy ? ". A lot to shop for: Change something can share staples across the days." : ""}
      {drift.length ? " Change something (\"same portions in every meal\") or fix them in Review & edit first." : ""}
      {hardToFind.length
        ? ` Change something ("${hardToFind[0].kind === "carb" ? "sweet potatoes" : hardToFind[0].kind === "protein" ? "chicken" : "olive oil"} instead of ${hardToFind[0].food}") or Regenerate.`
        : ""}
    </p>
  );
}

type CopyItem = { group: string; label: string; hint?: string; disabled?: boolean; run: () => unknown };

/** Everything that can be copied to run it by hand, one tap each. */
function CopyDialog({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: CopyItem[] }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy for ChatGPT or Claude</DialogTitle>
          <DialogDescription>Each copies to your clipboard, ready to paste.</DialogDescription>
        </DialogHeader>
        {groups.map((g) => (
          <div key={g} className="space-y-1.5">
            <div className="text-[13px] text-muted-foreground">{g}</div>
            <div className="divide-y divide-border rounded-xl border border-border">
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    disabled={i.disabled}
                    onClick={() => {
                      i.run();
                      onOpenChange(false);
                    }}
                    className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{i.label}</span>
                      {i.hint ? <span className="block text-[13px] text-muted-foreground">{i.hint}</span> : null}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
