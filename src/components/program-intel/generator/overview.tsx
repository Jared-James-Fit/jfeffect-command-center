/**
 * The top of Generate Next Program: who the athlete is and what their last
 * program tells us, read from their records (no AI). Compact by default;
 * every number opens to its definition or evidence.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtLoad } from "@/lib/program-intel/core";
import { EQUIPMENT_LABEL } from "@/lib/program-intel/equipment";
import type { GeneratorIntel } from "@/lib/program-intel/intelligence";
import { REVIEW_SECTIONS, type ReviewItem } from "@/lib/program-intel/review";
import { BRAIN_LABEL } from "@/lib/program-intel/types";
import { KindChip } from "../sections";

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{children}</h2>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-secondary/50 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("truncate text-[13px] font-bold leading-snug", warn && "text-warning")}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function AthleteOverview({ intel }: { intel: GeneratorIntel }) {
  const { ctx, prev } = intel;
  const p = ctx.previous;
  const c = prev?.coverage;
  const u = ctx.unit;
  const rpe = c?.setsWithRpePct ?? null;
  return (
    <Card className="space-y-2.5 p-3.5" data-testid="gen-athlete-overview">
      <SectionTitle hint={intel.brainSource === "override" ? "set by you" : "auto"}>Athlete intelligence</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Stat label="Program type" value={BRAIN_LABEL[intel.brain]} sub={intel.brainSource === "auto" ? "read from goals and program" : `auto: ${BRAIN_LABEL[intel.classification.auto]}`} />
        <Stat label="Previous program" value={p?.label ?? "—"} sub={p ? `${p.start ?? "?"} → ${p.end ?? "?"}` : "no training logged"} />
        <Stat label="Frequency" value={p?.plannedDaysPerWeek ? `${p.plannedDaysPerWeek} days / week` : "—"} sub={p?.trainedDaysPerWeek != null ? `trained ${p.trainedDaysPerWeek} a week` : undefined} />
        <Stat label="Duration" value={p ? `${p.weeks} weeks` : "—"} sub={prev ? `${prev.blocks.length} block${prev.blocks.length === 1 ? "" : "s"}` : undefined} />
        <Stat label="Workouts" value={p ? `${p.trained}/${p.due}` : "—"} sub={c ? `${c.completedDays} finished · ${c.partialDays} not marked · ${c.missedDays} missed` : undefined} warn={!!p && (p.sessionAdherencePct ?? 100) < 80} />
        <Stat label="Set adherence" value={c && c.prescribedSetsDue ? `${c.completedSets}/${c.prescribedSetsDue}` : "—"} sub={c && c.prescribedSetsDue ? `${Math.round((c.completedSets / c.prescribedSetsDue) * 100)}% of prescribed sets` : undefined} />
        <Stat label="RPE logged" value={rpe != null ? `${rpe}%` : "—"} sub={rpe != null ? (rpe >= 70 ? "effort readable" : rpe > 0 ? "partial: effort reads limited" : "effort can't be read") : undefined} warn={rpe != null && rpe < 50} />
        <Stat label="Environment" value={ctx.equipment.location ?? "not on file"} sub={`${ctx.equipment.items.length} items · ${ctx.equipment.confidence}`} warn={ctx.equipment.conflicts.length > 0} />
        <Stat label="Session length" value={ctx.session.observedMedian != null ? `${ctx.session.observedMedian} min` : ctx.session.goalsMinutes ? `${ctx.session.goalsMinutes} min (stated)` : "—"} sub={ctx.session.goalsMinutes ? `limit ${ctx.session.goalsMinutes} min` : undefined} />
        <Stat label="Bodyweight" value={ctx.profile.bodyweightKg != null ? fmtLoad(ctx.profile.bodyweightKg, u) : "—"} sub={ctx.profile.bodyweightDate ? `${ctx.profile.bodyweightDate}${ctx.profile.bodyweightChange4wKg != null ? ` · ${ctx.profile.bodyweightChange4wKg > 0 ? "+" : ""}${u === "lb" ? Math.round(ctx.profile.bodyweightChange4wKg * 2.2046) : ctx.profile.bodyweightChange4wKg}${u} / 4 wk` : ""}` : "not logged"} />
        <Stat label="Competition" value={ctx.competition.next ? `${ctx.competition.next.weeksOut} weeks out` : "none on file"} sub={ctx.competition.next ? `${ctx.competition.next.name} · ${ctx.competition.next.date}` : undefined} />
        <Stat label="Athlete" value={[ctx.profile.age != null ? `${ctx.profile.age} y` : null, ctx.profile.sex].filter(Boolean).join(" · ") || "—"} sub={ctx.profile.experience ?? undefined} />
      </div>
      {ctx.equipment.conflicts.length > 0 && (
        <div className="flex gap-1.5 rounded-xl bg-warning/10 p-2 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{ctx.equipment.conflicts[0]}</span>
        </div>
      )}
    </Card>
  );
}

function ReviewList({ items }: { items: ReviewItem[] }) {
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((i, n) => (
        <li key={n} className="text-[12px] leading-snug">
          <div className="flex items-start gap-1.5">
            <KindChip kind={i.kind} />
            <span className="font-semibold">{i.title}</span>
          </div>
          {i.detail ? <div className="mt-0.5 text-muted-foreground">{i.detail}</div> : null}
          {i.evidence.length > 0 && <div className="mt-0.5 text-[11px] text-muted-foreground">Evidence: {i.evidence.join(" · ")}</div>}
        </li>
      ))}
    </ul>
  );
}

export function ProgramReviewCard({ intel }: { intel: GeneratorIntel }) {
  const r = intel.review;
  if (!r) return null;
  return (
    <Card className="space-y-1 p-3.5" data-testid="gen-review">
      <SectionTitle hint="from the records">What the previous program tells us</SectionTitle>
      {REVIEW_SECTIONS.map(([k, title], idx) =>
        r[k].length ? (
          <details key={k} className="group border-t border-border/50 pt-1.5 first-of-type:border-0" open={idx < 2}>
            <summary className="flex cursor-pointer select-none items-center justify-between py-0.5 text-[13px] font-bold">
              <span>{title}</span>
              <span className="text-[11px] font-semibold text-muted-foreground">{r[k].length}</span>
            </summary>
            <ReviewList items={r[k]} />
          </details>
        ) : null,
      )}
    </Card>
  );
}

const STATUS_DOT: Record<string, string> = { good: "bg-success", partial: "bg-warning", missing: "bg-destructive", "n/a": "bg-muted-foreground/40" };
const LEVEL_TEXT: Record<string, string> = { high: "text-success", medium: "text-foreground", low: "text-warning", none: "text-destructive" };

export function DataQualityCard({ intel }: { intel: GeneratorIntel }) {
  const q = intel.quality;
  if (!q) return null;
  return (
    <Card className="p-3.5" data-testid="gen-quality">
      <details>
        <summary className="cursor-pointer select-none">
          <SectionTitle>Data quality</SectionTitle>
          <div className="mt-1 text-[12px] font-semibold">{q.summary}</div>
        </summary>
        <div className="mt-2 space-y-3 text-[12px]">
          <div>
            <div className="mb-1 text-[11px] font-bold">How sets are counted</div>
            <table className="w-full">
              <tbody>
                {q.definitions.map((d) => (
                  <tr key={d.key} className="border-t border-border/40 align-top">
                    <td className="py-1 pr-2 font-semibold">{d.label}</td>
                    <td className="py-1 pr-2 text-right font-bold tabular-nums">{d.value}</td>
                    <td className="py-1 text-[11px] text-muted-foreground">{d.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold">What was logged</div>
            <ul className="space-y-0.5">
              {q.coverage.map((c) => (
                <li key={c.key} className="flex items-start gap-1.5">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[c.status])} />
                  <span><b>{c.label}</b>{c.pct != null ? ` ${c.pct}%` : ""} · <span className="text-muted-foreground">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold">How far each conclusion can be trusted</div>
            <ul className="space-y-1">
              {q.confidence.map((c) => (
                <li key={c.topic}>
                  <span className="font-semibold">{c.topic}: </span>
                  <span className={cn("font-bold uppercase", LEVEL_TEXT[c.level])}>{c.level}</span>
                  <span className="text-muted-foreground"> · {c.why}</span>
                  {c.instead ? <div className="text-[11px] text-muted-foreground">Instead: {c.instead}</div> : null}
                </li>
              ))}
            </ul>
          </div>
          {q.issues.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-bold">Consistency checks</div>
              <ul className="space-y-1">
                {q.issues.map((i) => (
                  <li key={i.key} className="flex gap-1.5">
                    {i.severity === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span>
                      <b>{i.title}.</b> <span className="text-muted-foreground">{i.detail}</span>
                      {i.evidence.length > 0 && <span className="block text-[11px] text-muted-foreground">{i.evidence.join(" · ")}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.tracking.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-bold">Better tracking for next time</div>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{q.tracking.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

const LEVEL_CHIP: Record<string, string> = { established: "bg-success/12 text-success", recurring: "bg-info/12 text-info", single: "bg-muted text-muted-foreground" };

export function PatternsCard({ intel }: { intel: GeneratorIntel }) {
  const list = intel.patterns;
  return (
    <Card className="p-3.5" data-testid="gen-patterns">
      <details>
        <summary className="cursor-pointer select-none">
          <SectionTitle hint={`${list.length} found`}>Patterns across programs</SectionTitle>
          <div className="mt-1 text-[12px] text-muted-foreground">{list.length ? `${list.filter((p) => p.level === "established").length} confirmed by you · ${list.filter((p) => p.level === "recurring").length} recurring · ${list.filter((p) => p.level === "single").length} single` : `${intel.ctx.history.programs.length} program${intel.ctx.history.programs.length === 1 ? "" : "s"} on file: not enough repeated evidence for a pattern yet.`}</div>
        </summary>
        <ul className="mt-2 space-y-2 text-[12px]">
          {list.map((p) => (
            <li key={p.id}>
              <div className="flex items-start gap-1.5">
                <span className={cn("shrink-0 rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wider", LEVEL_CHIP[p.level])}>{p.level}</span>
                <span className="font-semibold">{p.statement}</span>
              </div>
              {p.caveat ? <div className="mt-0.5 text-[11px] text-muted-foreground">{p.caveat}</div> : null}
              {p.evidence.length > 0 && <div className="mt-0.5 text-[11px] text-muted-foreground">{p.evidence.slice(0, 5).join(" · ")}</div>}
            </li>
          ))}
          <li className="text-[11px] text-muted-foreground">
            Programs on file: {intel.ctx.history.programs.map((p) => `${p.label} (${p.weeks} wk, ${p.sessionAdherencePct ?? "—"}% trained)`).join(" · ") || "none"}
          </li>
        </ul>
      </details>
    </Card>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === "passed" || status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (status === "failed" || status === "error") return <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />;
  if (status === "review") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
  return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function equipmentText(items: string[]): string {
  return items.map((i) => EQUIPMENT_LABEL[i as keyof typeof EQUIPMENT_LABEL] ?? i).join(", ");
}
