/**
 * Program Intelligence report sections: what the records show, read in
 * plain words. Every number is from the deterministic report; findings carry
 * FACT / HYPOTHESIS / MISSING and their evidence.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookmarkPlus, Check } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtLoad, fmtSet, LB_PER_KG } from "@/lib/program-intel/core";
import { LIFTS, type Finding, type IntelReport, type Lift } from "@/lib/program-intel/types";

const LIFT_LABEL: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

export function KindChip({ kind }: { kind: Finding["kind"] }) {
  const map = {
    fact: ["Fact", "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"],
    hypothesis: ["Hypothesis", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    missing: ["Missing", "bg-muted text-muted-foreground"],
  } as const;
  const [label, cls] = map[kind];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[10px] font-black uppercase tracking-wider", cls)}>{label}</span>;
}

const AREAS: Array<[Finding["area"], string]> = [
  ["improved", "What improved"],
  ["stalled", "What stalled"],
  ["change", "What may need changing"],
  ["next", "For the next cycle"],
  ["missing", "What the records can't tell"],
];

export function FindingsSummary({ report, savedKeys, onSave, saving }: { report: IntelReport; savedKeys: Set<string>; onSave?: (f: Finding) => void; saving?: boolean }) {
  return (
    <div className="space-y-4" data-testid="intel-findings">
      {AREAS.map(([area, title]) => {
        const list = report.findings.filter((f) => f.area === area);
        if (!list.length) return null;
        return (
          <section key={area}>
            <h3 className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
            <Card className="divide-y divide-border/60 p-0">
              {list.map((f) => (
                <div key={f.id} className="space-y-1 p-3" data-finding={f.id} data-kind={f.kind}>
                  <div className="flex items-start gap-2">
                    <KindChip kind={f.kind} />
                    <div className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{f.title}</div>
                    {onSave && f.kind !== "missing" &&
                      (savedKeys.has(f.id) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-600"><Check className="h-3 w-3" /> Kept</span>
                      ) : (
                        <Button size="sm" variant="ghost" className="-my-1 h-7 shrink-0 px-2 text-[11px]" disabled={saving} onClick={() => onSave(f)} aria-label={`Keep in the athlete's memory: ${f.title}`}>
                          <BookmarkPlus className="mr-1 h-3.5 w-3.5" /> Keep
                        </Button>
                      ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                  {f.evidence.length > 0 && (
                    <details className="group text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer select-none font-semibold text-foreground/70">Evidence ({f.evidence.length})</summary>
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {f.evidence.map((e, i) => (
                          <li key={i} className="list-disc">{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-secondary/50 px-2.5 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-black tabular-nums">{value}</div>
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Change({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const Icon = pct >= 2 ? ArrowUpRight : pct <= -2 ? ArrowDownRight : ArrowRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-bold tabular-nums", pct >= 2 ? "text-emerald-600" : pct <= -2 ? "text-destructive" : "text-muted-foreground")}>
      <Icon className="h-3.5 w-3.5" />
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

export function LiftsSection({ report }: { report: IntelReport }) {
  const u = report.client.unit;
  const kg = (n: number | null) => (n == null ? "—" : fmtLoad(n, u));
  const conv = (v: number) => (u === "lb" ? Math.round(v * LB_PER_KG) : Math.round(v * 2) / 2);
  return (
    <div className="space-y-3" data-testid="intel-lifts">
      {report.lifts.map((l) => {
        const pts = l.compTrend.points.map((p) => ({ date: p.date.slice(5), value: conv(p.value) }));
        return (
          <Card key={l.lift} className="space-y-3 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{LIFT_LABEL[l.lift]}</div>
                <div className="truncate text-xs text-muted-foreground">{l.competitionExercise ?? "No competition variation logged"}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-black tabular-nums">{kg(l.compTrend.last)}</div>
                <div className="text-[11px]">
                  e1RM <Change pct={l.compTrend.changePct} />
                  {l.stalled && <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">stalled</span>}
                </div>
              </div>
            </div>
            {pts.length >= 2 && (
              <div className="h-24" aria-label={`${LIFT_LABEL[l.lift]} e1RM by date`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pts} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                    <YAxis domain={["dataMin - 5", "dataMax + 5"]} hide />
                    <Tooltip formatter={(v: number) => [`${v}${u}`, "e1RM"]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Frequency" value={l.frequencyPerWeek != null ? `${l.frequencyPerWeek}×/wk` : "—"} />
              <Stat label="Sets / week" value={l.setsPerWeek != null ? String(l.setsPerWeek) : "—"} sub={l.repsPerWeek != null ? `${l.repsPerWeek} reps` : undefined} />
              <Stat label="Avg load" value={l.avgRelativeIntensityPct != null ? `${l.avgRelativeIntensityPct}%` : "—"} sub="of best e1RM" />
              <Stat label="RPE vs target" value={l.avgRpeDelta != null ? `${l.avgRpeDelta > 0 ? "+" : ""}${l.avgRpeDelta}` : "—"} />
              <Stat label="Heavy singles" value={String(l.heavySingles)} sub="≥85% e1RM" />
              <Stat label="Back-offs done" value={l.backoffCompletionPct != null ? `${l.backoffCompletionPct}%` : "—"} />
            </div>
            <div className="text-[11px] text-muted-foreground">
              RPE &lt;7 {l.rpeBuckets.easy} · 7–8.5 {l.rpeBuckets.moderate} · 9+ {l.rpeBuckets.hard}{l.rpeBuckets.unknown ? ` · unrated ${l.rpeBuckets.unknown}` : ""} &nbsp;|&nbsp; reps 1–3 {l.repBuckets.r1_3} · 4–6 {l.repBuckets.r4_6} · 7–10 {l.repBuckets.r7_10} · 11+ {l.repBuckets.r11p}
            </div>
            {l.variations.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer select-none font-semibold">Variations ({l.variations.length})</summary>
                <ul className="mt-1.5 space-y-1">
                  {l.variations.map((v) => (
                    <li key={v.exercise} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {v.exercise} <span className="text-muted-foreground">· {v.exposures}× · {v.weeks.join(", ")}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {v.trend.first != null ? `${kg(v.trend.first)}→${kg(v.trend.last)}` : "—"}
                        {v.compChangeDuringPct != null && <> · comp <Change pct={v.compChangeDuringPct} /></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function MusclesSection({ report }: { report: IntelReport }) {
  const max = Math.max(1, ...report.muscles.map((m) => m.avgHardSetsPerWeek ?? 0));
  if (!report.muscles.length) return <Card className="p-4 text-sm text-muted-foreground">No hard sets logged in this period.</Card>;
  return (
    <Card className="space-y-2 p-3.5" data-testid="intel-muscles">
      <div className="text-[11px] text-muted-foreground">Hard sets per week (RPE 6+ or unrated; primary muscle 1, secondary ½), averaged over trained weeks.</div>
      {report.muscles.map((m) => (
        <div key={m.muscle} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold">{m.muscle}</span>
            <span className="tabular-nums text-muted-foreground">
              <b className="text-foreground">{m.avgHardSetsPerWeek ?? "—"}</b>/wk
              {m.firstHalfAvg != null && m.secondHalfAvg != null && <> · {m.firstHalfAvg}→{m.secondHalfAvg}</>}
              {m.frequencyPerWeek != null && <> · {m.frequencyPerWeek}×/wk</>}
              {m.target && <span className={cn("ml-1 font-bold", m.status === "within" ? "text-emerald-600" : "text-amber-600")}>{m.status}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${((m.avgHardSetsPerWeek ?? 0) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function WeeksSection({ report }: { report: IntelReport }) {
  const u = report.client.unit;
  return (
    <Card className="overflow-x-auto p-0" data-testid="intel-weeks">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-secondary/60 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            {["Week", "Sessions", "Sets", "Adherence", "Hard sets", "Avg RPE", "vs target", ...LIFTS.map((l) => LIFT_LABEL[l]), "Tonnage"].map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 tabular-nums">
          {report.weeks.map((w) => (
            <tr key={w.key}>
              <td className="px-2 py-1.5 font-semibold">
                {w.label}
                <div className="text-[10px] font-normal text-muted-foreground">{w.start?.slice(5) ?? "?"}{w.phase ? ` · ${w.phase}` : ""}</div>
              </td>
              <td className="px-2 py-1.5">{w.completedDays + w.partialDays}/{w.dueDays}{w.upcomingDays ? <span className="text-muted-foreground"> +{w.upcomingDays}</span> : null}</td>
              <td className="px-2 py-1.5">{w.workingSetsLogged}/{w.prescribedSetsDue}</td>
              <td className={cn("px-2 py-1.5 font-bold", (w.setAdherencePct ?? 100) < 75 && "text-amber-600")}>{w.setAdherencePct != null ? `${w.setAdherencePct}%` : "—"}</td>
              <td className="px-2 py-1.5">{w.hardSets}</td>
              <td className="px-2 py-1.5">{w.avgRpe ?? "—"}</td>
              <td className="px-2 py-1.5">{w.avgRpeDelta != null ? `${w.avgRpeDelta > 0 ? "+" : ""}${w.avgRpeDelta}` : "—"}</td>
              {LIFTS.map((l) => (
                <td key={l} className="px-2 py-1.5">
                  {w.lifts[l].sets || "—"}
                  {w.lifts[l].topE1rm != null && <div className="text-[10px] text-muted-foreground">{fmtLoad(w.lifts[l].topE1rm as number, u)}</div>}
                </td>
              ))}
              <td className="px-2 py-1.5">{w.tonnageKg ? fmtLoad(w.tonnageKg, u) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function BlocksSection({ report }: { report: IntelReport }) {
  const u = report.client.unit;
  return (
    <div className="space-y-2" data-testid="intel-blocks">
      {report.blocks.map((b) => (
        <Card key={b.blockId} className="space-y-2 p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-black">B{b.number} · {b.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {b.start ?? "?"} → {b.end ?? "?"} · {b.weeks} wk{b.focus ? ` · ${b.focus}` : ""}
                {b.hidden ? " · hidden" : ""}
                {b.archived ? " · archived" : ""}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <div><b className="text-foreground">{b.sessionAdherencePct ?? "—"}%</b> sessions</div>
              <div>{b.setAdherencePct ?? "—"}% sets</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {LIFTS.filter((l) => b.liftChange[l].changePct != null).map((l) => (
              <span key={l} className="rounded-full bg-secondary px-2 py-0.5">
                {LIFT_LABEL[l]} {fmtLoad(b.liftChange[l].fromKg as number, u)}→{fmtLoad(b.liftChange[l].toKg as number, u)} <Change pct={b.liftChange[l].changePct} />
              </span>
            ))}
            <span className="rounded-full bg-secondary px-2 py-0.5">{b.avgHardSetsPerWeek ?? "—"} hard sets/wk</span>
            <span className="rounded-full bg-secondary px-2 py-0.5">RPE {b.avgRpe ?? "—"}{b.avgRpeDelta != null ? ` (${b.avgRpeDelta > 0 ? "+" : ""}${b.avgRpeDelta})` : ""}</span>
            {b.painReports > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">{b.painReports} pain</span>}
          </div>
          {b.topMuscles.length > 0 && <div className="text-[11px] text-muted-foreground">Most volume: {b.topMuscles.map((m) => `${m.muscle} ${m.setsPerWeek}`).join(" · ")}</div>}
        </Card>
      ))}
    </div>
  );
}

export function ExercisesSection({ report }: { report: IntelReport }) {
  const u = report.client.unit;
  return (
    <Card className="divide-y divide-border/60 p-0" data-testid="intel-exercises">
      {report.exercises.map((e) => (
        <div key={e.key} className="flex items-baseline justify-between gap-2 px-3 py-2 text-xs">
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {e.name}
              {!e.exerciseId && <span className="ml-1 text-[10px] font-normal text-amber-600">not in library</span>}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {e.exposures}× · {e.workingSetsLogged}/{e.setsPrescribedDue} sets · best {fmtSet(e.bestSet, u)}{e.avgRpe != null ? ` · RPE ${e.avgRpe}` : ""}
            </div>
          </div>
          <div className="shrink-0 text-right text-[11px]">
            {e.trend.first != null ? (
              <>
                {fmtLoad(e.trend.first, u)}→{fmtLoad(e.trend.last as number, u)} <Change pct={e.trend.changePct} />
              </>
            ) : e.repsTrend ? (
              <span className="text-muted-foreground">reps {e.repsTrend.first}→{e.repsTrend.last}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {e.stalled && <div className="font-bold text-amber-600">stalled</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function RecoveryCard({ report }: { report: IntelReport }) {
  const r = report.recovery;
  return (
    <Card className="space-y-1 p-3.5 text-xs">
      <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Recovery (check-outs)</div>
      <div>Session RPE {r.sessionRpeAvg ?? "—"} · rating {r.ratingAvg ?? "—"} · {r.painReports.length} pain report{r.painReports.length === 1 ? "" : "s"}</div>
      {Object.keys(r.fatigue).length > 0 && <div className="text-muted-foreground">Fatigue: {Object.entries(r.fatigue).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
      {Object.keys(r.sleep).length > 0 && <div className="text-muted-foreground">Sleep: {Object.entries(r.sleep).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
      {report.bodyweight.entries > 0 && (
        <div className="text-muted-foreground">
          Bodyweight {fmtLoad(report.bodyweight.first as number, report.client.unit)} → {fmtLoad(report.bodyweight.last as number, report.client.unit)} ({report.bodyweight.entries} entries)
        </div>
      )}
    </Card>
  );
}
