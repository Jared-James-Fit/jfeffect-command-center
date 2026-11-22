/**
 * The roadmap's pieces, shared by the athlete's sheet and the coach's card:
 * the status, the journey as a timeline of blocks (each opens for its
 * targets, why it exists, its checkpoints and its rules), whether the goal is
 * realistic, and what changed over time. Neutral ink: colour only where it
 * means something (green on plan, amber needs a look, red a real risk).
 */
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Check, ChevronDown, Lock } from "lucide-react";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import { cn } from "@/lib/utils";
import { fmtDay, fmtRate, fmtWeight, daysBetween } from "@/lib/weight-management/units";
import { STATUS_TONE, toYou, type RevisionSummary } from "@/lib/nutrition-roadmap/view";
import { todayLocalISO } from "@/lib/today";

/** "Mar 14" this year, "Mar 14, 2027" otherwise. */
const day = (iso: string) => fmtDay(iso, todayLocalISO());
import { STATUS_LABEL, type Block, type Feasibility, type ProgressStatus, type RoadmapPlan, type RoadmapRead } from "@/lib/nutrition-roadmap/types";

export function StatusBadge({ status }: { status: ProgressStatus }) {
  return <StatusChip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusChip>;
}

const VERDICT_WORD: Record<Feasibility["verdict"], { label: string; tone: "done" | "attention" | "error" | "neutral" }> = {
  realistic: { label: "Realistic", tone: "done" },
  aggressive: { label: "Aggressive", tone: "attention" },
  unlikely: { label: "Unlikely as set", tone: "attention" },
  unsafe: { label: "Not safe as set", tone: "error" },
  no_deadline: { label: "No deadline", tone: "neutral" },
  reached: { label: "Reached", tone: "done" },
  no_goal: { label: "No target yet", tone: "neutral" },
};

export function VerdictChip({ verdict }: { verdict: Feasibility["verdict"] }) {
  const v = VERDICT_WORD[verdict];
  return <StatusChip tone={v.tone}>{v.label}</StatusChip>;
}

/** How far through the whole journey they are, 0–1, and the week they're in. */
export function journeyProgress(plan: RoadmapPlan, today: string): { frac: number; week: number; weeks: number } | null {
  const start = plan.blocks[0]?.start;
  const goalEnd = plan.goal?.date ?? plan.blocks.filter((b) => b.kind !== "transition" && b.kind !== "post_comp").pop()?.end ?? plan.blocks[plan.blocks.length - 1]?.end;
  if (!start || !goalEnd) return null;
  const total = Math.max(1, daysBetween(start, goalEnd));
  const done = Math.min(total, Math.max(0, daysBetween(start, today)));
  return { frac: done / total, week: Math.min(Math.ceil(total / 7), Math.floor(done / 7) + 1), weeks: Math.ceil(total / 7) };
}

const macro = (m: { kcal: number; proteinG: number; carbsG: number; fatG: number }) => (
  <span className="tabular-nums">
    {m.kcal} kcal · P {m.proteinG} · C {m.carbsG} · F {m.fatG}
  </span>
);

function Dot({ status }: { status: Block["status"] }) {
  if (status === "done")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-background" aria-hidden>
        <Check className="h-3 w-3" />
      </span>
    );
  return <span className={cn("block h-5 w-5 shrink-0 rounded-full border-2", status === "current" ? "border-foreground bg-foreground" : "border-muted-foreground/40 bg-background")} aria-hidden />;
}

export type Voice = "coach" | "athlete";

