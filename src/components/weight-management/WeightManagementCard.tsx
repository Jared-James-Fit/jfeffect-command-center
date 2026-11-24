/**
 * Client profile → Nutrition → Weight management: where their bodyweight is
 * heading against the goal, whether the goal is realistic, and the one thing
 * to do about it (often nothing). Every number is the engine's
 * (src/lib/weight-management/, deterministic and tested), read with the
 * coach's own login. A nutrition change goes to Change it with AI to be
 * written and reviewed there; a cardio or water change is applied only on the
 * coach's tap, and every decision is kept (History).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { Droplets, Footprints, History, Info, Scale, Settings2, Stethoscope, Target } from "lucide-react";
import { toast } from "sonner";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardHeader, MoreButton, Section, StatusChip, type ChipTone } from "@/components/nutrition/nutrition-ui";
import { cn } from "@/lib/utils";
import { CONTEXT_LABEL, type Assessment } from "@/lib/weight-management/assessment";
import { LIMITING_WORDS, type Action } from "@/lib/weight-management/decision";
import { prefillPlanAiChange, weightKey } from "@/lib/weight-management/handoff";
import type { TrajectoryStatus } from "@/lib/weight-management/trajectory";
import { sessionLine, type TreadmillSession } from "@/lib/weight-management/treadmill";
import { addDays, fmtDay, fmtPct, fmtRate, fmtWeight, round } from "@/lib/weight-management/units";
import { decideWeightReviewFn, getWeightManagementFn, saveCardioPlanFn, saveWaterTargetFn, type WeightManagementView, type WeightReviewRow } from "@/lib/weight-management/weight-management.functions";
import { GoalSheet, SettingsSheet, TreadmillSheet } from "@/components/weight-management/weight-editors";
import { WeightChart } from "@/components/weight-management/weight-chart";

const STATUS: Record<TrajectoryStatus, { label: string; tone: ChipTone } | null> = {
  not_enough_data: { label: "Needs weigh-ins", tone: "neutral" },
  no_target: null,
  reached: { label: "At the goal", tone: "done" },
  on_track: { label: "On track", tone: "done" },
  ahead: { label: "Ahead", tone: "done" },
  behind: { label: "Behind", tone: "attention" },
  stalled: { label: "Stalled", tone: "attention" },
  wrong_way: { label: "Going the wrong way", tone: "error" },
};

const RANGES = [
  { value: 28, label: "4 weeks" },
  { value: 84, label: "12 weeks" },
  { value: 182, label: "6 months" },
] as const;

const REVIEW_WORD: Record<WeightReviewRow["status"], { label: string; tone: ChipTone }> = {
  open: { label: "Waiting on you", tone: "attention" },
  approved: { label: "Done", tone: "done" },
  dismissed: { label: "Dismissed", tone: "neutral" },
  superseded: { label: "Replaced", tone: "neutral" },
  noted: { label: "No change needed", tone: "neutral" },
};

export function WeightManagementCard({ clientId, className }: { clientId: string; className?: string }) {
  const read = useServerFn(getWeightManagementFn);
  const q = useQuery({
    queryKey: weightKey(clientId),
    queryFn: () => read({ data: { clientId } }) as Promise<WeightManagementView>,
    staleTime: 60_000,
  });
  const [range, setRange] = useState<number>(84);
  const [goalOpen, setGoalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardioOpen, setCardioOpen] = useState<null | { start: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }; reviewId: string | null }>(null);

  // a push or link to #weight lands here
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#weight" && q.data) {
      document.getElementById("weight")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [q.data]);

  const view = q.data;
  const header = (chip?: ReactNode) => (
    <CardHeader
      icon={Scale}
      title="Weight management"
      chip={chip}
      actions={
        view ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label="Weight management options" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setGoalOpen(true)}>
                <Target className="mr-2 h-4 w-4" />
                Bodyweight goal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Cardio and water settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    />
  );

  if (q.isLoading) {
    return (
      <Card id="weight" className={cn("space-y-4 border-border bg-card p-4 md:p-6", className)} data-weight-card>
        {header()}
        <div className="h-[260px] jf-skeleton rounded-xl bg-muted" />
      </Card>
    );
  }
  if (q.isError || !view) {
    return (
      <Card id="weight" className={cn("space-y-3 border-border bg-card p-4 md:p-6", className)} data-weight-card>
        {header()}
        <p className="text-[13px] text-muted-foreground">Couldn't read their weight data. {(q.error as Error)?.message ?? ""}</p>
        <Button variant="outline" className="h-10" onClick={() => q.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const a = view.assessment;
  const t = a.trajectory;
  const status = STATUS[t.status];
  const from = addDays(a.today, -(range - 1));
  const goalCurrent = view.goal;

  return (
    <Card id="weight" className={cn("space-y-5 border-border bg-card p-4 md:p-6", className)} data-weight-card>
      {header(status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null)}

      <GoalLine a={a} onSet={() => setGoalOpen(true)} />

      {t.current ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-weight-tiles>
          <Tile label="Now" value={fmtWeight(t.current.kg, a.unit)} note={t.current.from === "trend" ? "Trend line, noise taken out" : t.current.from === "average" ? "7-day average" : "Last weigh-in"} />
          <Tile
            label="Trend"
            value={t.trend ? perWeek(t.trend.kgPerWeek, a.unit) : "—"}
            note={t.trend ? (t.trend.clear ? `${fmtPct(t.trend.pctPerWeek)} a week · ${t.trend.weighIns} weigh-ins` : `Within normal scatter (±${fmtWeight(t.trend.noiseKg, a.unit)})`) : "Needs 4+ weigh-ins over 10+ days"}
          />
          <Tile label="Needed" value={t.required ? perWeek(t.required.kgPerWeek, a.unit) : "—"} note={t.required ? `${fmtPct(t.required.pctPerWeek)} a week for ${t.required.weeksLeft} weeks` : a.goal ? "No date set" : "No goal set"} />
          <Tile
            label={a.goal?.source === "meet" ? "At weigh-in" : "At the date"}
            value={t.projected ? fmtWeight(t.projected.kg, a.unit) : "—"}
            note={t.projected ? `Likely ${fmtWeight(t.projected.lowKg, a.unit)}–${fmtWeight(t.projected.highKg, a.unit)} · ${t.projected.confidence} confidence` : "Projected once there's a trend and a date"}
          />
        </div>
      ) : null}

      {view.series.length > 0 ? (
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
                className={cn("h-9 flex-1 rounded-md text-[13px] font-medium transition-colors", range === r.value ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <WeightChart a={a} series={view.series} from={from} />
          {t.fluctuation && (
            <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground" data-weight-fluctuation>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              The last weigh-in is {fmtWeight(Math.abs(t.fluctuation.deltaKg), a.unit)} {t.fluctuation.direction} the trend: most likely water, glycogen, salt or gut content, not fat or muscle.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">No weigh-ins yet. The trend and projection show here once they log their weight 4+ mornings a week.</p>
      )}

      {a.target && a.target.verdict !== "reached" && a.target.verdict !== "no_date" && (
        <p className={cn("text-[13px]", a.target.verdict === "too_fast" ? "text-warning" : "text-muted-foreground")} data-weight-realism>
          {a.target.message}
          {a.target.history ? ` ${a.target.history}` : ""}
        </p>
      )}
      {a.weighInTiming && a.goal?.source === "meet" && (
        <p className="text-[13px] text-muted-foreground" data-weight-weigh-in>
          {a.weighInTiming.hours
            ? `Weigh-in about ${a.weighInTiming.hours} hours before lifting (${a.weighInTiming.federation}). The plan gets them there in a normal, fed and hydrated state; anything acute on the day is your call, never the app's.`
            : `Check ${a.weighInTiming.federation ?? "the federation"}'s weigh-in timing. The plan gets them there in a normal, fed and hydrated state.`}
        </p>
      )}

      <Recommendation clientId={clientId} view={view} onCardio={(plan, reviewId) => setCardioOpen({ start: plan, reviewId })} />

      <Accordion type="multiple" className="rounded-xl border border-border">
        <CardioSection a={a} onEdit={(start) => setCardioOpen({ start, reviewId: null })} />
        <WaterSection clientId={clientId} view={view} />
        <CheckinSection a={a} />
        <HistorySection view={view} />
      </Accordion>

      <GoalSheet open={goalOpen} onOpenChange={setGoalOpen} clientId={clientId} view={view} current={goalCurrent} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} clientId={clientId} view={view} />
      {cardioOpen && (
        <TreadmillSheet open={!!cardioOpen} onOpenChange={(b) => !b && setCardioOpen(null)} clientId={clientId} view={view} start={cardioOpen.start} reviewId={cardioOpen.reviewId} />
      )}
    </Card>
  );
}

function GoalLine({ a, onSet }: { a: Assessment; onSet: () => void }) {
  if (!a.goal) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border p-3" data-weight-goal="none">
        <span className="text-[13px] text-muted-foreground">No bodyweight goal yet. Set one to plan the pace and see where they'll land.</span>
        <Button variant="outline" className="h-10" onClick={onSet}>
          Set a goal
        </Button>
      </div>
    );
  }
  const g = a.goal;
  return (
    <button type="button" onClick={onSet} className="w-full text-left" data-weight-goal={g.source}>
      <div className="text-[15px] font-medium">
        {g.label}: {fmtWeight(g.kg, a.unit)}
        {g.date ? ` by ${fmtDay(g.date, a.today)}` : ""}
      </div>
      <div className="text-[13px] text-muted-foreground">
        {CONTEXT_LABEL[a.context]}
        {a.meetWeeksOut != null && g.source === "meet" ? ` · ${a.meetWeeksOut} weeks out` : ""}
        {a.trajectory.gapKg != null && Math.abs(a.trajectory.gapKg) >= 0.1 && a.trajectory.status !== "reached" ? ` · ${fmtWeight(Math.abs(a.trajectory.gapKg), a.unit)} to ${a.trajectory.gapKg < 0 ? "lose" : "gain"}` : ""}
      </div>
    </button>
  );
}

/** "−0.2 kg/wk": a tile's figure, short enough for half a phone. */
function perWeek(kgPerWeek: number, unit: "kg" | "lb"): string {
  return fmtRate(kgPerWeek, unit).replace(" a week", "/wk");
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Recommendation({ clientId, view, onCardio }: { clientId: string; view: WeightManagementView; onCardio: (plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }, reviewId: string | null) => void }) {
  const qc = useQueryClient();
  const decide = useServerFn(decideWeightReviewFn);
  const saveCardio = useServerFn(saveCardioPlanFn);
  const a = view.assessment;
  const r = a.recommendation;
  const [why, setWhy] = useState(false);
  // the open review this read matches (a check-in made it); else the coach acts on the read as it is now
  const open = view.reviews.find((x) => x.status === "open" && x.hash === a.hash) ?? null;
  const reviewId = open?.id ?? null;
  const decided = view.reviews.find((x) => x.hash === a.hash && (x.status === "approved" || x.status === "dismissed")) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: weightKey(clientId) });

  const decideM = useMutation({
    mutationFn: (x: { decision: "approved" | "dismissed"; handedOff?: "change_with_ai"; instruction?: string }) => decide({ data: { clientId, reviewId, ...x } }),
    onSuccess: (_d, x) => {
      refresh();
      if (x.decision === "dismissed") toast.success("Dismissed. It's kept in History.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const cardioM = useMutation({
    mutationFn: (plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }) => saveCardio({ data: { clientId, reviewId, plan } }),
    onSuccess: () => {
      toast.success("Cardio updated. Their workouts follow it.");
      refresh();
      qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't change the cardio"),
  });

  const material = r.actions.filter((x) => x.kind === "nutrition" || x.kind === "cardio");
  const acknowledge = r.verdict === "investigate" || r.verdict === "reconsider_target";
  const busy = decideM.isPending || cardioM.isPending;
  const reasons = r.reasons;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-weight-recommendation={r.verdict}>
      <div className="text-xs font-medium text-muted-foreground" data-weight-limiting={r.limiting}>
        {LIMITING_WORDS[r.limiting]}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{r.headline}</span>
        {decided ? <StatusChip tone={decided.status === "approved" ? "done" : "neutral"}>{decided.status === "approved" ? "Done" : "Dismissed"}</StatusChip> : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {r.evidence === "strong" ? "Strong evidence" : r.evidence === "moderate" ? "Moderate evidence" : "Weak evidence"} · look again in {r.reviewInDays} days
        {r.expected ? ` · ${r.expected}` : ""}
      </div>
      {reasons.length > 0 && (
        <div className="text-[13px] text-muted-foreground">
          {why && (
            <ul className="mb-1 space-y-1">
              {reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
          {reasons.length > 0 && (
            <button type="button" className="mt-1 text-[13px] font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setWhy((w) => !w)}>
              {why ? "Hide why" : "Why"}
            </button>
          )}
        </div>
      )}

      {r.actions.map((act, i) => (
        <ActionView
          key={i}
          act={act}
          a={a}
          hasPlan={!!view.refs.planId}
          disabled={busy || !!decided}
          onNutrition={(instruction) => {
            prefillPlanAiChange(clientId, instruction);
            decideM.mutate({ decision: "approved", handedOff: "change_with_ai", instruction });
            toast.success("It's in Adjust plan on the current plan: send it, check the change, then update their plan.");
          }}
          onCardio={(plan) => cardioM.mutate(plan)}
          onEditCardio={(plan) => onCardio(plan, reviewId)}
        />
      ))}

      {!decided && (material.length > 0 || acknowledge) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {acknowledge && material.length === 0 && (
            <Button variant="outline" className="h-10" disabled={busy} onClick={() => decideM.mutate({ decision: "approved" })}>
              Seen it
            </Button>
          )}
          <Button variant="ghost" className="h-10" disabled={busy} onClick={() => decideM.mutate({ decision: "dismissed" })}>
            Dismiss
          </Button>
        </div>
      )}
      {!material.length && !acknowledge && r.verdict === "maintain" && <p className="text-xs text-muted-foreground">Nothing to change: holding is the right call.</p>}
    </div>
  );
}

function ActionView({
  act,
  a,
  hasPlan,
  disabled,
  onNutrition,
  onCardio,
  onEditCardio,
}: {
  act: Action;
  a: Assessment;
  hasPlan: boolean;
  disabled: boolean;
  onNutrition: (instruction: string) => void;
  onCardio: (plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }) => void;
  onEditCardio: (plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }) => void;
}) {
  const box = "space-y-2 rounded-lg bg-muted/50 p-3 text-[13px]";
  if (act.kind === "nutrition") {
    return (
      <div className={box} data-weight-action="nutrition">
        <div className="font-medium">Nutrition</div>
        <p>{act.instruction}</p>
        <Button variant="outline" className="h-10" disabled={disabled || !hasPlan} onClick={() => onNutrition(act.instruction)}>
          {hasPlan ? "Write it in Adjust plan" : "No current plan to change"}
        </Button>
      </div>
    );
  }
  if (act.kind === "cardio") {
    return (
      <div className={box} data-weight-action="cardio">
        <div className="font-medium">Cardio · {act.direction === "up" ? "a little more" : "a little less"}</div>
        <p>{act.step.why}</p>
        {act.step.weeklyNetKcal != null && act.step.weeklyNetKcal !== 0 && (
          <p className="text-xs text-muted-foreground">About {act.step.weeklyNetKcal > 0 ? "+" : "−"}{Math.abs(act.step.weeklyNetKcal)} kcal a week (an estimate; never eaten back).</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-10" disabled={disabled} onClick={() => onCardio(act.plan)}>
            Apply to their cardio
          </Button>
          <Button variant="ghost" className="h-10" disabled={disabled} onClick={() => onEditCardio(act.plan)}>
            Adjust first
          </Button>
        </div>
      </div>
    );
  }
  if (act.kind === "digestion") {
    return (
      <div className={box} data-weight-action="digestion">
        <div className="font-medium">Worth checking</div>
        <ul className="list-disc space-y-1 pl-4">
          {act.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (act.kind === "medical") {
    return (
      <div className={cn(box, "text-warning")} data-weight-action="medical">
        <div className="flex items-center gap-1.5 font-medium">
          <Stethoscope className="h-4 w-4" aria-hidden /> For a doctor
        </div>
        <p>{act.text}</p>
      </div>
    );
  }
  return (
    <div className={box} data-weight-action={act.kind}>
      <p>{act.text}</p>
      {act.kind === "target" && a.target?.alternative ? <p className="text-xs text-muted-foreground">Change the class on their meet if you agree.</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function TreadmillBlock({ a, plan, treadmill, type }: { a: Assessment; plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }; treadmill: boolean; type: string }) {
  const row = (label: string, s: TreadmillSession | null, days: string) =>
    s ? (
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-muted-foreground">{label}{days ? ` (${days})` : ""}</span>
        <span className="tabular-nums">{sessionLine(s, a.speedUnit, treadmill)}</span>
      </div>
    ) : null;
  return (
    <div className="space-y-1 text-[13px]" data-treadmill-block>
      <div className="font-medium">{type}</div>
      {row("After lifting", plan.trainingDay, plan.trainingDay ? plan.trainingDay.weekdays.map((d) => d.slice(0, 3)).join(", ") : "")}
      {row("Days off", plan.restDay, plan.restDay ? plan.restDay.weekdays.map((d) => d.slice(0, 3)).join(", ") : "")}
      {!plan.trainingDay && !plan.restDay && <div className="text-muted-foreground">None planned.</div>}
    </div>
  );
}

function CardioSection({ a, onEdit }: { a: Assessment; onEdit: (start: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }) => void }) {
  const cur = a.cardio.current;
  const has = !!(cur.trainingDay || cur.restDay);
  const s = a.cardio.suggested;
  const treadmill = a.cardio.modality === "treadmill";
  const meta = has ? (treadmill ? "Treadmill" : a.cardio.keep ?? "Cardio") : "None planned";
  return (
    <Section value="cardio" title="Cardio" icon={Footprints} meta={meta}>
      <div className="space-y-4" data-weight-cardio>
        {has ? (
          <div className="space-y-2">
            <TreadmillBlock a={a} plan={cur} treadmill={treadmill} type={treadmill ? "Their treadmill plan now" : `${a.cardio.keep} (your choice, kept)`} />
            {a.cardio.adherence && <p className="text-xs text-muted-foreground">Done {a.cardio.adherence.done} of {a.cardio.adherence.planned} planned in the last 4 weeks.</p>}
            <Button variant="outline" className="h-10" onClick={() => onEdit(cur)}>
              Edit cardio
            </Button>
          </div>
        ) : null}
        <div className="space-y-2 rounded-lg bg-muted/50 p-3">
          <TreadmillBlock a={a} plan={{ trainingDay: s.trainingDay, restDay: s.restDay }} treadmill type={has ? "A treadmill plan built for them" : s.title} />
          <p className="text-[13px]">Intensity: {s.intensity}{s.heartRate ? ` (about ${s.heartRate.low}–${s.heartRate.high} bpm, an estimate from age)` : ""}.</p>
          {s.weeklyNetKcal ? <p className="text-xs text-muted-foreground">About {s.weeklyNetKcal} kcal a week above resting (an estimate: judge it by the weight trend, never eat it back).</p> : null}
          {s.placement.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {s.placement.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {s.why.length > 0 && <p className="text-xs text-muted-foreground">{s.why.join(" ")}</p>}
          {!has && (
            <Button variant="outline" className="h-10" onClick={() => onEdit({ trainingDay: s.trainingDay, restDay: s.restDay })}>
              Review and use this plan
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function WaterSection({ clientId, view }: { clientId: string; view: WeightManagementView }) {
  const qc = useQueryClient();
  const save = useServerFn(saveWaterTargetFn);
  const h = view.assessment.hydration;
  const cur = view.refs.water;
  const L = (ml: number | null | undefined) => (ml == null ? "—" : `${round(ml / 1000, 1)} L`);
  const m = useMutation({
    mutationFn: () => save({ data: { clientId, restMl: h.restMl!, trainingExtraMl: h.trainingExtraMl ?? 0 } }),
    onSuccess: () => {
      toast.success("Water target updated");
      qc.invalidateQueries({ queryKey: weightKey(clientId) });
      qc.invalidateQueries({ queryKey: ["water-target"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update water"),
  });
  const differs = !h.restricted && h.restMl != null && (!cur || Math.abs(cur.activeMl - h.restMl) >= 200 || (cur.trainingExtraMl ?? 0) !== (h.trainingExtraMl ?? 0));
  return (
    <Section value="water" title="Water" icon={Droplets} meta={h.restricted ? "Their doctor's" : `${L(h.restMl)} · ${L(h.trainingMl)} training`}>
      <div className="space-y-2 text-[13px]" data-weight-water>
        {h.restricted ? (
          <p className="text-warning">{h.why[0]}</p>
        ) : (
          <>
            <p>
              Plain water: {L(h.restMl)} on days off, {L(h.trainingMl)} on training days. {h.totalFluidNote.replace(/^Plain water\. /, "")}
            </p>
            <p className="text-xs text-muted-foreground">Now: {cur ? `${L(cur.activeMl)}${cur.trainingExtraMl ? ` (+${L(cur.trainingExtraMl)} on training days)` : ""}` : "no target set"}. Never more than about 1 L an hour.</p>
            {h.electrolytes && <p>{h.electrolytes}</p>}
            {h.ramp && <p className="text-muted-foreground">They average {L(h.ramp.fromMl)}: build up about 0.5 L a week ({h.ramp.weeks} weeks) rather than jumping to it.</p>}
            <p className="text-xs text-muted-foreground">{h.why.join(" ")}</p>
            {differs && (
              <Button variant="outline" className="h-10" disabled={m.isPending || !view.hasLogin} onClick={() => m.mutate()}>
                {view.hasLogin ? "Use this water target" : "They need to sign in first"}
              </Button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function CheckinSection({ a }: { a: Assessment }) {
  const c = a.checkins;
  const d = a.digestion;
  const flags = [c.poorSleep ? `sleep ${c.poorSleep}` : null, c.lowEnergy ? `energy ${c.lowEnergy}` : null, c.stress ? `stress ${c.stress}` : null].filter(Boolean);
  const meta = c.count ? (c.adherence != null ? `On plan ${c.adherence}/5` : `${c.count} check-ins`) : "None yet";
  return (
    <Section value="checkins" title="Check-ins" icon={Stethoscope} meta={meta}>
      <div className="space-y-2 text-[13px]" data-weight-checkins>
        {c.count ? (
          <>
            <p>
              Last check-in {c.latest ? format(parseISO(c.latest), "MMM d") : "—"}
              {c.adherence != null ? ` · sticking to the plan ${c.adherence}/5 (last 3)` : ""}
              {c.hungerHigh ? " · hunger high" : ""}
            </p>
            {flags.length > 0 && <p className="text-muted-foreground">Flagged in the last 3: {flags.join(", ")}.</p>}
            {c.cardioIssues.length > 0 && <p className="text-muted-foreground">Cardio: {c.cardioIssues.join(", ").toLowerCase()}.</p>}
            {c.waterIssues.length > 0 && <p className="text-muted-foreground">Water: {c.waterIssues.join(", ").toLowerCase()}.</p>}
          </>
        ) : (
          <p className="text-muted-foreground">No weekly check-ins yet.</p>
        )}
        {d.summary ? (
          <div className="space-y-1" data-weight-digestion>
            <p className="font-medium">{d.summary}.</p>
            {d.medical && <p className="text-warning">{d.medical}</p>}
            {d.suggestions.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {d.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Patterns worth checking, not causes. A bloated or backed-up gut also reads heavy on the scale and the tape.</p>
          </div>
        ) : c.count ? (
          <p className="text-muted-foreground">No digestion problems flagged.</p>
        ) : null}
        {a.waist && <p className="text-muted-foreground">Waist {a.waist.changeCm > 0 ? "+" : ""}{a.waist.changeCm} cm over {a.waist.weeks} weeks.</p>}
        {a.performance.detail && <p className="text-muted-foreground">Lower lifts: {a.performance.detail}</p>}
      </div>
    </Section>
  );
}

function HistorySection({ view }: { view: WeightManagementView }) {
  const rows = view.reviews;
  return (
    <Section value="history" title="History" icon={History} meta={rows.length ? `${rows.length} recent` : "Nothing yet"}>
      <div className="space-y-2" data-weight-history>
        {rows.length === 0 && <p className="text-[13px] text-muted-foreground">Each weekly check-in's recommendation and what you did with it is kept here.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2 text-[13px] last:border-b-0 last:pb-0">
            <div className="min-w-0">
              <div className="font-medium">{r.headline}</div>
              <div className="text-xs text-muted-foreground">
                {format(parseISO(r.created_at), "MMM d")} · {r.source === "checkin" ? "after a check-in" : "your review"}
                {r.decided_at ? ` · decided ${format(parseISO(r.decided_at), "MMM d")}` : ""}
                {appliedWords(r.applied)}
              </div>
            </div>
            <StatusChip tone={REVIEW_WORD[r.status].tone}>{REVIEW_WORD[r.status].label}</StatusChip>
          </div>
        ))}
      </div>
    </Section>
  );
}

function appliedWords(applied: unknown): string {
  if (!Array.isArray(applied) || !applied.length) return "";
  const kinds = new Set(applied.map((x: any) => x?.kind));
  const parts = [kinds.has("nutrition") ? "nutrition sent to Adjust plan" : null, kinds.has("cardio") ? "cardio changed" : null, kinds.has("water") ? "water changed" : null].filter(Boolean);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

export default WeightManagementCard;
