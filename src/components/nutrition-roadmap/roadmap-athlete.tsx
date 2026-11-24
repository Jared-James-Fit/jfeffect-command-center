/**
 * The athlete's roadmap on their Nutrition page: one compact card (the block
 * they're in, the goal and its date, where they stand against the timeline,
 * the next check-in and the next milestone), the whole journey a tap away,
 * and for a self-coached athlete their goal, their check-in and the updates
 * they accept or decline. A coached athlete sees their roadmap only once
 * their coach approved it, and changes nothing here (their coach does).
 */
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarCheck, ChevronRight, Download, Flag, Loader2, Route, ShieldAlert } from "lucide-react";
import { makeAndDeliverPdf } from "@/lib/pdf/deliver";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/today";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { fmtDay, fmtWeight, fromKg, round, toKg } from "@/lib/weight-management/units";
import { decideRoadmapRevisionFn, explainRoadmapFn, saveMyRoadmapGoalFn, setRoadmapConsentFn, submitRoadmapCheckinFn } from "@/lib/nutrition-roadmap/roadmap.functions";
import { missingAnswers, roadmapCheckinQuestions, type RoadmapQuestion } from "@/lib/nutrition-roadmap/questions";
import { GOAL_KIND_LABEL, type RoadmapRead } from "@/lib/nutrition-roadmap/types";
import { kcalWords, toYou, type RoadmapView } from "@/lib/nutrition-roadmap/view";
import { classLimitKg } from "@/lib/weight-management/target";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { BlockTimeline, FeasibilityDetail, HistoryList, StatusBadge, StatusLine, journeyProgress } from "@/components/nutrition-roadmap/roadmap-parts";
import { ROADMAP_ROOT, useMyRoadmap } from "@/components/nutrition-roadmap/roadmap-queries";

const day = (iso: string) => fmtDay(iso, todayLocalISO());

// The chart (and the charting library under it, ~100 KB compressed) is only in the
// roadmap's sheet: loaded when the sheet opens, never with the Nutrition page.
const RoadmapChart = lazyWithRetry(() => import("@/components/nutrition-roadmap/roadmap-chart").then((m) => ({ default: m.RoadmapChart })));

function goalLine(read: RoadmapRead, unit: "kg" | "lb"): string | null {
  const g = read.plan.goal;
  if (!g) return null;
  const now = read.progress.currentKg;
  const parts = [now != null ? `${fmtWeight(now, unit)} now` : null, g.kg != null ? `${fmtWeight(g.kg, unit)}${g.date ? ` by ${day(g.date)}` : ""}` : g.date ? `until ${day(g.date)}` : null].filter(Boolean);
  return `${parts.join(" → ")}${g.eventName ? ` · ${g.eventName}` : ""}`;
}

/** "Next checkpoint: about 67.7 kg by Dec 5", "Next: Strength peak starts Jan 25", "Next: CPU Nationals, Feb 14". */
export function milestoneWords(m: NonNullable<RoadmapRead["nextMilestone"]>, unit: "kg" | "lb"): string {
  if (m.kind === "checkpoint") return `Next checkpoint: ${m.kg != null ? `about ${fmtWeight(m.kg, unit)}` : "on plan"} by ${day(m.date)}`;
  if (m.kind === "block") return `Next: ${m.label} starts ${day(m.date)}`;
  return `Next: ${m.label}, ${day(m.date)}`;
}