export function BlockDetail({ b, unit, voice = "coach" }: { b: Block; unit: "kg" | "lb"; voice?: Voice }) {
  const W = (kg: number) => fmtWeight(kg, unit);
  const say = (t: string) => (voice === "athlete" ? toYou(t) : t);
  return (
    <div className="space-y-3 text-[14px]" data-block-detail={b.kind}>
      <p>{say(b.objective)}</p>
      <div className="rounded-lg bg-muted/50 p-3">
        <div className="text-[13px] text-muted-foreground">{b.final ? "Targets now" : "Expected targets (a forecast)"}</div>
        <div className="mt-0.5 font-medium">{macro(b.energy.from === "plan" ? b.energy : b.energy.engine)}</div>
        {b.energy.training && b.energy.rest && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            Training days {b.energy.training.kcal} kcal · rest days {b.energy.rest.kcal} kcal
          </div>
        )}
        {b.energy.from === "plan" && Math.abs(b.energy.engine.kcal - b.energy.kcal) >= 150 && (
          <div className="mt-1 text-[13px] text-muted-foreground">The roadmap calls for about {b.energy.engine.kcal} kcal in this block.</div>
        )}
        {b.weight && b.rate.kgPerWeek !== 0 && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            {W(b.weight.startKg)} → {W(b.weight.targetKg)} at {fmtRate(b.rate.kgPerWeek, unit)} ({Math.abs(b.rate.pctPerWeek)}% a week)
          </div>
        )}
      </div>
      {b.energy.notes.length > 0 && (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {b.energy.notes.map((n) => (
            <li key={n}>{say(n)}</li>
          ))}
        </ul>
      )}
      <div>
        <div className="text-[13px] font-semibold">Why this block</div>
        <p className="text-muted-foreground">{say(b.why)}</p>
      </div>
      <div>
        <div className="text-[13px] font-semibold">Priorities</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {b.priorities.map((p) => (
            <li key={p}>{say(p)}</li>
          ))}
        </ul>
      </div>
      {b.checkpoints.length > 0 && (
        <div>
          <div className="text-[13px] font-semibold">Checkpoints</div>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {b.checkpoints.map((c) => (
              <li key={c.date} className="flex justify-between gap-3 tabular-nums">
                <span>{day(c.date)}</span>
                <span>
                  {W(c.lowKg)}–{W(c.highKg)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="text-[13px] font-semibold">Move on when</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {b.moveOnWhen.map((p) => (
            <li key={p}>{say(p)}</li>
          ))}
        </ul>
      </div>
      <dl className="grid gap-1.5 text-[13px]">
        {(
          [
            ["Keep it", b.rules.keep],
            ["Change it", b.rules.change],
            ["Extend it", b.rules.extend],
            ["End it", b.rules.end],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-semibold">{k}: </dt>
            <dd className="inline text-muted-foreground">{say(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The journey, block by block; the current one starts open. */
export function BlockTimeline({ plan, unit, voice = "coach" }: { plan: RoadmapPlan; unit: "kg" | "lb"; voice?: Voice }) {
  const current = plan.blocks.find((b) => b.status === "current")?.id ?? null;
  const [open, setOpen] = useState<string | null>(current);
  return (
    <ol className="relative space-y-1" data-roadmap-timeline>
      {plan.blocks.map((b, i) => {
        const isOpen = open === b.id;
        return (
          <li key={b.id} className="relative">
            {i < plan.blocks.length - 1 && <span className="absolute left-[9px] top-7 h-[calc(100%-12px)] w-px bg-border" aria-hidden />}
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : b.id)}
              className="flex min-h-12 w-full items-start gap-3 rounded-lg py-1.5 text-left"
              aria-expanded={isOpen}
              data-block-row={b.kind}
            >
              <span className="block pt-0.5">
                <Dot status={b.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {b.title}
                  {b.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked by your coach" />}
                  {b.status === "current" && <span className="text-[12px] font-medium text-muted-foreground">Now</span>}
                </span>
                <span className="block text-[13px] text-muted-foreground">
                  {day(b.start)} – {day(b.end)} · {b.weeks} wk · {(b.energy.from === "plan" ? b.energy.kcal : b.energy.engine.kcal).toLocaleString()} kcal
                  {!b.final && b.status === "upcoming" ? " (forecast)" : ""}
                </span>
              </span>
              <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div className="mb-3 ml-8">
                <BlockDetail b={b} unit={unit} voice={voice} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function FeasibilityDetail({ f, unit, voice = "coach" }: { f: Feasibility; unit: "kg" | "lb"; voice?: Voice }) {
  const say = (t: string) => (voice === "athlete" ? toYou(t) : t);
  return (
    <div className="space-y-3 text-[14px]" data-feasibility={f.verdict}>
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={f.verdict} />
        <span className="font-medium">{f.headline}</span>
      </div>
      {f.reasons.length > 0 && (
        <ul className="space-y-1 text-muted-foreground">
          {f.reasons.map((r) => (
            <li key={r}>{say(r)}</li>
          ))}
        </ul>
      )}
      {f.expected && (
        <p className="text-muted-foreground">
          Likely on the date: {fmtWeight(f.expected.lowKg, unit)}–{fmtWeight(f.expected.highKg, unit)} ({f.expected.basis === "trend" ? say("from their trend") : "if the plan is followed"}). Confidence: {f.confidence}. {say(f.confidenceWhy)}
        </p>
      )}
      {f.tradeoffs.length > 0 && (
        <div>
          <div className="text-[13px] font-semibold">The trade-offs</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {f.tradeoffs.map((t) => (
              <li key={t}>{say(t)}</li>
            ))}
          </ul>
        </div>
      )}
      {f.alternatives.length > 0 && (
        <div>
          <div className="text-[13px] font-semibold">Options that work</div>
          <ul className="mt-1 space-y-1.5">
            {f.alternatives.map((a) => (
              <li key={a.label} className="rounded-lg border border-border p-2.5">
                <div className="font-medium">{a.label}</div>
                <div className="text-[13px] text-muted-foreground">{say(a.detail)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TRIGGER_WORD: Record<string, string> = {
  initial: "First roadmap",
  reforecast: "Reforecast",
  goal_change: "Goal changed",
  adjustment: "Targets",
  coach: "Coach's refresh",
  checkin: "After a check-in",
};

export function HistoryList({ history }: { history: RevisionSummary[] }) {
  if (!history.length) return <p className="text-[14px] text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="space-y-2.5" data-roadmap-history>
      {history.map((h) => (
        <li key={h.id} className="text-[14px]">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{TRIGGER_WORD[h.trigger] ?? h.trigger}</span>
            <span className="text-[12px] text-muted-foreground">
              {format(parseISO(h.createdAt), "MMM d, yyyy")} · {h.status === "active" ? "in effect" : h.status === "proposed" ? "waiting" : h.status === "rejected" ? "declined" : "replaced"}
              {h.autoApplied ? " · applied by itself" : ""}
            </span>
          </div>
          {h.changes.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-[13px] text-muted-foreground">
              {h.changes.slice(0, 4).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {h.note && <div className="mt-0.5 text-[13px] text-muted-foreground">Note: {h.note}</div>}
        </li>
      ))}
    </ul>
  );
}

/** The status in words, the engine's (and, once written, the model's checked words under it). */
export function StatusLine({ read, explanation, voice = "coach" }: { read: RoadmapRead; explanation?: { summary: string; focus: string } | null; voice?: Voice }) {
  const say = (t: string) => (voice === "athlete" ? toYou(t) : t);
  // said only when it's true: holding is the decision, not just a read of the scale
  const holding = read.decision.action === "hold" && (read.progress.status === "on_track" || read.progress.status === "ahead");
  return (
    <div className="space-y-1" data-roadmap-status={read.progress.status}>
      <div className="text-[15px] font-semibold">{read.progress.headline}</div>
      <p className="text-[14px] text-muted-foreground">
        {say(read.progress.detail)}
        {holding ? " No nutrition changes needed." : ""}
      </p>
      {explanation?.summary && (
        <p className="pt-1 text-[14px]">
          {explanation.summary} {explanation.focus && <span className="text-muted-foreground">{explanation.focus}</span>}
        </p>
      )}
    </div>
  );
}
