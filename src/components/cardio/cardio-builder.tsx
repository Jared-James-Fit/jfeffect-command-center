/**
 * The cardio builder (Nov 23 2026): the coach's draft of a client's cardio
 * plan, edited session by session with Undo / Redo, saved as a draft as they
 * go (never reaching the client), checked live (problems, the week laid out,
 * weekly minutes, plan quality), and published from Review & publish: what
 * changes against the plan in force, from when (today or a later date), why,
 * and whether the client gets a message. Templates, Duplicate, Copy to other
 * days and the weekly total make the common jobs one or two taps.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Plus, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type CleoDockHandle } from "@/components/program-ai/cleo-dock";
import { CardioSessionEditor } from "@/components/cardio/cardio-session-editor";
import { CardioWeek } from "@/components/cardio/cardio-week";
import { PlanIntelligence } from "@/components/plan-quality/plan-intelligence";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { CARDIO_TEMPLATES, scaleToWeekly } from "@/lib/cardio/overview";
import { diffPlans, newSession, newSessionKey, planProblems, planTotals, type CardioPlan, type CardioSession } from "@/lib/cardio/plan";
import { planOn, withoutPending } from "@/lib/cardio/publish";
import { scoreCardioPlan } from "@/lib/cardio/quality";
import type { CardioWorkspaceView } from "@/lib/cardio/types";
import type { SpeedUnit } from "@/lib/weight-management/units";
import { addDays } from "@/lib/weight-management/units";
import { mondayOf } from "@/lib/cardio/overview";

export type PublishInput = { effectiveDate: string | null; note: string; notify: boolean };

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function CardioBuilder({
  view,
  plan,
  setPlan,
  undo,
  redo,
  canUndo,
  canRedo,
  unit,
  setUnit,
  effectiveDate,
  setEffectiveDate,
  note,
  setNote,
  saveState,
  onBack,
  onDiscard,
  onPublish,
  publishing,
  dock,
  onAskCleo,
}: {
  view: CardioWorkspaceView;
  plan: CardioPlan;
  setPlan: (next: CardioPlan, tag?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  unit: SpeedUnit;
  setUnit: (u: SpeedUnit) => void;
  effectiveDate: string | null;
  setEffectiveDate: (d: string | null) => void;
  note: string;
  setNote: (n: string) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  onBack: () => void;
  onDiscard: () => void;
  onPublish: (x: PublishInput) => Promise<void>;
  publishing: boolean;
  dock: CleoDockHandle;
  onAskCleo: (ask: string) => void;
}) {
  const ctx = view.ctx;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notify, setNotify] = useState(view.hasLogin);
  const [weekly, setWeekly] = useState("");
  const problems = useMemo(() => planProblems(plan, ctx), [plan, ctx]);
  const totals = useMemo(() => planTotals(plan, ctx, view.scoreCtx.bodyweightKg), [plan, ctx, view.scoreCtx.bodyweightKg]);
  const quality = useMemo(() => scoreCardioPlan(plan, view.scoreCtx), [plan, view.scoreCtx]);
  const cleo = useCleoAccess();
  const effective = effectiveDate && effectiveDate > view.today ? effectiveDate : view.today;
  // what publishing would change: against the plan in force on that date (a waiting change taken back first)
  const base = useMemo(() => {
    const rows = view.pending ? withoutPending(view.rows, { versionId: view.pending.versionId ?? "", createdIds: view.pending.createdIds, closes: view.pending.closes }) : view.rows;
    return planOn(rows, effective);
  }, [view.rows, view.pending, effective]);
  const changes = useMemo(() => diffPlans(base, plan, ctx, unit), [base, plan, ctx, unit]);
  const errors = problems.filter((p) => p.level === "error");
  const nextMonday = addDays(mondayOf(view.today), 7);

  const update = (key: string, next: CardioSession, tag: string) => setPlan({ sessions: plan.sessions.map((s) => (s.key === key ? next : s)) }, tag);
  // One session open at a time: the first to start, then whichever was added or tapped last.
  const [openKey, setOpenKey] = useState<string | null>(() => plan.sessions[0]?.key ?? null);
  const add = (sessions: CardioSession[], tag: string) => {
    setPlan({ sessions: [...plan.sessions, ...sessions] }, tag);
    if (sessions[0]) setOpenKey(sessions[0].key);
  };

  return (
    <div className="space-y-4" data-cardio-builder>
      {/* toolbar */}
      <div className="sticky top-0 z-20 -mx-1 border-b border-border bg-background px-1 py-2" data-builder-toolbar>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="h-10 shrink-0 gap-1.5 px-2" onClick={onBack} aria-label="Back to the overview">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Overview</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">Cardio plan draft</p>
            <p className="truncate text-[12px] text-muted-foreground" data-draft-state>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved · not visible to the client" : saveState === "error" ? "Couldn't save the draft" : "Not visible to the client until you publish"}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <div className="hidden items-center gap-2 sm:flex">
            <Button className="h-10" onClick={() => setReviewOpen(true)} disabled={!changes.length} data-review-publish>
              {changes.length ? "Review & publish" : "No changes yet"}
            </Button>
          </div>
        </div>
        {/* a phone: the two actions get a row of their own */}
        <div className="mt-2 flex items-center gap-2 sm:hidden">
          <Button className="h-10 flex-1" onClick={() => setReviewOpen(true)} disabled={!changes.length}>
            {changes.length ? `Review & publish (${changes.length})` : "No changes to publish"}
          </Button>
        </div>
      </div>

      {view.draft?.stale && (
        <p className="rounded-xl border border-warning/40 px-3 py-2 text-[13px]">Their cardio changed since this draft was started. Publishing checks against the latest; reload to see it.</p>
      )}

      {/* the week at a glance */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">This week</h3>
          <p className="text-[13px] tabular-nums text-muted-foreground" data-builder-totals>
            {totals.minutes} min · {totals.sessions} session{totals.sessions === 1 ? "" : "s"}
            {totals.estKcal != null ? ` · ~${totals.estKcal.toLocaleString("en-US")} kcal (estimate)` : ""}
          </p>
        </div>
        <CardioWeek plan={plan} ctx={ctx} className="mt-3" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Weekly total</span>
          {[-15, 15].map((pct) => (
            <Button key={pct} variant="outline" className="h-9 px-2.5 text-[13px]" disabled={!totals.minutes} onClick={() => setPlan(scaleToWeekly(plan, ctx, Math.round(totals.minutes * (1 + pct / 100))), "weekly")}>
              {pct > 0 ? `+${pct}%` : `${pct}%`}
            </Button>
          ))}
          <Input inputMode="numeric" aria-label="Weekly minutes" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="Set min/week" className="h-9 w-32" />
          <Button variant="outline" className="h-9" disabled={!Number(weekly) || !totals.minutes} onClick={() => { setPlan(scaleToWeekly(plan, ctx, Number(weekly)), "weekly"); setWeekly(""); }}>
            Set
          </Button>
          <div className="ml-auto flex items-center gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Speed unit">
            {(["mph", "kmh"] as SpeedUnit[]).map((u) => (
              <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)} className={cn("h-8 cursor-pointer rounded-md px-2.5 text-[12px] font-semibold", unit === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                {u === "mph" ? "mph" : "km/h"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* sessions */}
      <div className="space-y-3">
        {plan.sessions.map((s) => (
          <CardioSessionEditor
            key={s.key}
            session={s}
            ctx={ctx}
            unit={unit}
            problems={problems.filter((p) => p.key === s.key)}
            open={openKey === s.key || plan.sessions.length === 1}
            onToggle={plan.sessions.length > 1 ? () => setOpenKey((k) => (k === s.key ? null : s.key)) : undefined}
            onChange={(next, tag) => update(s.key, next, tag)}
            onDuplicate={() => add([{ ...s, key: newSessionKey(), id: null }], "duplicate")}
            onCopyTo={(days) => add([{ ...s, key: newSessionKey(), id: null, days: "weekdays", weekdays: days }], "copy")}
            onRemove={() => setPlan({ sessions: plan.sessions.filter((x) => x.key !== s.key) }, "remove")}
          />
        ))}
        {!plan.sessions.length && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">
            No cardio in this draft. Publishing it means no cardio for {view.firstName}, which is right for plenty of people.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-10 gap-1.5" onClick={() => add([newSession(undefined, ctx.trainingDays.length ? "non_training" : "weekdays", ctx)], "add")} data-add-session>
          <Plus className="h-4 w-4" /> Add a session
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-10 gap-1.5">
              Templates <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Add from a template</DropdownMenuLabel>
            {CARDIO_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.key} onClick={() => add(t.sessions(ctx), `template:${t.key}`)} className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{t.label}</span>
                <span className="text-[12px] text-muted-foreground">{t.detail}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAskCleo("Build a time-efficient cardio plan around their training days")}>Ask Cleo to build one</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" className="h-10 text-muted-foreground" onClick={onDiscard}>
          Discard draft
        </Button>
      </div>

      <PlanIntelligence
        domain="cardio"
        clientKey={`${view.clientId}:draft`}
        title="Draft quality"
        quality={quality}
        cleo={cleo}
        onOptimize={(q) => dock.optimize({ domain: "cardio", what: "cardio draft", quality: q })}
        onAskCleo={() => onAskCleo("")}
      />

      {/* review and publish */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-publish-dialog>
          <DialogHeader>
            <DialogTitle>Publish {view.firstName}'s cardio</DialogTitle>
            <DialogDescription>What changes against the plan in force {effective === view.today ? "today" : `on ${fmtDay(effective)}`}.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-[13px]" data-publish-changes>
            {changes.flatMap((c) => c.lines.map((l, i) => (
              <li key={`${c.key}-${i}`} className="flex gap-2">
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", c.kind === "removed" ? "bg-destructive" : c.kind === "added" ? "bg-success" : "bg-foreground/60")} aria-hidden />
                <span>{l}</span>
              </li>
            )))}
          </ul>
          <p className="text-[12px] text-muted-foreground">
            Weekly: {planTotals(base, ctx).minutes} → {totals.minutes} min · quality {quality.score ?? "—"}
            {view.pending ? ` · replaces the change waiting for ${fmtDay(view.pending.effective)}` : ""}
          </p>
          {errors.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-destructive">
              {errors.map((p, i) => (
                <li key={i}>{p.text}</li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Starts</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" aria-pressed={effective === view.today} className={cn("h-9", effective === view.today && "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background")} onClick={() => setEffectiveDate(null)}>
                Today
              </Button>
              <Button variant="outline" aria-pressed={effective === nextMonday} className={cn("h-9", effective === nextMonday && "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background")} onClick={() => setEffectiveDate(nextMonday)}>
                Next Monday ({fmtDay(nextMonday)})
              </Button>
              <Input type="date" aria-label="Starts on" min={view.today} value={effective} onChange={(e) => setEffectiveDate(e.target.value || null)} className="h-9 w-40" />
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Why (kept in the history; Cleo reads it)</span>
            <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Fat loss stalled two weeks: added one more walk." />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3">
            <span className="text-[13px]">{view.hasLogin ? `Tell ${view.firstName} in their chat` : `${view.firstName} has no app login yet`}</span>
            <Switch checked={notify && view.hasLogin} disabled={!view.hasLogin} onCheckedChange={setNotify} />
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Keep editing
            </Button>
            <Button
              disabled={publishing || errors.length > 0 || !changes.length}
              onClick={async () => {
                await onPublish({ effectiveDate: effective === view.today ? null : effective, note, notify: notify && view.hasLogin });
                setReviewOpen(false);
              }}
              data-publish-confirm
            >
              {publishing ? "Publishing…" : effective === view.today ? "Publish now" : `Publish for ${fmtDay(effective)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