/** The card on the Nutrition page. Nothing at all when there's no roadmap to show (and no goal to set). */
export function NutritionRoadmapCard({ className }: { className?: string }) {
  const q = useMyRoadmap();
  const v = q.data ?? null;
  const [sheet, setSheet] = useState(false);
  const [checkin, setCheckin] = useState(false);
  const [goal, setGoal] = useState(false);

  // a push or a link to #roadmap opens what it's about
  useEffect(() => {
    if (!v || typeof window === "undefined" || window.location.hash !== "#roadmap") return;
    document.getElementById("roadmap")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (v.checkin.due && v.canEdit) setCheckin(true);
    else if (v.state === "ready") setSheet(true);
  }, [v]);

  if (!v) return null;
  if (v.state === "waiting_coach") return null;
  if (v.state === "no_goal") {
    if (!v.selfCoached || !v.canEdit) return null;
    return (
      <>
        <Card id="roadmap" className={cn("p-4", className)} data-roadmap-card="no-goal">
          <div className="flex items-start gap-3">
            <Route className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">Plan your nutrition roadmap</div>
              <p className="text-[14px] text-muted-foreground">Set a goal and a date. You get the whole journey in blocks, honest about what's realistic, and it adapts as your weigh-ins come in.</p>
              <Button className="mt-3 h-11" onClick={() => setGoal(true)}>
                Set a goal
              </Button>
            </div>
          </div>
        </Card>
        <RoadmapGoalSheet open={goal} onOpenChange={setGoal} view={v} />
      </>
    );
  }
  const read = v.read;
  if (!read) return null;
  const block = read.currentBlock;
  const today = todayLocalISO();
  const prog = journeyProgress(read.plan, today);
  const line = goalLine(read, v.unit);
  const pendingForMe = v.pending && v.pending.decider === "athlete";

  return (
    <>
      <Card id="roadmap" className={cn("p-4", className)} data-roadmap-card="ready">
        <button type="button" onPointerDown={() => void RoadmapChart.preload()} onClick={() => setSheet(true)} className="block w-full text-left" aria-label="Open your nutrition roadmap">
          <div className="flex items-start gap-3">
            <Route className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-base font-semibold">{block ? block.title : "Your roadmap"}</div>
                <StatusBadge status={read.progress.status} />
              </div>
              {line && <div className="mt-0.5 text-[14px] text-muted-foreground">{line}</div>}
              {prog && (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.round(prog.frac * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    Week {prog.week} of {prog.weeks}
                  </div>
                </div>
              )}
              <div className="mt-2 grid gap-0.5 text-[13px] text-muted-foreground">
                <span>{v.selfCoached ? "Next check-in" : "Next review"}: {day(read.checkin.on)}</span>
                {read.nextMilestone && <span>{milestoneWords(read.nextMilestone, v.unit)}</span>}
              </div>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        </button>
        {v.canEdit && v.checkin.due && (
          <Button className="mt-3 h-11 w-full" onClick={() => setCheckin(true)} data-roadmap-checkin-open>
            <CalendarCheck className="mr-2 h-4 w-4" aria-hidden />
            Check in · under a minute
          </Button>
        )}
        {pendingForMe && (
          <button type="button" onClick={() => setSheet(true)} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-lg border border-warning/40 px-3 text-left text-[14px]" data-roadmap-pending>
            <span>An update to your roadmap is waiting for you</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        )}
      </Card>
      <RoadmapSheet open={sheet} onOpenChange={setSheet} view={v} onEditGoal={() => setGoal(true)} />
      {v.selfCoached && v.canEdit && <RoadmapCheckinSheet open={checkin} onOpenChange={setCheckin} view={v} />}
      {v.selfCoached && v.canEdit && <RoadmapGoalSheet open={goal} onOpenChange={setGoal} view={v} />}
    </>
  );
}

function SheetFrame({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[92dvh] overflow-y-auto rounded-t-3xl p-0">
        <div className="mx-auto max-w-xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <SheetHeader className="space-y-0">
            <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-6">{children}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function RoadmapSheet({ open, onOpenChange, view, onEditGoal }: { open: boolean; onOpenChange: (o: boolean) => void; view: RoadmapView; onEditGoal: () => void }) {
  const read = view.read!;
  const qc = useQueryClient();
  const explain = useServerFn(explainRoadmapFn);
  const decide = useServerFn(decideRoadmapRevisionFn);
  const consent = useServerFn(setRoadmapConsentFn);
  const [words, setWords] = useState(view.explanation);
  const [busy, setBusy] = useState<string | null>(null);
  const { client: viewing } = useClientImpersonation();
  const viewAs = viewing?.user_id ?? null;
  const g = read.plan.goal;

  useEffect(() => {
    if (!open || words || !view.activeRevisionId) return;
    let live = true;
    explain({ data: viewAs ? { viewAsUserId: viewAs } : {} })
      .then((w) => live && w && setWords(w))
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [open, words, view.activeRevisionId, explain, viewAs]);

  const decideIt = async (decision: "approve" | "reject") => {
    if (!view.pending) return;
    setBusy(decision);
    try {
      const r = await decide({ data: { revisionId: view.pending.id, decision } });
      toast.success(decision === "approve" ? (r.targetsWritten ? "Your new targets are set" : "Roadmap updated") : "Kept as it was");
      await qc.invalidateQueries({ queryKey: ROADMAP_ROOT });
      await qc.invalidateQueries({ queryKey: ["m-nutrition-targets"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  const setConsent = async (on: boolean) => {
    setBusy("consent");
    try {
      await consent({ data: { consent: on } });
      await qc.invalidateQueries({ queryKey: ROADMAP_ROOT });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  const p = view.pending;
  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title={g ? `${GOAL_KIND_LABEL[g.kind]}${g.date ? ` · ${day(g.date)}` : ""}` : "Your roadmap"}>
      <div className="flex items-center gap-2">
        <StatusBadge status={read.progress.status} />
        {g?.kg != null && <span className="text-[14px] text-muted-foreground">Target {fmtWeight(g.kg, view.unit)}</span>}
      </div>
      <StatusLine read={read} explanation={words} voice="athlete" />

      {read.plan.safety.referral && (
        <div className="flex gap-2 rounded-lg border border-warning/40 p-3 text-[14px]" data-roadmap-safety>
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>{toYou(read.plan.safety.referral)}</span>
        </div>
      )}

      {p && p.decider === "athlete" && view.canEdit && (
        <div className="space-y-2 rounded-lg border border-border p-3" data-roadmap-proposal>
          <div className="text-[15px] font-semibold">{p.proposal?.headline ?? "An update to your roadmap"}</div>
          <ul className="space-y-0.5 text-[14px] text-muted-foreground">
            {p.changes.filter((c) => c !== p.proposal?.headline).slice(0, 5).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {p.proposal?.next && (
            <div className="rounded-md bg-muted/50 p-2.5 text-[14px] tabular-nums">
              New targets: {p.proposal.next.kcal} kcal · P {p.proposal.next.proteinG} · C {p.proposal.next.carbsG} · F {p.proposal.next.fatG}
              {p.proposal.kcalChange ? <span className="text-muted-foreground"> ({kcalWords(p.proposal.kcalChange)})</span> : null}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button className="h-11 flex-1" onClick={() => void decideIt("approve")} disabled={!!busy}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept"}
            </Button>
            <Button className="h-11 flex-1" variant="outline" onClick={() => void decideIt("reject")} disabled={!!busy}>
              Not now
            </Button>
          </div>
        </div>
      )}

      {read.decision.action !== "hold" && read.decision.approval === "coach" && <p className="text-[14px] text-muted-foreground">Your coach is looking at what to change. Nothing changes until they do.</p>}

      {view.selfCoached && !(p && p.decider === "athlete") && ["investigate", "reconsider", "escalate"].includes(read.decision.action) && (
        <div className="space-y-1.5 rounded-lg border border-border p-3 text-[14px]" data-roadmap-suggestion={read.decision.action}>
          <div className="text-[15px] font-semibold">{read.decision.headline}</div>
          {[...new Set([...read.decision.reasons.slice(-2), ...read.decision.other.slice(0, 2)])].map((r) => (
            <p key={r} className="text-muted-foreground">{toYou(r)}</p>
          ))}
          {read.decision.action === "reconsider" && view.canEdit && (
            <Button variant="outline" className="mt-1 h-11 w-full" onClick={onEditGoal}>
              Change the goal
            </Button>
          )}
        </div>
      )}

      <Part title="Bodyweight against the plan">
        <Suspense fallback={<div className="h-[244px] w-full rounded-xl bg-muted/40" aria-hidden />}>
          <RoadmapChart read={read} series={view.series} unit={view.unit} />
        </Suspense>
      </Part>

      <Part title="The journey">
        <BlockTimeline plan={read.plan} unit={view.unit} voice="athlete" />
        <p className="text-[13px] text-muted-foreground">Only the block you're in is final. Everything after it is a forecast that updates as your data comes in.</p>
      </Part>

      <Part title={view.selfCoached ? "Next check-in" : "Next review"}>
        <p className="text-[14px]">
          {day(read.checkin.on)} · <span className="text-muted-foreground">{read.checkin.reason}</span>
        </p>
      </Part>

      {g && (
        <Part title="Is the goal realistic?">
          <FeasibilityDetail f={read.plan.feasibility} unit={view.unit} voice="athlete" />
        </Part>
      )}

      {read.plan.missing.length > 0 && view.selfCoached && (
        <Part title="What would make it more accurate">
          <ul className="list-disc space-y-0.5 pl-5 text-[14px] text-muted-foreground">
            {read.plan.missing.map((m) => (
              <li key={m}>{toYou(m)}</li>
            ))}
          </ul>
        </Part>
      )}

      {view.selfCoached && view.canEdit && (
        <Part title="Small changes">
          <label className="flex items-start justify-between gap-3 text-[14px]">
            <span>
              Let small, routine changes apply by themselves
              <span className="block text-[13px] text-muted-foreground">Up to 150 kcal a day, never with a health flag or in a competition phase. You'll see each one here, and you can turn this off any time.</span>
            </span>
            <Switch checked={view.consent} onCheckedChange={(on) => void setConsent(on)} disabled={busy === "consent"} aria-label="Let small changes apply by themselves" />
          </label>
        </Part>
      )}

      <Part title="What changed">
        <HistoryList history={view.history} />
      </Part>

      {view.selfCoached && view.canEdit && (
        <Button variant="outline" className="h-11 w-full" onClick={onEditGoal}>
          <Flag className="mr-2 h-4 w-4" aria-hidden />
          Change the goal
        </Button>
      )}

      <Button
        variant="ghost"
        className="h-11 w-full text-muted-foreground"
        data-roadmap-pdf
        onClick={() => void makeAndDeliverPdf("Nutrition roadmap", async () => (await import("@/lib/nutrition-roadmap/roadmap-pdf")).roadmapPdfFile(view, "athlete"))}
      >
        <Download className="mr-2 h-4 w-4" aria-hidden />
        Download PDF
      </Button>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------------------ */
/* Check-in                                                                  */

function Rating({ q, value, onChange }: { q: RoadmapQuestion; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn("flex min-h-14 flex-col items-center justify-center rounded-lg border text-[15px] font-semibold", value === n ? "border-foreground bg-foreground text-background" : "border-border")}
          aria-pressed={value === n}
        >
          {n}
          {q.scale && <span className={cn("mt-0.5 text-[10px] font-normal leading-tight", value === n ? "text-background/80" : "text-muted-foreground")}>{q.scale[n - 1]}</span>}
        </button>
      ))}
    </div>
  );
}

function Choices({ q, value, onChange }: { q: RoadmapQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const multi = q.type === "multi";
  const picked = (o: string) => (multi ? Array.isArray(value) && (value as string[]).includes(o) : value === o);
  const tap = (o: string) => {
    if (!multi) return onChange(value === o ? undefined : o);
    const cur = Array.isArray(value) ? (value as string[]) : [];
    if (q.exclusive && o === q.exclusive) return onChange(cur.includes(o) ? [] : [o]);
    const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur.filter((x) => x !== q.exclusive), o];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {(q.options ?? []).map((o) => (
        <button key={o} type="button" onClick={() => tap(o)} aria-pressed={picked(o)} className={cn("min-h-11 rounded-full border px-3.5 text-[14px]", picked(o) ? "border-foreground bg-foreground text-background" : "border-border")}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function RoadmapCheckinSheet({ open, onOpenChange, view }: { open: boolean; onOpenChange: (o: boolean) => void; view: RoadmapView }) {
  const qc = useQueryClient();
  const submit = useServerFn(submitRoadmapCheckinFn);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const questions = useMemo(() => roadmapCheckinQuestions(view.checkin.asks, view.sex), [view.checkin.asks, view.sex]);
  const shown = questions.filter((q) => !q.showWhen || q.showWhen(answers));
  const missing = missingAnswers(questions, answers);
  const weighIns14 = view.read?.progress.reliability.weighIns14 ?? 0;

  const send = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(answers).filter(([k, v]) => v != null && v !== "" && shown.some((q) => q.key === k))) as Record<string, string | number | string[]>;
      const r = await submit({ data: { answers: clean } });
      toast.success(r.decision, { description: `Next check-in ${day(r.nextOn)}.${r.update ? " An update is waiting on your roadmap." : ""}${r.autoApplied ? " A small change was applied, as you allowed." : ""}`, duration: 8000 });
      setAnswers({});
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ROADMAP_ROOT });
      await qc.invalidateQueries({ queryKey: ["m-nutrition-targets"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send your check-in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Nutrition check-in">
      <p className="text-[14px] text-muted-foreground">
        Your weigh-ins come from your log ({weighIns14} in the last 2 weeks), nothing to type.
      </p>
      {shown.map((q) => (
        <div key={q.key} className="space-y-2" data-checkin-q={q.key}>
          <div>
            <div className="text-[15px] font-semibold">
              {q.prompt}
              {q.optional && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">Optional</span>}
            </div>
            {q.helper && <div className="text-[13px] text-muted-foreground">{q.helper}</div>}
          </div>
          {q.type === "rating" ? (
            <Rating q={q} value={answers[q.key] as number | undefined} onChange={(n) => setAnswers((a) => ({ ...a, [q.key]: n }))} />
          ) : q.type === "text" ? (
            <Textarea value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value.slice(0, 600) }))} rows={2} className="text-base" />
          ) : (
            <Choices q={q} value={answers[q.key]} onChange={(val) => setAnswers((a) => ({ ...a, [q.key]: val }))} />
          )}
        </div>
      ))}
      <Button className="h-12 w-full text-base" disabled={busy || missing.length > 0} onClick={() => void send()} data-roadmap-checkin-send>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : missing.length ? `${missing.length} to answer` : "Send check-in"}
      </Button>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------------------ */
/* Goal                                                                      */

type GoalKind = "lose" | "gain" | "maintain" | "compete";

export function RoadmapGoalSheet({ open, onOpenChange, view }: { open: boolean; onOpenChange: (o: boolean) => void; view: RoadmapView }) {
  const qc = useQueryClient();
  const save = useServerFn(saveMyRoadmapGoalFn);
  const unit = view.goal.unit ?? view.unit;
  const initialKind: GoalKind = view.goal.meet ? "compete" : view.goal.type === "gain" ? "gain" : view.goal.type === "maintain" ? "maintain" : view.goal.type ? "lose" : "lose";
  const [kind, setKind] = useState<GoalKind>(initialKind);
  const [weight, setWeight] = useState(view.goal.value != null && !view.goal.meet ? String(view.goal.value) : "");
  const [date, setDate] = useState(view.goal.meet?.date ?? view.goal.date ?? "");
  const [sport, setSport] = useState<"powerlifting" | "bodybuilding">(view.goal.meet?.sport === "bodybuilding" ? "bodybuilding" : "powerlifting");
  const [meetName, setMeetName] = useState(view.goal.meet?.name ?? "");
  const [weightClass, setWeightClass] = useState(view.goal.meet?.weightClass ?? "");
  const [federation, setFederation] = useState(view.goal.meet?.federation ?? "");
  const [busy, setBusy] = useState(false);
  const today = todayLocalISO();

  const num = Number.parseFloat(weight);
  const needsWeight = kind === "lose" || kind === "gain" || (kind === "compete" && sport === "bodybuilding");
  const needsDate = kind === "compete";
  const classKg = classLimitKg(weightClass);
  const problems = [
    needsWeight && !(num > 25 && num < 400) ? "Your target weight" : null,
    needsDate && !(date && date > today) ? "The competition date" : null,
    !needsDate && date && date <= today ? "A date after today" : null,
    kind === "compete" && sport === "powerlifting" && !classKg ? "Your weight class (e.g. 66 or 63 kg)" : null,
  ].filter(Boolean) as string[];

  const now = view.read?.progress.currentKg ?? null;
  const send = async () => {
    setBusy(true);
    try {
      const meet = kind === "compete" ? { name: meetName.trim() || null, date, weightClass: sport === "powerlifting" ? weightClass.trim() || null : null, federation: federation.trim() || null, sport } : null;
      // a class is made, not chased: "weight to make"; a show's stage weight is a loss to a date
      const type = kind === "compete" ? (sport === "powerlifting" ? "performance_cut" : "lose") : kind;
      const value = kind === "compete" ? (sport === "powerlifting" ? (classKg != null ? round(unit === "lb" ? fromKg(classKg, "lb") : classKg, 1) : null) : num) : kind === "maintain" ? (num > 25 ? num : now != null ? round(fromKg(now, unit), 1) : null) : num;
      const r = await save({ data: { type, value, unit, date: date || null, meet } });
      toast.success("Your roadmap is ready", { description: r.headline || undefined, duration: 8000 });
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ROADMAP_ROOT });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save your goal");
    } finally {
      setBusy(false);
    }
  };

  const KINDS: Array<[GoalKind, string]> = [
    ["lose", "Lose fat"],
    ["gain", "Build muscle"],
    ["maintain", "Hold my weight"],
    ["compete", "Compete"],
  ];
  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Your goal">
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("min-h-12 rounded-lg border text-[15px] font-medium", kind === k ? "border-foreground bg-foreground text-background" : "border-border")}>
            {label}
          </button>
        ))}
      </div>
      {kind === "compete" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["powerlifting", "bodybuilding"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSport(s)} aria-pressed={sport === s} className={cn("min-h-11 rounded-lg border text-[14px]", sport === s ? "border-foreground bg-foreground text-background" : "border-border")}>
                {s === "powerlifting" ? "Powerlifting meet" : "Bodybuilding show"}
              </button>
            ))}
          </div>
          <Field label="Name (optional)">
            <Input value={meetName} onChange={(e) => setMeetName(e.target.value)} className="h-12 text-base" maxLength={120} />
          </Field>
          {sport === "powerlifting" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Weight class (kg)">
                <Input value={weightClass} onChange={(e) => setWeightClass(e.target.value)} inputMode="decimal" placeholder="66" className="h-12 text-base" maxLength={10} />
              </Field>
              <Field label="Federation">
                <Input value={federation} onChange={(e) => setFederation(e.target.value)} placeholder="CPU, USAPL…" className="h-12 text-base" maxLength={60} />
              </Field>
            </div>
          )}
        </div>
      )}
      {needsWeight && (
        <Field label={kind === "compete" ? `Stage weight goal (${unit})` : `Target weight (${unit})`}>
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-12 text-base" placeholder={now != null ? String(round(fromKg(now, unit), 1)) : undefined} />
        </Field>
      )}
      <Field label={kind === "compete" ? "Competition date" : "By when (optional)"}>
        <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-12 text-base" />
      </Field>
      {now != null && needsWeight && num > 25 && (
        <p className="text-[13px] text-muted-foreground">
          You're about {fmtWeight(now, unit)} now: {fmtWeight(Math.abs(toKg(num, unit) - now), unit)} to {toKg(num, unit) < now ? "lose" : "gain"}.
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">You'll see straight away whether it's realistic, and the options if it isn't. Nothing changes your targets until you accept them.</p>
      <Button className="h-12 w-full text-base" disabled={busy || problems.length > 0} onClick={() => void send()} data-roadmap-goal-save>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : problems.length ? `Add: ${problems[0]}` : "Build my roadmap"}
      </Button>
      <p className="text-[12px] text-muted-foreground">Coaching guidance, not medical advice. Pregnant, under 18, or with a health condition or eating disorder history? Plan any change with a doctor or registered dietitian.</p>
    </SheetFrame>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[14px] font-medium">{label}</span>
      {children}
    </label>
  );
}
