/**
 * View Detailed Data: every week, workout, exercise, prescribed set and logged
 * set in the report, with check-outs, notes and the per-exercise measures.
 * Collapsed by week so a full history stays fast on a phone; nothing hidden.
 */
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtLoad, fmtSet } from "@/lib/program-intel/core";
import { prescriptionText } from "@/lib/program-intel/export";
import type { DayCompare, IntelRecords, IntelReport } from "@/lib/program-intel/types";

const STATUS_CLS: Record<string, string> = {
  completed: "bg-emerald-500/12 text-emerald-600",
  done: "bg-emerald-500/12 text-emerald-600",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  missed: "bg-destructive/10 text-destructive",
  skipped: "bg-destructive/10 text-destructive",
  upcoming: "bg-muted text-muted-foreground",
  unscheduled: "bg-muted text-muted-foreground",
};

function Pill({ s }: { s: string }) {
  return <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", STATUS_CLS[s] ?? "bg-muted")}>{s}</span>;
}

export function DetailedData({ report, records }: { report: IntelReport; records: IntelRecords }) {
  const [q, setQ] = useState("");
  const u = report.client.unit;
  const query = q.trim().toLowerCase();
  const days = useMemo(() => (query ? report.days.filter((d) => d.title.toLowerCase().includes(query) || d.rows.some((r) => r.exercise.toLowerCase().includes(query))) : report.days), [report.days, query]);
  const byWeek = useMemo(() => {
    const m = new Map<string, DayCompare[]>();
    for (const d of days) m.set(d.weekKey, [...(m.get(d.weekKey) ?? []), d]);
    return m;
  }, [days]);
  const blockNotes = records.blocks.filter((b) => b.coach_notes?.trim());

  return (
    <div className="space-y-3" data-testid="intel-detailed-data">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an exercise or workout…" className="h-10" aria-label="Filter the detailed data" />
      <div className="text-[11px] text-muted-foreground">
        {report.coverage.plannedDays} workouts · {report.coverage.prescribedRows} prescribed exercises · {report.coverage.loggedSets} logged sets. Every one is listed: tap a week to open it.
      </div>
      {report.weeks.map((w) => {
        const list = byWeek.get(w.key);
        if (!list?.length) return null;
        return (
          <details key={w.key} className="group rounded-2xl border border-border bg-card" open={!!query}>
            <summary className="flex cursor-pointer select-none items-baseline justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-bold">{w.label} · {w.blockName}{w.phase ? ` · ${w.phase}` : ""}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{w.completedDays + w.partialDays}/{w.dueDays} · {w.workingSetsLogged}/{w.prescribedSetsDue} sets</span>
            </summary>
            <div className="space-y-2 border-t border-border/60 p-2.5">
              {list.map((d) => (
                <div key={d.dayId} className="rounded-xl bg-secondary/40 p-2.5" data-day={d.dayId}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[13px] font-bold">Day {d.dayIndex}: {d.title}</span>
                    <Pill s={d.status} />
                    <span className="text-[11px] text-muted-foreground">{d.date ?? "no date"}{d.durationMin ? ` · ${d.durationMin} min` : ""}{d.sessionRating ? ` · rated ${d.sessionRating}` : ""}</span>
                  </div>
                  {d.feedback && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Check-out: session RPE {d.feedback.session_rpe ?? "—"} · fatigue {d.feedback.fatigue_feel ?? "—"} · sleep {d.feedback.sleep_bucket ?? "—"}
                      {d.feedback.pain && <span className="text-destructive"> · pain {d.feedback.pain_area ?? ""} {d.feedback.pain_level ?? ""}{d.feedback.pain_note ? ` "${d.feedback.pain_note}"` : ""}</span>}
                      {d.feedback.client_note && <> · "{d.feedback.client_note}"</>}
                    </div>
                  )}
                  {d.clientNotes && <div className="mt-1 text-[11px] italic text-muted-foreground">"{d.clientNotes}"</div>}
                  <div className="mt-2 space-y-2">
                    {d.rows.map((r) => (
                      <div key={r.rowId} className="rounded-lg bg-background p-2">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-xs font-semibold">{r.exercise}</span>
                          {r.role && <span className="text-[10px] text-muted-foreground">{r.role}</span>}
                          <Pill s={r.status} />
                          {!r.exerciseId && <span className="text-[10px] text-amber-600">not in library</span>}
                        </div>
                        <div className="mt-1 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                          <span className="font-bold text-muted-foreground">Prescribed</span>
                          <span>
                            {prescriptionText(r.prescribed, u)}
                            {r.prescribed.notes && <span className="text-muted-foreground"> · "{r.prescribed.notes}"</span>}
                          </span>
                          <span className="font-bold text-muted-foreground">Actual</span>
                          <span className="space-y-0.5">
                            {r.actual.filter((s) => s.logged).length === 0 && <span className="text-muted-foreground">nothing logged{r.warmups ? ` (${r.warmups} warm-ups)` : ""}</span>}
                            {r.actual
                              .filter((s) => s.logged)
                              .map((s) => (
                                <span key={s.resultId} className={cn("block tabular-nums", !s.working && "text-muted-foreground")}>
                                  S{s.setIndex} {fmtSet(s, u)}
                                  {!s.working && " · warm-up"}
                                  {s.e1rm != null && <span className="text-muted-foreground"> · e1RM {fmtLoad(s.e1rm, u)}</span>}
                                  {s.notes && <span className="italic text-muted-foreground"> · "{s.notes}"</span>}
                                </span>
                              ))}
                          </span>
                          {(r.repsHitPct != null || r.rpeDelta != null || r.loadDeltaKg != null) && (
                            <>
                              <span className="font-bold text-muted-foreground">Measured</span>
                              <span className="text-muted-foreground">
                                {[r.repsHitPct != null ? `reps hit ${r.repsHitPct}%` : null, r.rpeDelta != null ? `RPE ${r.rpeDelta > 0 ? "+" : ""}${r.rpeDelta} vs target` : null, r.loadDeltaKg != null ? `load ${r.loadDeltaKg >= 0 ? "+" : "−"}${fmtLoad(Math.abs(r.loadDeltaKg), u)} vs prescribed` : null].filter(Boolean).join(" · ")}
                              </span>
                            </>
                          )}
                          {r.clientNotes.map((n, i) => (
                            <span key={i} className="col-span-2 italic text-muted-foreground">Athlete: "{n}"</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
      {(blockNotes.length > 0 || records.fileNotes.length > 0) && (
        <Card className="space-y-1.5 p-3 text-xs">
          <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Coach notes</div>
          {blockNotes.map((b) => (
            <div key={b.id}><b>{b.name}:</b> {b.coach_notes}</div>
          ))}
          {records.fileNotes.map((n) => (
            <div key={n.id}><b>{n.title ?? "Note"}</b> <span className="text-muted-foreground">({n.created_at?.slice(0, 10)})</span>: {n.body}</div>
          ))}
        </Card>
      )}
    </div>
  );
}
