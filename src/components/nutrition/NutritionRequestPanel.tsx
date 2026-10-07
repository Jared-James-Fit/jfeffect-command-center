/**
 * Client profile → Nutrition: send the native Nutrition Update Request and
 * work the AI output (targets + paste-ready meal plan) into the client's
 * nutrition targets.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, ClipboardList, Copy, Dumbbell, FileText, Loader2, RefreshCw, Send, Sparkles, Wand2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { NUTRITION_PHASES, PHASE_GOAL, phaseFromPlanText, phaseFromText } from "@/lib/nutrition-cardio";
import { MEAL_PLAN_PROMPT, TARGETS_PROMPT, clientBasicsLines, manualMealPlanPrompt, manualTargetsPrompt, nutritionSubmissionSummary, type WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";
import { WorkoutMealsSelect, workoutMealsLabel } from "@/components/nutrition/WorkoutMealsSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  generateNutritionPlanFn,
  listNutritionRequestsFn,
  markNutritionPlanAppliedFn,
  sendNutritionRequestFn,
} from "@/lib/nutrition-ai-plans.functions";
import { parseFoodWeighingRules, parseMealPlan } from "@/components/nutrition/MealPlanBulkPaste";
import { NutritionTargetDialog } from "@/components/nutrition-target-dialog";

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
    phase: string | null;
    workout_meals?: WorkoutMealsMode | null;
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

function CopyBlock({ title, text, icon, defaultOpen = true }: { title: string; text: string; icon: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${title} copied`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy — long-press the text to copy it");
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-secondary/20">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {icon}
          <span className="truncate text-xs font-black uppercase tracking-widest">{title}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} />
        </button>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {open && (
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-border bg-background/60 px-3 py-2.5 font-mono text-[12px] leading-relaxed">{text}</pre>
      )}
    </div>
  );
}

export function NutritionRequestPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNutritionRequestsFn);
  const sendFn = useServerFn(sendNutritionRequestFn);
  const genFn = useServerFn(generateNutritionPlanFn);
  const appliedFn = useServerFn(markNutritionPlanAppliedFn);
  const [sendOpen, setSendOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
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
      const r = reqs?.[0];
      const waiting = r && r.status !== "in_progress" && (!r.plan || r.plan.status === "generating" || r.plan.status === "pending");
      return waiting ? 4000 : false;
    },
  });
  const requests = (data?.requests ?? []) as Req[];
  const latest = requests[0] ?? null;
  const submitted = latest && latest.status !== "in_progress";
  const plan = latest?.plan ?? null;

  const prefill = useMemo(() => {
    if (!plan?.meal_plan_text) return null;
    const days = parseMealPlan(plan.meal_plan_text);
    return {
      days,
      structure: structureFor(days.map((d) => d.day_label)),
      food_weighing_rules: parseFoodWeighingRules(plan.meal_plan_text),
      admin_notes: plan.targets_text ?? null,
      phase: plan.phase ?? phaseFromPlanText(plan.meal_plan_text) ?? phaseFromText(plan.targets_text?.match(/^Goal:\s*(.+)$/m)?.[1]),
    };
  }, [plan?.meal_plan_text, plan?.targets_text, plan?.phase]);

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

  const statusChip = !latest
    ? data?.requestedAt ? { label: "Sent · waiting on client", tone: "sky" } : { label: "Not requested", tone: "muted" }
    : !submitted ? { label: "Client filling it out", tone: "sky" }
    : plan?.applied_at ? { label: "Applied to targets", tone: "emerald" }
    : plan?.status === "ready" ? { label: "AI plan ready", tone: "amber" }
    : plan?.status === "error" ? { label: "AI failed", tone: "rose" }
    : { label: "AI is building the plan…", tone: "amber" };
  const tones: Record<string, string> = {
    muted: "border-border text-muted-foreground",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };

  return (
    <Card className="space-y-4 border-border bg-card p-4 md:col-span-3 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
              <Sparkles className="h-4 w-4 text-primary" /> Nutrition Update Request
            </h3>
            <Badge variant="outline" className={cn("text-[10px]", tones[statusChip.tone])}>{statusChip.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLoading ? "Loading…"
              : submitted ? `Submitted ${fmt(latest!.submitted_at)} · AI builds the targets and a paste-ready meal plan automatically.`
              : "Send the form → client fills it out → AI builds their targets and meal plan for you to review and apply."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Once sent, this repeats automatically on the Monday that starts the final week of each month (9am their time).
          </p>
          {data?.trainingPattern && (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground" title="From their logged workouts in the last 8 weeks. Used to place Pre/Post-Workout meals when their form answer is 'It varies' or blank.">
              <Dumbbell className="mt-px h-3 w-3 shrink-0 text-primary" />
              <span>Trains: {data.trainingPattern.summary}</span>
            </p>
          )}
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1.5" title="Copy the AI prompts to run them manually">
                <FileText className="h-4 w-4" /> Prompts
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs">Run it manually in ChatGPT / Claude</DropdownMenuLabel>
              {submitted ? (
                <>
                  <DropdownMenuItem onClick={() => copyText(manualTargetsPrompt(data?.client ?? data?.clientName ?? "Client", latest!.answers, plan?.phase ?? null), "Targets prompt")}>
                    1 · Targets prompt <span className="ml-auto text-[10px] text-muted-foreground">with answers</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!plan?.targets_text}
                    onClick={() => plan?.targets_text && copyText(manualMealPlanPrompt(latest!.answers, plan.targets_text, plan.phase, regenWorkoutMeals ?? plan.workout_meals ?? data?.requestedWorkoutMeals ?? null, data?.trainingPattern ?? null), "Meal plan prompt")}
                  >
                    2 · Meal plan prompt <span className="ml-auto text-[10px] text-muted-foreground">with targets</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onClick={() => copyText(TARGETS_PROMPT, "Targets formula")}>Blank targets formula</DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyText(MEAL_PLAN_PROMPT, "Meal plan formula")}>Blank meal plan formula</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="flex-1 gap-2 bg-gradient-primary font-bold sm:flex-none" onClick={() => setSendOpen(true)}>
            <Send className="h-4 w-4" /> {latest || data?.requestedAt ? "Send new request" : "Send request"}
          </Button>
        </div>
      </div>

      {submitted && (!plan || plan.status === "generating" || plan.status === "pending") && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          AI is calculating targets and writing the meal plan — about 30 seconds.
        </div>
      )}

      {submitted && plan?.status === "error" && (
        <div className="flex flex-col gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>AI couldn't finish: <span className="text-muted-foreground">{plan.error ?? "unknown error"}</span></span>
          <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", regenerating && "animate-spin")} /> Try again
          </Button>
        </div>
      )}

      {submitted && plan?.status === "ready" && (
        <div className="space-y-3">
          {plan.targets_text && <CopyBlock title="AI targets" text={plan.targets_text} icon={<ClipboardList className="h-4 w-4 text-primary" />} />}
          {plan.meal_plan_text && (
            <CopyBlock title="Meal plan · paste-ready" text={plan.meal_plan_text} icon={<Wand2 className="h-4 w-4 text-primary" />} defaultOpen={false} />
          )}
          {(plan.phase || plan.workout_meals) && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {plan.phase && (
                <div>Phase used: <span className="font-bold text-foreground">{plan.phase}</span> · {PHASE_GOAL[plan.phase] ?? ""}</div>
              )}
              {plan.workout_meals && (
                <div>Workout meals: <span className="font-bold text-foreground">{workoutMealsLabel(plan.workout_meals)}</span></div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button className="gap-2 font-bold" onClick={() => setApplyOpen(true)} disabled={!prefill?.days.length}>
              <Check className="h-4 w-4" /> {plan.applied_at ? "Apply again" : "Review & apply to targets"}
            </Button>
            <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
              <div className="min-w-0 sm:w-44">
                <PhaseSelect value={regenPhase} onChange={setRegenPhase} autoLabel="Phase: keep / auto" />
              </div>
              <div className="min-w-0 sm:w-52">
                <WorkoutMealsSelect
                  value={regenWorkoutMeals ?? plan.workout_meals ?? "auto"}
                  onChange={setRegenWorkoutMeals}
                />
              </div>
              <Button variant="outline" className="col-span-2 shrink-0 gap-2 sm:col-span-1" onClick={regenerate} disabled={regenerating}>
                <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} /> Regenerate
              </Button>
            </div>
          </div>
          {prefill && !prefill.days.length && (
            <p className="text-xs text-amber-600">The meal plan didn't parse into days — copy it and paste it into Add Targets, or regenerate.</p>
          )}
        </div>
      )}

      {submitted && latest!.answers.length > 0 && (
        <div className="rounded-xl border border-border">
          <div className="flex items-center gap-1 pr-1.5">
            <button
              type="button"
              onClick={() => setShowAnswers(!showAnswers)}
              className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground"
            >
              <span className="truncate">
                Client answers ({latest!.answers.filter((a) => a.value).length})
              </span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 transition", showAnswers && "rotate-180")}
              />
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 gap-1.5 text-xs font-bold"
              title="Copy name, sex, age, height and every answer as one block"
              onClick={() =>
                copyText(
                  nutritionSubmissionSummary({
                    client: data?.client ?? data?.clientName ?? "Client",
                    qas: latest!.answers,
                    phase: plan?.phase ?? data?.requestedPhase ?? null,
                    submittedAt: latest!.submitted_at,
                  }),
                  "Client form",
                )
              }
            >
              <Copy className="h-3.5 w-3.5" /> Copy all
            </Button>
          </div>
          {showAnswers && (
            <dl className="space-y-2 border-t border-border px-3 py-3 text-sm">
              {data?.client && (
                <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
                  {clientBasicsLines(data.client, latest!.answers).map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
              )}
              {latest!.answers.map((a) => (
                <div key={a.label}>
                  <dt className="text-[11px] font-semibold text-muted-foreground">{a.label}</dt>
                  <dd className="whitespace-pre-wrap">{a.value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <Dialog open={sendOpen} onOpenChange={(o) => !sending && setSendOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Nutrition Update Request</DialogTitle>
            <DialogDescription>Lands in the client's messages as a form card. When they submit, AI builds their targets and meal plan here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Phase / goal for this plan</Label>
            <PhaseSelect value={sendPhase} onChange={setSendPhase} autoLabel="Let the client's answer decide" />
            <p className="text-[11px] text-muted-foreground">Sets the calorie direction the AI uses (deficit, surplus or maintenance).</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Pre / Post-Workout meals</Label>
            <WorkoutMealsSelect value={sendWorkoutMeals} onChange={setSendWorkoutMeals} />
            <p className="text-[11px] text-muted-foreground">The client is asked when they train; this overrides it if you want.</p>
          </div>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional message, e.g. “New phase starting Monday — fill this out so I can build your plan 🔥”"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={sending} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {applyOpen && prefill && (
        <NutritionTargetDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          clientId={clientId}
          prefill={prefill}
          onSaved={async (targetId) => {
            // The new plan replaces the old one: archive any other active targets.
            await supabase
              .from("nutrition_targets")
              .update({ status: "Archived" })
              .eq("client_id", clientId)
              .neq("id", targetId)
              .neq("status", "Archived");
            qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
            if (latest) void appliedFn({ data: { submissionId: latest.id } }).then(() => qc.invalidateQueries({ queryKey: key }));
          }}
        />
      )}
    </Card>
  );
}
