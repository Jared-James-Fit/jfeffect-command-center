/**
 * The run on screen: its stages while it works, and the finished draft:
 * the quality scorecard (plain statuses with reasons, never a score), the
 * strategy and decisions it was built from, and the whole program week by
 * week with every prescription. Preview & edit opens the program editor;
 * nothing reaches the client until Assign.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarCheck, FileSearch, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BuiltProgram, Strategy } from "@/lib/program-intel/generator-schemas";
import { fmtRx, rxForWeek } from "@/lib/program-intel/program-view";
import { BRAIN_LABEL } from "@/lib/program-intel/types";
import type { IntelJob } from "../use-program-intel";
import { SectionTitle, StatusIcon } from "./overview";
import { DecisionCard, StrategySummary } from "./strategy-view";

export function PipelineProgress({ job, onRetry, onDiscard, busy }: { job: IntelJob; onRetry: () => void; onDiscard: () => void; busy: boolean }) {
  const stages = job.progress?.stages ?? [];
  const failed = job.status === "error";
  return (
    <Card className="space-y-2 p-3.5" data-testid="gen-progress" data-status={job.status}>
      <SectionTitle hint={failed ? "stopped" : "keeps going if you leave"}>{job.kind === "strategy" ? "Writing the strategy" : "Building the program"}</SectionTitle>
      <ol className="space-y-1.5">
        {(stages.length ? stages : [{ key: "context", label: "Starting…", status: "running" as const }]).map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-[12px]">
            {s.status === "running" && !failed ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : <StatusIcon status={s.status === "skipped" ? "skipped" : s.status} />}
            <span className="min-w-0">
              <span className={cn("font-semibold", s.status === "pending" && "text-muted-foreground")}>{s.label}</span>
              {s.detail ? <span className="block text-[11px] text-muted-foreground">{s.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {failed && (
        <div className="space-y-2 rounded-xl bg-destructive/10 p-2.5 text-[12px]">
          <div className="font-semibold text-destructive">{job.error}</div>
          <div className="text-[11px] text-muted-foreground">Try again picks up at the stage that stopped; nothing finished is redone.</div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}><RotateCcw className="mr-1.5 h-4 w-4" /> Try again</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={onDiscard}><Trash2 className="mr-1.5 h-4 w-4" /> Discard</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const OVERALL: Record<string, [string, string]> = {
  passed: ["Passed", "bg-success/12 text-success"],
  review: ["Needs review", "bg-warning/15 text-warning"],
  failed: ["Failed validation", "bg-destructive/12 text-destructive"],
};
const ROW_LABEL: Record<string, string> = { passed: "Passed", review: "Needs review", failed: "Failed", skipped: "Not checked" };

export function Scorecard({ audit }: { audit: any }) {
  if (!audit?.scorecard) return null;
  const rows = audit.scorecard as Array<{ criterion: string; label: string; status: string; reasons: string[] }>;
  const counts = (s: string) => rows.filter((r) => r.status === s).length;
  const [label, cls] = OVERALL[audit.overall] ?? OVERALL.review;
  return (
    <div className="space-y-1.5" data-testid="gen-scorecard">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider", cls)} data-testid="gen-overall">{label}</span>
        <span className="text-[11px] text-muted-foreground">{counts("passed")} passed · {counts("review")} to review · {counts("failed")} failed · {counts("skipped")} not checked</span>
      </div>
      <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
        {rows.map((r) => (
          <li key={r.criterion}>
            <details className="px-2.5 py-1.5" open={r.status === "failed"}>
              <summary className={cn("flex cursor-pointer select-none items-center gap-2 text-[12px]", !r.reasons.length && "cursor-default")}>
                <StatusIcon status={r.status} />
                <span className="flex-1 font-semibold">{r.label}</span>
                <span className="text-[11px] text-muted-foreground">{ROW_LABEL[r.status]}</span>
              </summary>
              {r.reasons.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-8 text-[11px] text-muted-foreground">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </details>
          </li>
        ))}
      </ul>
      {audit.overall !== "passed" && <p className="text-[11px] text-muted-foreground">Not called fully validated: {audit.overall === "failed" ? "a check failed even after automatic repair" : "some checks need your eye or couldn't run automatically"}. Each reason says where.</p>}
    </div>
  );
}

export function ProgramWeeks({ program, sessions, unmatched }: { program: BuiltProgram; sessions?: Array<{ block: number; week: number; day: number; minutes: number }>; unmatched: string[] }) {
  const [bi, setBi] = useState(0);
  const [week, setWeek] = useState(1);
  const block = program.blocks[bi];
  if (!block) return null;
  const miss = new Set(unmatched.map((u) => u.toLowerCase()));
  return (
    <div className="space-y-2" data-testid="gen-program-weeks">
      {program.blocks.length > 1 && (
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {program.blocks.map((b, i) => (
            <button key={i} type="button" onClick={() => { setBi(i); setWeek(1); }} className={cn("h-8 shrink-0 rounded-full px-3 text-[11px] font-bold", i === bi ? "bg-foreground text-background" : "bg-secondary text-muted-foreground")}>
              {i + 1}. {b.name}
            </button>
          ))}
        </div>
      )}
      <div className="text-[12px]">
        <b>{block.name}</b> · {block.weeks} weeks{block.objective ? <span className="text-muted-foreground"> · {block.objective}</span> : null}
        {block.deload_rule ? <div className="text-[11px] text-muted-foreground">Deload: {block.deload_rule}</div> : null}
        {(block.progression_rules ?? []).length > 0 && <div className="text-[11px] text-muted-foreground">Progression: {block.progression_rules.join(" · ")}</div>}
      </div>
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Week">
        {Array.from({ length: block.weeks }, (_, i) => i + 1).map((w) => {
          const phase = block.week_phases?.find((p) => p.week === w)?.phase;
          return (
            <button key={w} type="button" role="tab" aria-selected={w === week} onClick={() => setWeek(w)} className={cn("h-9 shrink-0 rounded-xl px-3 text-[11px] font-bold leading-tight", w === week ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")} data-testid={`gen-week-${w}`}>
              W{w}{phase ? <span className="block text-[9px] font-semibold opacity-80">{phase}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {block.days.map((d, di) => {
          const est = sessions?.find((s) => s.block === bi && s.week === week && s.day === di)?.minutes;
          return (
            <div key={di} className="rounded-xl bg-secondary/40 p-2.5" data-testid="gen-day">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[13px] font-bold">Day {di + 1}: {d.title}</div>
                {est ? <div className="shrink-0 text-[11px] text-muted-foreground">~{est} min</div> : null}
              </div>
              {d.focus ? <div className="text-[11px] text-muted-foreground">{d.focus}</div> : null}
              <ol className="mt-1.5 space-y-1.5">
                {d.exercises.map((e, ei) => {
                  const rx = rxForWeek(e, week);
                  const notInLib = !e.exercise_id && miss.has(e.exercise_name.trim().toLowerCase());
                  return (
                    <li key={ei} className="rounded-lg bg-background p-2 text-[12px]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className={cn("font-bold", notInLib && "text-warning")}>{e.superset ? `${e.superset} ` : ""}{e.exercise_name}</span>
                          {notInLib ? <span className="ml-1 text-[10px] font-bold text-warning">not in library</span> : null}
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{[e.role, e.station].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div className="shrink-0 text-right font-bold tabular-nums">{fmtRx(rx)}</div>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {[e.rest_seconds != null ? `rest ${Math.floor(e.rest_seconds / 60)}:${String(e.rest_seconds % 60).padStart(2, "0")}` : null, e.tempo ? `tempo ${e.tempo}` : null].filter(Boolean).join(" · ")}
                        {rx.notes ? <div>{rx.notes}</div> : null}
                        {e.progression ? <div>Progress: {e.progression}</div> : null}
                        {e.substitutions?.length ? <div>Swap: {e.substitutions.map((s) => s.exercise_name).join(" or ")}</div> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DraftView({
  job,
  today,
  busy,
  onAssign,
  onDiscard,
  onInspect,
}: {
  job: IntelJob;
  today: string;
  busy: boolean;
  onAssign: (startDate: string, acknowledge: boolean) => void;
  onDiscard: () => void;
  onInspect: () => void;
}) {
  const program: BuiltProgram | null = job.result?.program ?? null;
  const strategy: Strategy | null = job.result?.strategy ?? null;
  const blockIds: string[] = job.result?.blockIds ?? [];
  const unmatched: string[] = job.result?.unmatched ?? [];
  const audit = job.result?.audit ?? null;
  const nextMonday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    const add = ((8 - d.getUTCDay()) % 7) || 7;
    return new Date(d.getTime() + add * 86_400_000).toISOString().slice(0, 10);
  })();
  const [start, setStart] = useState(nextMonday);
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  if (!program) return null;
  const failed = audit?.overall === "failed";
  return (
    <Card className="space-y-3 p-3.5" data-testid="gen-draft" data-status={job.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{job.status === "assigned" ? "Assigned" : job.status === "discarded" ? "Discarded draft" : "Draft · hidden from the client"}</div>
          <div className="text-base font-bold leading-tight">{program.program_name}</div>
          <div className="text-[11px] text-muted-foreground">{BRAIN_LABEL[job.brain]} · {job.created_at.slice(0, 10)}{job.model ? ` · ${job.model}` : ""}{job.result?.strategySource === "coach" ? " · from your approved strategy" : " · recommended strategy auto-accepted"}</div>
        </div>
        <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[11px]" onClick={onInspect} data-testid="gen-inspect"><FileSearch className="mr-1 h-3.5 w-3.5" /> Context</Button>
      </div>
      {audit && <Scorecard audit={audit} />}
      {unmatched.length > 0 && (
        <div className="flex gap-1.5 rounded-xl bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>{unmatched.length} not in your library:</b> {unmatched.join(", ")}. In the draft by name only; pick the library exercise in the editor. No exercise was created.</span>
        </div>
      )}
      {strategy && (
        <details className="rounded-xl bg-secondary/30 p-2.5">
          <summary className="cursor-pointer select-none text-[13px] font-bold">Strategy and decisions ({strategy.decisions.length})</summary>
          <div className="mt-2 space-y-3">
            <StrategySummary strategy={strategy} compact />
            <div className="space-y-2">{strategy.decisions.map((d, i) => <DecisionCard key={i} d={d} />)}</div>
            <p className="text-[11px] text-muted-foreground">Each decision also waits in the athlete's memory as a proposed hypothesis: approve the ones you agree with so the next review can check what came of them.</p>
          </div>
        </details>
      )}
      <div>
        <SectionTitle hint="every week, every workout">The program</SectionTitle>
        <div className="mt-2"><ProgramWeeks program={program} sessions={audit?.sessions} unmatched={unmatched} /></div>
      </div>
      {job.status === "ready" && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {blockIds.map((id, i) => (
              <Button key={id} asChild size="sm" variant="outline" className="h-9">
                <Link to="/admin/blocks/$blockId" params={{ blockId: id }}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Preview & edit{blockIds.length > 1 ? ` block ${i + 1}` : ""}</Link>
              </Button>
            ))}
          </div>
          {confirming ? (
            <div className="space-y-2 rounded-xl bg-secondary/50 p-2.5">
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-11" />
              {failed && (
                <label className="flex items-start gap-2 text-[12px] text-destructive">
                  <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>This draft failed validation. I've reviewed the scorecard (and fixed it in the editor if needed) and want to assign it.</span>
                </label>
              )}
              <p className="text-[11px] text-muted-foreground">Assigning makes it visible to the client and places the workouts on their training days. Earlier programs and logged workouts aren't touched.</p>
              <div className="flex gap-1.5">
                <Button size="sm" className="h-10 flex-1" disabled={busy || !start || (failed && !ack)} onClick={() => onAssign(start, ack)} data-testid="gen-assign-confirm">
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1.5 h-4 w-4" />} Assign from {start}
                </Button>
                <Button size="sm" variant="ghost" className="h-10" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Button size="sm" className="h-10 flex-1" onClick={() => setConfirming(true)} data-testid="gen-assign"><CalendarCheck className="mr-1.5 h-4 w-4" /> Assign to client…</Button>
              <Button size="sm" variant="ghost" className="h-10 text-destructive" disabled={busy} onClick={onDiscard}><Trash2 className="mr-1.5 h-4 w-4" /> Discard</Button>
            </div>
          )}
        </div>
      )}
      {job.status === "assigned" && blockIds[0] && (
        <Button asChild size="sm" variant="outline" className="h-9"><Link to="/admin/blocks/$blockId" params={{ blockId: blockIds[0] }}>Open the program</Link></Button>
      )}
    </Card>
  );
}
