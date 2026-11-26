/**
 * Records: what the athlete has built (records.ts). Lifetime numbers first,
 * then the latest records worth celebrating, competitions as a timeline, and
 * every exercise's records, searchable. A first time is a baseline, never a
 * record; one record per exercise a day; tiny gains don't count.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Search, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { dualLoad } from "@/lib/analytics/units";
import { normalizeWeights, weightReferences, weightContextAt, weightPeriods } from "@/lib/analytics/weight-context";
import type { BodyweightPoint } from "@/lib/bodyweight";
import { comparableE1rm } from "@/lib/analytics/strength-read";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";
import { compLiftOfResult } from "@/lib/analytics/competition-strength";
import { localDay, isMeetLog } from "@/lib/analytics/lift-strength";
import { officialClass } from "@/lib/analytics/performance-ring";
import { attemptStats, compareInsights, type PerformanceVersion } from "@/lib/analytics/coach-analysis";
import { competitionRing } from "@/lib/analytics/performance-ring";
import { Input } from "@/components/ui/input";
import {
  isHeadlineRecord,
  nextLiftedMilestone,
  type ExerciseRecords,
  type Lifetime,
  type PersonalRecord,
} from "@/lib/analytics/records";
import { COMP_LIFTS, COMP_LIFT_LABEL, type MeetResult } from "@/lib/analytics/competition-strength";
import { SectionTitle, LB_PER_KG, LIFT_SERIES } from "@/components/analytics/viz";

const fmt = (d: string, f?: string) => {
  const x = parseLocalDate(d);
  return x
    ? format(x, f ?? (x.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy"))
    : d;
};

function compact(v: number): string {
  if (v >= 1_000_000) return `${(Math.round(v / 10_000) / 100).toLocaleString()}M`;
  if (v >= 10_000) return `${Math.round(v / 1000).toLocaleString()}k`;
  return Math.round(v).toLocaleString();
}

export function RecordsView({
  initialSection = "gym",
  onSectionChange,
  lifetime,
  records,
  byExercise,
  meets,
  unit,
  bodyweights = [],
  sex = null,
  results = [],
  today = new Date().toISOString().slice(0,10),
}: {
  initialSection?: "gym"|"competitions"|"lifetime";
  onSectionChange?: (section:"gym"|"competitions"|"lifetime")=>void;
  bodyweights?: readonly BodyweightPoint[];
  sex?: "male"|"female"|null;
  results?: any[];
  today?: string;
  lifetime: Lifetime;
  records: PersonalRecord[];
  byExercise: ExerciseRecords[];
  meets: MeetResult[];
  unit: "lb" | "kg";
}) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const lifted = unit === "kg" ? lifetime.liftedKg : lifetime.liftedLb;
  const next = nextLiftedMilestone(lifetime.liftedLb, unit);
  const recent = useMemo(() => {
    const cut = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    return records
      .filter((r) => r.day >= cut)
      .sort(
        (a, b) =>
          Number(isHeadlineRecord(b)) - Number(isHeadlineRecord(a)) || b.day.localeCompare(a.day),
      )
      .slice(0, 4);
  }, [records]);

  const [localSection,setLocalSection]=useState<"gym"|"competitions"|"lifetime">(initialSection);
  const section=onSectionChange?initialSection:localSection;
  const setSection=(next:"gym"|"competitions"|"lifetime")=>{setLocalSection(next);onSectionChange?.(next);};
  const [category,setCategory]=useState("all");
  const [period,setPeriod]=useState("all");
  const [kind,setKind]=useState<"single"|"estimated"|"rep">("rep");
  const [query,setQuery]=useState("");
  const [limit,setLimit]=useState(12);
  const weights=useMemo(()=>normalizeWeights(bodyweights),[bodyweights]);
  const refs=useMemo(()=>weightReferences(meets,sex),[meets,sex]);
  const periods=useMemo(()=>weightPeriods(weights,refs),[weights,refs]);
  const grouped=useMemo(()=>{
    const selected=periods.find(p=>p.start===period);
    const best=new Map<string,{name:string;day:string;lb:number;load:number;reps:number;rpe:number|null;category:string|null;bw:number|null}>();
    const contexts=new Map<string,ReturnType<typeof weightContextAt>>();
    const clean=neutralizeObviousLoadOutliers(results.map(r=>({...r,est_1rm:Number(r.est_1rm)||0})));
    const meetDays=new Set<string>();
    for(const r of clean){const lift=compLiftOfResult(r);if(!lift||!r.date)continue;const day=localDay(r.date);if(meets.some(m=>isMeetLog({day,heaviest:Number(r.load)},{day:m.date,lb:m.lifts[lift]})))meetDays.add(lift+"|"+day)}
    for(const r of clean){
      const load=Number(r.load),reps=Number(r.reps);
      if(!r.date||!(load>0)||!(reps>0)||r.counts_load===false||r.analytics_load_outlier)continue;
      const day=localDay(r.date);const lift=compLiftOfResult(r);if(lift&&meetDays.has(lift+"|"+day))continue;if(day>today||selected&&(day<selected.start||day>selected.end))continue;
      let ctx=contexts.get(day);if(!ctx){ctx=weightContextAt(weights,refs,day);contexts.set(day,ctx)}
      const cat=ctx.category?.label??null;
      if(category!=="all"&&(cat??"unknown")!==category)continue;
      if(kind==="single"&&reps!==1)continue;
      const name=String(r.exercise_name??"Exercise");
      if(!name.toLowerCase().includes(query.trim().toLowerCase()))continue;
      const lb=kind==="estimated"?comparableE1rm({load,reps,rpe:r.rpe,rir:r.rir}):load;
      if(lb==null||!Number.isFinite(lb)||lb<=0)continue;
      const key=String(r.exercise_id??name)+(kind==="rep"?":"+reps:"");
      const old=best.get(key);
      if(!old||lb>old.lb)best.set(key,{name,day,lb,load,reps,rpe:r.rpe==null?null:Number(r.rpe),category:cat,bw:ctx.averageKg});
    }
    return [...best.values()].sort((a,b)=>b.day.localeCompare(a.day)||a.name.localeCompare(b.name));
  },[results,weights,refs,periods,category,period,kind,query,today,meets]);
  return (
    <div className="space-y-5" data-records-view>
      <div className="flex gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Record type">
        {(["gym","competitions","lifetime"] as const).map(k=><button type="button" key={k} aria-pressed={section===k} onClick={()=>setSection(k)} className={cn("min-h-10 flex-1 rounded-lg text-xs font-medium",section===k?"bg-background text-foreground":"text-muted-foreground")}>{k==="gym"?"Gym PRs":k==="competitions"?"Competitions":"Lifetime"}</button>)}
      </div>
      {section==="gym"&&<>
        {results.length>0&&<section className="space-y-3" aria-label="Historical gym bests">
          <div className="flex gap-1">{(["rep","single","estimated"] as const).map(k=><button type="button" key={k} aria-pressed={kind===k} onClick={()=>{setKind(k);setLimit(12)}} className={cn("min-h-10 flex-1 rounded-lg border border-border text-xs",kind===k&&"bg-muted font-semibold")}>{k==="rep"?"Rep bests":k==="single"?"Singles":"e1RM"}</button>)}</div>
          <Input value={query} onChange={e=>{setQuery(e.target.value);setLimit(12)}} placeholder="Search exercises" aria-label="Search records" />
          {weights.length>0&&<div className="flex gap-2"><select aria-label="Training weight class" className="min-h-10 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs" value={category} onChange={e=>{setCategory(e.target.value);setPeriod("all");setLimit(12)}}><option value="all">All classes</option>{refs.map(c=><option key={c.label}>{c.label}</option>)}<option value="unknown">Uncategorized</option></select><select aria-label="Historical period" className="min-h-10 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs" value={period} onChange={e=>{setPeriod(e.target.value);setLimit(12)}}><option value="all">All dates</option>{periods.filter(p=>category==="all"||p.category===category).map(p=><option value={p.start} key={p.start}>{p.category} · {p.start} – {p.end}</option>)}</select></div>}
          <div className="divide-y divide-border">{grouped.slice(0,limit).map((row,i)=><details key={row.name+":"+row.reps+":"+i} className="py-2"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 min-h-10"><div className="min-w-0"><div className="text-sm font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{fmt(row.day)}{row.category?" · "+row.category:""}</div></div><div className="shrink-0 text-right"><div className="text-sm font-semibold">{dualLoad(row.lb,unit).main}{kind!=="estimated"?" × "+row.reps:""}</div><div className="text-xs text-muted-foreground">{dualLoad(row.lb,unit).other}</div></div></summary><div className="text-xs text-muted-foreground pt-2">Source set: {dualLoad(row.load,unit).main} · {dualLoad(row.load,unit).other} × {row.reps}{row.rpe?" @ RPE "+row.rpe:""}{row.bw?" · BW "+dualLoad(row.bw*LB_PER_KG,unit).main:""}. {kind==="estimated"?"Estimated, not achieved.":""}</div></details>)}</div>
          {!grouped.length&&<p className="text-sm text-muted-foreground">No qualifying records for this selection.</p>}
          {grouped.length>limit&&<button type="button" className="min-h-10 text-sm font-medium" onClick={()=>setLimit(n=>n+12)}>Show more ({grouped.length-limit})</button>}
        </section>}
        <details><summary className="min-h-10 cursor-pointer text-sm font-medium">Record progression history</summary><ExerciseRecordList rows={byExercise} unit={unit}/></details>
      </>}
      {section==="competitions"&&(meets.length?<MeetTimeline meets={meets} unit={unit}/>:<p className="text-sm text-muted-foreground">No recorded competition results yet.</p>)}
      {section==="lifetime"&&<>

      <section aria-label="Lifetime">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4" data-lifetime>
          <div className="col-span-2 sm:col-span-2">
            <div className="text-[12px] text-muted-foreground">
              Total weight lifted, all time
            </div>
            <div className="text-[38px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
              {compact(lifted)}
              <span className="ml-1 text-[15px] font-medium text-muted-foreground">{unit}</span>
            </div>
            <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">
              {unit === "kg"
                ? `${compact(lifetime.liftedLb)} lb`
                : `${compact(lifetime.liftedKg)} kg`}
              {lifetime.firstDay ? ` · since ${fmt(lifetime.firstDay, "MMM yyyy")}` : ""} · every
              set's weight × reps, added up
            </div>
            <div
              className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={next}
              aria-valuenow={lifted}
              aria-label="Toward the next milestone"
            >
              <div
                className="h-full rounded-full bg-foreground/80"
                style={{ width: `${Math.min(100, (lifted / next) * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Next milestone: {compact(next)} {unit}
            </div>
          </div>
          <Counter
            label="Workouts"
            value={lifetime.workouts.toLocaleString()}
            sub={`${lifetime.sets.toLocaleString()} sets`}
          />
          <Counter
            label="Records"
            value={lifetime.records.toLocaleString()}
            sub={
              lifetime.bestStreakWeeks >= 2
                ? `longest streak ${lifetime.bestStreakWeeks} weeks`
                : `across ${lifetime.exercises} exercises`
            }
          />
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-label="Latest records">
          <SectionTitle
            title="Latest records"
            sub="Your new bests from the last two months"
            info={
              <p>
                A record is beating your own best on an exercise: the heaviest weight you've lifted,
                or your best estimated max (the most you could likely lift once, worked out from a
                set). The first time you do an exercise sets the starting point.
              </p>
            }
          />
          <div className="grid gap-2 sm:grid-cols-2" data-recent-records>
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border border-border p-3"
                data-record-card
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
                  <Trophy className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-foreground">
                    {r.exercise}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {fmt(r.day)} ·{" "}
                    {r.kinds.includes("weight") ? "heaviest ever" : "best estimated max yet"}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-[15px] font-semibold text-foreground">
                    {w(r.load)} {unit} × {r.reps}
                  </div>
                  <div className="text-[12px] text-success">up {r.gainPct}%</div>
                </div>
              </div>
            ))}
          </div>
          {lifetime.bestWeek && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Your best week for records: the week of {fmt(lifetime.bestWeek.monday)}, with{" "}
              {lifetime.bestWeek.records}.
            </p>
          )}
        </section>
      )}

      </>}
    </div>
  );
}

function Counter({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[28px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MeetTimeline({ meets, unit }: { meets: MeetResult[]; unit: "lb" | "kg" }) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const [all,setAll]=useState(false);
  const [category,setCategory]=useState("all");
  const [compare,setCompare]=useState(false);
  const [a,setA]=useState(0),[b,setB]=useState(1);
  const classes=[...new Set(meets.map(officialClass).filter((x):x is string=>!!x))];
  const filtered=meets.filter(m=>category==="all"||officialClass(m)===category);
  const shown=all?filtered:filtered.slice(0,5);
  const best=filtered.reduce<MeetResult|null>((a,m)=>!a||m.total>a.total?m:a,null);
  const version=(m:MeetResult):PerformanceVersion=>({key:m.id??m.date,label:m.name??"Competition",kind:"official",lifts:competitionRing([m],"all","latest").lifts,totalLb:m.total,bodyweightKg:m.bodyweightLb?m.bodyweightLb/LB_PER_KG:null,category:officialClass(m),end:m.date});
  return <section aria-label="Competitions" className="space-y-3">
    <div className="flex items-center gap-2"><select className="min-h-10 flex-1 rounded-lg border bg-background px-2 text-xs" aria-label="Official weight class" value={category} onChange={e=>{setCategory(e.target.value);setAll(false);setA(0);setB(1)}}><option value="all">All official classes</option>{classes.map(k=><option key={k}>{k}</option>)}</select>{filtered.length>1&&<button type="button" className="min-h-10 text-xs font-medium" onClick={()=>setCompare(!compare)}>{compare?"Close":"Compare"}</button>}</div>
    {best&&<div className="border-b border-border pb-3"><div className="text-xs text-muted-foreground">Best official total</div><div className="text-2xl font-semibold">{dualLoad(best.total,unit).main} <span className="text-sm text-muted-foreground">{dualLoad(best.total,unit).other}</span></div><div className="text-xs text-muted-foreground">{officialClass(best)??"Class unknown"} · {fmt(best.date)}</div></div>}
    {compare&&filtered.length>1&&<div className="space-y-2 rounded-xl bg-muted/40 p-3"><div className="grid grid-cols-2 gap-2">{[a,b].map((v,i)=><select key={i} aria-label={"Meet "+(i===0?"A":"B")} className="min-h-10 min-w-0 rounded-lg bg-background text-xs" value={v} onChange={e=>(i===0?setA:setB)(Number(e.target.value))}>{filtered.map((m,j)=><option value={j} key={j}>{m.date} · {m.name}</option>)}</select>)}</div>{a!==b&&filtered[a]&&filtered[b]?<>{COMP_LIFTS.map(l=><div key={l} className="flex justify-between text-xs"><span>{COMP_LIFT_LABEL[l]}</span><span>{dualLoad(filtered[a].lifts[l],unit).main} vs {dualLoad(filtered[b].lifts[l],unit).main}</span></div>)}{compareInsights(version(filtered[a]),version(filtered[b])).map(i=><p key={i.label} className="text-xs"><strong>{i.label}: </strong>{i.text}</p>)}</>:<p className="text-xs text-muted-foreground">Choose two different meets.</p>}</div>}
    <ol className="divide-y divide-border" data-meet-timeline>{shown.map(m=><li key={m.id??m.date+"-"+m.name}><details className="py-2"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 min-h-12"><div className="min-w-0"><div className="text-sm font-medium">{m.name??"Competition"}</div><div className="text-xs text-muted-foreground">{fmt(m.date,"MMM d, yyyy")} · {officialClass(m)??"Class unknown"}</div></div><div className="shrink-0 text-right"><div className="font-semibold text-sm">{dualLoad(m.total,unit).main}</div><div className="text-xs text-muted-foreground">{dualLoad(m.total,unit).other}</div></div></summary><div className="space-y-2 py-2 text-xs">{m.bodyweightLb&&<p>Bodyweight: {dualLoad(m.bodyweightLb,unit).main} / {dualLoad(m.bodyweightLb,unit).other}</p>}{COMP_LIFTS.map(l=>{const s=attemptStats([m],l);return <div key={l} className="flex justify-between gap-2"><span>{COMP_LIFT_LABEL[l]}{s.attempts?" · "+s.success+"/"+s.attempts+" good":""}</span><span>{dualLoad(m.lifts[l],unit).main} / {dualLoad(m.lifts[l],unit).other}</span></div>})}</div></details></li>)}</ol>
    {filtered.length>shown.length&&<button type="button" className="min-h-10 text-sm" onClick={()=>setAll(true)}>Show all {filtered.length} meets</button>}
  </section>;
}

function ExerciseRecordList({ rows, unit }: { rows: ExerciseRecords[]; unit: "lb" | "kg" }) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);
  const filtered = q.trim()
    ? rows.filter((r) => r.exercise.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;
  if (!rows.length)
    return (
      <section aria-label="Records by exercise">
        <SectionTitle title="Records by exercise" />
        <p className="text-[13px] text-muted-foreground">
          No records yet. The first time you log an exercise sets its baseline; beating it is a
          record.
        </p>
      </section>
    );
  return (
    <section aria-label="Records by exercise">
      <SectionTitle
        title="Records by exercise"
        sub={`${rows.length} exercise${rows.length === 1 ? "" : "s"}, most recent first. Tap one to see each record.`}
      />
      {rows.length > 8 && (
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an exercise"
            className="h-10 pl-9"
            aria-label="Find an exercise"
          />
        </div>
      )}
      <ul className="divide-y divide-border/60" data-records-by-exercise>
        {filtered.slice(0, limit).map((r) => {
          const isOpen = open === r.key;
          const best = r.bestE1rm;
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.key)}
                aria-expanded={isOpen}
                className="flex min-h-12 w-full items-center gap-3 py-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-foreground">
                    {r.exercise}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.records.length} record{r.records.length === 1 ? "" : "s"} · last{" "}
                    {fmt(r.lastDay)}
                  </div>
                </div>
                {best && (
                  <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-foreground">
                    {w(best.load)} {unit} × {best.reps}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <ol
                  className="mb-3 space-y-1 border-l border-border pl-3 text-[12px] tabular-nums"
                  data-exercise-records={r.key}
                >
                  {[...r.records].reverse().map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{fmt(p.day)}</span>
                      <span className="text-foreground">
                        {w(p.load)} {unit} × {p.reps}
                        {p.rpe ? <span className="text-muted-foreground"> at RPE {p.rpe}</span> : null}
                        <span className="ml-2 text-success">up {p.gainPct}%</span>
                      </span>
                    </li>
                  ))}
                  {r.heaviest && (
                    <li className="pt-1 text-muted-foreground">
                      Heaviest ever: {w(r.heaviest.load)} {unit} × {r.heaviest.reps} (
                      {fmt(r.heaviest.day)})
                    </li>
                  )}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 24)}
          className="mt-1 min-h-10 text-[13px] font-medium text-foreground"
        >
          Show more
        </button>
      )}
    </section>
  );
}
