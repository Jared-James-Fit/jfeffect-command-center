/**
 * The Cardio tab's overview (Nov 23 2026), most important first: six numbers
 * (planned and done a week, completion, sessions, effort, volume change), the
 * plan in force and its week, the recovery and performance read with its one
 * recommendation (plan quality is the strip above it), the charts (planned vs done by week with every
 * published change marked, by weekday, bodyweight beside it as its own chart),
 * then the history folded: logged sessions and every published plan with how
 * it went. Measured, reported and estimated values are labelled as such; a
 * chart with nothing to show isn't drawn.
 */
import { useMemo, useState } from "react";
import { PlanEventTimeline } from "@/components/clients/plan-event-timeline";
import { plansOnDate } from "@/lib/plan-event-timeline";
import { Activity, CircleAlert, History as HistoryIcon, ListChecks, Pencil } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Accordion } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { CardHeader, Section, StatusChip } from "@/components/nutrition/nutrition-ui";
import { CardioWeek } from "@/components/cardio/cardio-week";
import { CleoMark } from "@/components/summer/cleo-mark";
import { cardioKpis, loggedDetails, weekdayDistribution, weeklySeries } from "@/lib/cardio/overview";
import { daysWords, progressionWords, sessionLine, TIMING_SHORT } from "@/lib/cardio/plan";
import { REC_LABEL, type CardioRecommendation, type Signal } from "@/lib/cardio/insights";
import { summarizeCardio } from "@/lib/analytics/cardio-adherence";
import type { CardioWorkspaceView } from "@/lib/cardio/types";
import { fromKg } from "@/lib/weight-management/units";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="truncate text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

const STATUS_DOT: Record<Signal["status"], string> = { good: "bg-success", watch: "bg-warning", flag: "bg-destructive", unknown: "bg-muted-foreground/40" };
const STATUS_WORD: Record<Signal["status"], string> = { good: "OK", watch: "Watch", flag: "Flag", unknown: "Not enough data" };

function Recommendation({ r, primary, onAsk }: { r: CardioRecommendation; primary?: boolean; onAsk: (ask: string) => void }) {
  return (
    <div className={cn(primary ? "" : "border-t border-border pt-3")} data-cardio-rec={r.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={cn("font-semibold", primary ? "text-[15px]" : "text-[14px]")}>{r.title}</p>
        <StatusChip>{REC_LABEL[r.kind]}</StatusChip>
      </div>
      <p className="mt-1 text-[13px] leading-snug">{r.observation}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{r.reason}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Confidence {r.confidence}
        {r.relation === "pattern" ? " · a pattern in the data, not a confirmed cause" : r.relation === "reported" ? " · from what they told you" : ""}
        {r.alternatives.length ? ` · also consider: ${r.alternatives.join(", ")}` : ""}
      </p>
      {r.ask && (
        <Button variant="outline" className="mt-2 h-9 gap-1.5" onClick={() => onAsk(r.ask!)} data-cardio-rec-ask>
          <CleoMark size={15} /> Draft it with Cleo
        </Button>
      )}
    </div>
  );
}

export function CardioOverview({
  view,
  onEdit,
  onAsk,
  onRestore,
  restoring,
  legacy,
}: {
  view: CardioWorkspaceView;
  onEdit: () => void;
  onAsk: (ask: string) => void;
  onRestore: (versionId: string) => void;
  restoring: string | null;
  /** The multi-week program editor (only when they have one). */
  legacy?: React.ReactNode;
}) {
  const [selectedVersion, setSelectedVersion] = useState("");
  const versions = view.versions.filter((v) => v.state !== "replaced").slice().sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.version_no - a.version_no);
  const previous = versions.find((v) => v.id === selectedVersion) ?? versions.filter((v) => v.effective_date <= view.today)[1];
  const [chart, setChart] = useState<"weeks" | "weekday" | "bodyweight">("weeks");
  const [table, setTable] = useState(false);
  const kpi = useMemo(() => cardioKpis({ today: view.today, rows: view.rows as any, completions: view.completions as any, live: view.live, ctx: view.ctx }), [view]);
  const weeks = useMemo(() => weeklySeries({ today: view.today, rows: view.rows as any, completions: view.completions as any, weighIns: view.weighIns, weeks: 12 }), [view]);
  const weekday = useMemo(() => weekdayDistribution({ today: view.today, live: view.live, ctx: view.ctx, completions: view.completions as any }), [view]);
  const summary = useMemo(() => summarizeCardio({ targets: view.rows as any, completions: view.completions as any, start: view.completions[0]?.completed_date ?? view.today, end: view.today }), [view]);
  const unit = view.weightUnit;
  const bw = weeks.filter((w) => w.bodyweightKg != null).map((w) => ({ ...w, bw: Math.round(fromKg(w.bodyweightKg!, unit) * 10) / 10 }));
  const markers = view.versions.filter((v) => v.state !== "replaced" && v.effective_date >= (weeks[0]?.start ?? "")).map((v) => ({ week: weeks.find((w) => v.effective_date >= w.start && v.effective_date <= weeksEnd(w.start))?.label, no: v.version_no }));
  const hasWeeks = weeks.some((w) => w.prescribed || w.completed);
  const dash = (v: number | null, f: (n: number) => string) => (v == null ? "—" : f(v));

  return (
    <div className="space-y-4" data-cardio-overview>
      <PlanEventTimeline clientId={view.clientId} renderMilestone={(m) => {
        const matches = plansOnDate(view.outcomes.filter((o) => versions.some((v) => v.id === o.id)), m.date, (o) => ({ start: o.from, end: o.to }));
        return matches.length ? <div className="space-y-2">{matches.map((o) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"><span>Version {o.versionNo} · {o.weeklyMinutes ?? "—"} min/week</span><Button type="button" size="sm" variant="outline" onClick={() => setSelectedVersion(o.id)}>Compare version</Button></div>)}</div> : <p className="text-muted-foreground">No published cardio version covers this date.</p>;
      }} />
      {versions.length > 1 && <details className="rounded-xl border border-border px-3 py-2 text-xs" open={selectedVersion ? true : undefined}>
        <summary className="cursor-pointer font-medium">Compare cardio plan{previous ? " · v" + previous.version_no : ""}</summary>
        <div className="space-y-3 pt-3">
          <label className="block text-muted-foreground">Reference version
            <select value={previous?.id ?? ""} onChange={(e) => setSelectedVersion(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground">
              {!previous && <option disabled value="">Pick a version</option>}
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} · {v.effective_date}</option>)}
            </select>
          </label>
          {previous && <>
            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <span/><span className="text-right text-muted-foreground">Reference</span><span className="text-right text-muted-foreground">Current</span>
              <span>Min/week</span><span className="text-right">{previous.weekly_minutes ?? "—"}</span><span className="text-right font-medium">{kpi.prescribedMinutes}</span>
              <span>Sessions/week</span><span className="text-right">{previous.weekly_sessions ?? "—"}</span><span className="text-right font-medium">{kpi.prescribedSessions}</span>
            </div>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={restoring === previous.id} onClick={() => onRestore(previous.id)}>Restore to draft</Button><Button type="button" size="sm" variant="outline" onClick={() => onAsk("Compare the current cardio with version " + previous.version_no + " effective " + previous.effective_date + " (ID " + previous.id + "). Use stored records and do not assume missing details.")}>Ask Cleo</Button></div>
          </>}
        </div>
      </details>}
      {/* the six numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-cardio-kpis>
        <Kpi label="Planned a week" value={`${kpi.prescribedMinutes} min`} sub={`${kpi.prescribedSessions} session${kpi.prescribedSessions === 1 ? "" : "s"}`} />
        <Kpi label="Done a week" value={dash(kpi.completedMinutes, (n) => `${n} min`)} sub="last 4 full weeks" />
        <Kpi label="Completion" value={dash(kpi.completionPct, (n) => `${n}%`)} sub="of planned sessions" />
        <Kpi label="Sessions a week" value={dash(kpi.completedSessions, (n) => `${n}`)} sub={`of ${kpi.prescribedSessions} planned`} />
        <Kpi label="Average effort" value={dash(kpi.avgRpe, (n) => `RPE ${n}`)} sub={kpi.targetRpe != null ? `target RPE ${kpi.targetRpe} · logged` : "logged by them"} />
        <Kpi label="Volume change" value={dash(kpi.volumeChangePct, (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`)} sub="vs the 4 weeks before" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* the plan in force */}
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4" data-cardio-current>
          <CardHeader
            icon={Activity}
            title="Current prescription"
            chip={view.pending ? <StatusChip tone="attention">Changes {fmtDay(view.pending.effective)}</StatusChip> : view.draft ? <StatusChip>Draft in progress</StatusChip> : null}
            actions={
              <Button variant="outline" className="h-10 gap-1.5" onClick={onEdit} data-cardio-edit>
                <Pencil className="h-4 w-4" /> {view.draft ? "Continue draft" : "Edit plan"}
              </Button>
            }
          />
          {view.live.sessions.length ? (
            <ul className="space-y-2.5">
              {view.live.sessions.map((s) => (
                <li key={s.key} className={cn("rounded-xl border border-border px-3 py-2.5", !s.enabled && "opacity-60")}>
                  <p className="text-[14px] font-medium">{sessionLine(s, view.speedUnit)}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {daysWords(s, view.ctx)} · {TIMING_SHORT[s.timing]}
                    {progressionWords(s.progression, view.speedUnit) ? ` · ${progressionWords(s.progression, view.speedUnit)}` : ""}
                    {s.enabled ? "" : " · paused"}
                  </p>
                  {s.instructions && <p className="mt-1 text-[12px] italic text-muted-foreground">“{s.instructions}”</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">No cardio set. That's fine unless their goal calls for it.</p>
          )}
          <CardioWeek plan={view.live} ctx={view.ctx} />
          {view.pending && (
            <p className="text-[12px] text-muted-foreground">
              From {fmtDay(view.pending.effective)}: {view.pending.plan.sessions.length ? view.pending.plan.sessions.map((s) => `${s.minutes} min ${sessionLine(s, view.speedUnit).split(" · ")[0].toLowerCase()}`).join(", ") : "no cardio"}.
            </p>
          )}
          {view.programs.length > 0 && <p className="text-[12px] text-muted-foreground">Also running: {view.programs.map((p) => p.name).join(", ")} (multi-week program).</p>}
        </section>

        {/* recovery and performance */}
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4" data-cardio-read>
          <CardHeader icon={ListChecks} title="Recovery & performance" />
          <Recommendation r={view.read.primary} primary onAsk={onAsk} />
          {view.read.others.map((r) => (
            <Recommendation key={r.kind} r={r} onAsk={onAsk} />
          ))}
          <details className="rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium">What it read ({view.read.signals.length})</summary>
            <ul className="mt-2 space-y-1.5" data-cardio-signals>
              {view.read.signals.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-[12px]">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", STATUS_DOT[s.status])} aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{s.label}</span> <span className="text-muted-foreground">({s.source}, {STATUS_WORD[s.status].toLowerCase()})</span>
                    <span className="block text-muted-foreground">{s.value}</span>
                  </span>
                </li>
              ))}
            </ul>
            {view.read.gaps.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Missing: {view.read.gaps.join("; ")}.</p>}
          </details>
        </section>
      </div>

      {/* charts */}
      {(hasWeeks || bw.length >= 2) && (
        <section className="rounded-2xl border border-border bg-card p-4" data-cardio-charts>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Chart">
              {(
                [
                  ["weeks", "By week"],
                  ["weekday", "By weekday"],
                  ...(bw.length >= 2 ? [["bodyweight", "Bodyweight"]] : []),
                ] as Array<[typeof chart, string]>
              ).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={chart === k} onClick={() => setChart(k)} className={cn("h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium", chart === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                  {l}
                </button>
              ))}
            </div>
            <button type="button" className="ml-auto cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setTable((t) => !t)}>
              {table ? "Show chart" : "Show table"}
            </button>
          </div>
          {chart !== "bodyweight" && (
            <div className="mt-2 flex items-center gap-4 text-[12px] text-muted-foreground" aria-hidden>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[color:var(--chart-planned)]" /> Planned</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[color:var(--chart-done)]" /> Done</span>
              {chart === "weeks" && markers.length > 0 && <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-foreground/50" /> Plan published</span>}
            </div>
          )}
          {table ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{chart === "weekday" ? "Day" : "Week of"}</th>
                    {chart === "bodyweight" ? <th className="py-1 pr-3 font-medium">Bodyweight ({unit})</th> : <><th className="py-1 pr-3 font-medium">Planned (min)</th><th className="py-1 pr-3 font-medium">Done (min)</th></>}
                  </tr>
                </thead>
                <tbody>
                  {chart === "weekday"
                    ? weekday.map((d) => (<tr key={d.day} className="border-t border-border"><td className="py-1 pr-3">{d.short}</td><td className="py-1 pr-3">{d.planned}</td><td className="py-1 pr-3">{d.doneAvg}</td></tr>))
                    : chart === "bodyweight"
                      ? bw.map((w) => (<tr key={w.start} className="border-t border-border"><td className="py-1 pr-3">{w.label}</td><td className="py-1 pr-3">{w.bw}</td></tr>))
                      : weeks.map((w) => (<tr key={w.start} className="border-t border-border"><td className="py-1 pr-3">{w.label}</td><td className="py-1 pr-3">{w.prescribed}</td><td className="py-1 pr-3">{w.completed}</td></tr>))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-2 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chart === "bodyweight" ? (
                  <LineChart data={bw} margin={{ top: 18, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip formatter={(v: any) => [`${v} ${unit}`, "Weekly average"]} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    {markers.map((m) => m.week && <ReferenceLine key={m.no} x={m.week} stroke="var(--foreground)" strokeOpacity={0.4} strokeDasharray="3 3" />)}
                    <Line type="monotone" dataKey="bw" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                ) : (
                  <BarChart data={chart === "weekday" ? weekday.map((d) => ({ label: d.short, prescribed: d.planned, completed: d.doneAvg })) : weeks} barGap={2} margin={{ top: 18, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                      formatter={(v: any, k: any) => [`${v} min`, k === "prescribed" ? "Planned" : chart === "weekday" ? "Done (avg)" : "Done"]}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    />
                    {chart === "weeks" && markers.map((m) => m.week && <ReferenceLine key={m.no} x={m.week} stroke="var(--foreground)" strokeOpacity={0.4} strokeDasharray="3 3" label={{ value: `v${m.no}`, position: "top", fontSize: 10, fill: "var(--muted-foreground)" }} />)}
                    <Bar dataKey="prescribed" fill="var(--chart-planned)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="completed" fill="var(--chart-done)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          {chart === "bodyweight" && <p className="mt-1 text-[11px] text-muted-foreground">Weekly average of their weigh-ins (measured). Dashed lines: a cardio plan published.</p>}
        </section>
      )}

      {/* history, folded */}
      <Accordion type="multiple" className="rounded-2xl border border-border bg-card" data-cardio-history>
        <Section value="sessions" title="Logged sessions" meta={summary.sessions.length ? `${summary.sessions.length} in 26 weeks` : "None yet"} icon={HistoryIcon}>
          {summary.sessions.length ? (
            <ul className="divide-y divide-border">
              {summary.sessions.slice(0, 20).map((s, i) => (
                <li key={`${s.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="font-medium">{fmtDay(s.date)}</span> · {s.modality}
                    {s.fromWorkout ? <span className="text-muted-foreground"> · in a workout</span> : null}
                    {s.skipped ? <span className="text-muted-foreground"> · skipped</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {loggedDetails(s).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nothing logged in the last 26 weeks.</p>
          )}
        </Section>
        <Section value="versions" title="Prescription history" meta={view.versions.length ? `${view.versions.length} published` : "Not published from the builder yet"} icon={HistoryIcon}>
          {view.outcomes.length ? (
            <ul className="space-y-3" data-cardio-versions>
              {view.outcomes.map((o) => {
                const v = view.versions.find((x) => x.id === o.id);
                return (
                  <li key={o.id} className="rounded-xl border border-border px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        Version {o.versionNo} · from {fmtDay(o.from)}
                        {o.to ? ` to ${fmtDay(o.to)}` : ""}
                        {v?.state === "scheduled" ? " · scheduled" : !o.to ? " · current" : ""}
                      </p>
                      <Button variant="ghost" className="h-8 px-2 text-[12px]" disabled={restoring === o.id} onClick={() => onRestore(o.id)}>
                        {restoring === o.id ? "Restoring…" : "Restore to draft"}
                      </Button>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {[o.weeklyMinutes != null ? `${o.weeklyMinutes} min/week planned` : null, o.donePct != null ? `${o.donePct}% done` : null, o.bodyweightPctPerWeek != null ? `bodyweight ${o.bodyweightPctPerWeek > 0 ? "+" : ""}${o.bodyweightPctPerWeek}%/week` : null, v?.source && v.source !== "coach" ? `from ${v.source}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {o.changes.length > 0 && <p className="mt-1 text-[12px]">{o.changes.slice(0, 4).join(" · ")}</p>}
                    {o.note && <p className="mt-1 text-[12px] italic text-muted-foreground">Why: {o.note}</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Every plan you publish from the builder is kept here with what changed, why, and how it went.</p>
          )}
        </Section>
        {legacy ? (
          <Section value="programs" title="Multi-week programs" meta={view.programs.length ? view.programs.map((p) => p.name).join(", ") : undefined} icon={CircleAlert}>
            {legacy}
          </Section>
        ) : null}
      </Accordion>
    </div>
  );
}

function weeksEnd(start: string): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
}
