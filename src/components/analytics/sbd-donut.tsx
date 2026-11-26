import { useMemo, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { COMP_LIFTS, COMP_LIFT_LABEL, type CompLift, type MeetResult } from "@/lib/analytics/competition-strength";
import { liftStrengths, type LiftStrength } from "@/lib/analytics/lift-strength";
import type { BodyweightPoint } from "@/lib/bodyweight";
import { currentRing, competitionRing, gymRingRecords, gymRingBests, officialClass, ringTotal, type RingLifts } from "@/lib/analytics/performance-ring";
import { normalizeWeights, weightReferences, weightContextAt, weightPeriods } from "@/lib/analytics/weight-context";
import { dualLoad, loadNum, otherUnit, LB_PER_KG, type Unit } from "@/lib/analytics/units";
import { arcPath, LIFT_SERIES, Segmented } from "@/components/analytics/viz";
import { InfoTip } from "@/components/analytics/info-tip";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { compareInsights, lifterProfile, type PerformanceVersion } from "@/lib/analytics/coach-analysis";
import { Button } from "@/components/ui/button";

const fmtDay = (d: string) => {
  const x = parseLocalDate(d);
  return x ? format(x, "MMM d, yyyy") : d;
};

const selectStyle = "h-10 min-w-0 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground";
const rangeText = (low: number, high: number, unit: Unit) => `${loadNum(low, unit)}–${loadNum(high, unit)} ${unit}`;
const bwText = (kg: number, unit: Unit) => {
  const primary = unit === "kg" ? kg : kg * LB_PER_KG;
  const secondary = unit === "kg" ? kg * LB_PER_KG : kg;
  return `${primary.toFixed(1)} ${unit} / ${secondary.toFixed(1)} ${otherUnit(unit)}`;
};
type View = "current" | "competition" | "gym";
type Metric = "actual" | "estimated";
function classes(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((x): x is string => !!x))].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b) || a.localeCompare(b));
}

export function SbdDonut({
  strength,
  meets,
  results,
  bodyweights,
  sex,
  today,
  unit,
  onRecords,
  periods = [],
  hideBodyweight = false,
}: {
  strength: Record<CompLift, LiftStrength>;
  meets: MeetResult[];
  results: any[];
  bodyweights: readonly BodyweightPoint[];
  sex: "male" | "female" | null;
  today: string;
  unit: Unit;
  onRecords?: () => void;
  periods?: Array<{id: string; name: string; start: string; end: string}>;
  hideBodyweight?: boolean;
}) {
  const [view, setView] = useState<View>("current");
  const [lift, setLift] = useState<CompLift | null>(null);
  const [metric, setMetric] = useState<Metric>("actual");
  const [classPick, setClassPick] = useState<string | null>(null);
  const [meetPick, setMeetPick] = useState("latest");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparePick, setComparePick] = useState("latest");
  const [compareA, setCompareA] = useState("current");
  const [allowMixed, setAllowMixed] = useState(false);
  const [customStart,setCustomStart]=useState("");
  const [customEnd,setCustomEnd]=useState("");
  const scouting = useMemo(() => lifterProfile(meets, sex), [meets, sex]);
  const weights = useMemo(() => normalizeWeights(bodyweights), [bodyweights]);
  const refs = useMemo(() => weightReferences(meets, sex), [meets, sex]);
  const bw = useMemo(() => weightContextAt(weights, refs, today), [weights, refs, today]);
  const timeline = useMemo(() => (historyOpen || compareOpen) ? weightPeriods(weights, refs) : [], [weights, refs, historyOpen, compareOpen]);
  const projection = useMemo(() => currentRing(strength, today, meets, bw.category?.label), [strength, today, meets, bw.category?.label]);
  const gymRecords = useMemo(() => (view === "gym" || compareOpen) ? gymRingRecords(results, strength, weights, refs, today) : [], [view, compareOpen, results, strength, weights, refs, today]);
  const options = view === "competition" ? classes(meets.map(officialClass)) : classes(gymRecords.map((x) => x.classLabel));
  const unknown = view === "competition" ? meets.some((m) => !officialClass(m)) : gymRecords.some((r) => !r.classLabel);
  const defaultClass = view === "gym" && bw.category && options.includes(bw.category.label) ? bw.category.label : "all";
  const classFilter = classPick && (classPick === "all" || classPick === "unknown" || options.includes(classPick)) ? classPick : defaultClass;
  const competition = useMemo(() => competitionRing(meets, classFilter, meetPick), [meets, classFilter, meetPick]);
  const gym = useMemo(() => gymRingBests(gymRecords, metric, classFilter), [gymRecords, metric, classFilter]);
  const lifts: RingLifts = view === "current" ? projection.lifts : view === "competition" ? competition.lifts : gym;
  const total = view === "current" ? projection.totalLb : view === "competition" ? competition.totalLb : ringTotal(gym);
  const low = view === "current" ? projection.lowLb : null;
  const title = view === "current" ? "Projected top end" : view === "competition" ? (meetPick === "individual" ? "Combined lift bests" : "Meet total") : "Combined gym bests";
  const description = view === "current"
    ? total == null ? "A current total needs recent usable training evidence for all three lifts. Past meet results and stale estimates are not substituted." : "Same-day conservative and optimistic scenarios from the shared strength engine. The top end assumes favourable execution across all three lifts; it is not a guaranteed total."
    : view === "competition" && meetPick !== "individual"
      ? "The successful lifts recorded at the selected meet."
      : "Individual bests may have been achieved on different dates. Their sum is not an official or demonstrated single-session total.";
  const changeView = (v: View) => { setView(v); setLift(null); setClassPick(null); setMeetPick("latest"); setMetric("actual"); };
  const size = 208;
  const radius = 87;
  const sum = ringTotal(lifts);
  const selectedKind = view === "current" ? "projected" : view === "competition" && meetPick !== "individual" ? "official" : view === "gym" && metric === "estimated" ? "estimated" : "actual";
  const selectedVersion: PerformanceVersion = {key:"selected",label:title,kind:selectedKind,lifts,totalLb:total,end:view==="current"?today:competition.meet?.date,bodyweightKg:view==="current"?bw.averageKg: view==="competition"&&competition.meet?.bodyweightLb?competition.meet.bodyweightLb/LB_PER_KG:null,category:view==="current"?bw.category?.label:classFilter==="all"?null:classFilter};
  const comparePeriods=[...timeline.map(p=>({id:"weight:"+p.start,name:p.category,start:p.start,end:p.end})),...periods,...(customStart&&customEnd&&customEnd>=customStart&&customEnd<=today?[{id:"custom",name:"Custom period",start:customStart,end:customEnd}]:[])];
  const historicalProjections=useMemo<PerformanceVersion[]>(()=>{if(!compareOpen)return [];const options=comparePeriods.filter(p=>p.end<today).sort((a,b)=>a.id==='custom'?-1:b.id==='custom'?1:b.end.localeCompare(a.end)).slice(0,8);return options.map(p=>{const historicalMeets=meets.filter(m=>m.date<=p.end);const context=weightContextAt(weights,refs,p.end);const read=liftStrengths(results,historicalMeets,p.end);const projection=currentRing(read,p.end,historicalMeets,context.category?.label);return {key:p.id+":projection",label:p.name+" · projection on "+p.end,kind:"projected" as const,lifts:projection.lifts,totalLb:projection.totalLb,end:p.end,bodyweightKg:context.averageKg,category:context.category?.label}}).filter(v=>v.totalLb!=null);},[compareOpen,results,meets,weights,refs,today,periods,timeline,customStart,customEnd]);
  const compareChoices: PerformanceVersion[] = compareOpen ? ([
    selectedVersion,
    {key:"current",label:"Current projection",kind:"projected" as const,lifts:projection.lifts,totalLb:projection.totalLb,end:today,bodyweightKg:bw.averageKg,category:bw.category?.label},
    ...meets.filter(m=>!m.event||m.event.toUpperCase()==="SBD").map(m=>({key:"meet:"+ (m.id??m.date+":"+m.name),label:(m.name??"Competition")+" · "+m.date,kind:"official" as const,lifts:competitionRing([m],"all","latest").lifts,totalLb:m.total,start:m.date,end:m.date,bodyweightKg:m.bodyweightLb?m.bodyweightLb/LB_PER_KG:null,category:officialClass(m)})),
    ...["all", ...classes(gymRecords.map(r=>r.classLabel))].flatMap(category=>(["actual","estimated"] as const).map(kind=>{
      const ls=gymRingBests(gymRecords,kind,category);
      return {key:"gym:"+category+":"+kind,label:(category==="all"?"All-time":category)+" · "+(kind==="actual"?"gym singles":"gym e1RM"),kind,lifts:ls,totalLb:ringTotal(ls),category};
    })),
    ...historicalProjections,
    ...comparePeriods.flatMap(p=>(["actual","estimated"] as const).map(kind=>{
      const ls=gymRingBests(gymRecords.filter(r=>r.day>=p.start&&r.day<=p.end),kind,"all");
      return {key:p.id+":"+kind,label:p.name+" · "+p.start+" – "+p.end+" · "+(kind==="actual"?"singles":"e1RM"),kind,lifts:ls,totalLb:ringTotal(ls),start:p.start,end:p.end};
    })),
  ] as PerformanceVersion[]).filter(v=>COMP_LIFTS.some(l=>v.lifts[l]&&!v.lifts[l]?.stale)||v.key==="selected"||v.key==="current") : [];
  const versionA=compareChoices.find(c=>c.key===compareA)??compareChoices[0];
  const compatible=compareChoices.filter(c=>c.key!==versionA?.key&&!(c.kind==="projected"&&versionA?.kind==="projected"&&((c.key==="selected"&&versionA.key==="current")||(c.key==="current"&&versionA.key==="selected")))&&(allowMixed||c.kind===versionA?.kind));
  const comparison=compatible.find(c=>c.key===comparePick)??compatible[0];
  const insights=versionA&&comparison?compareInsights(versionA,comparison):[];
  const delta = (a: number, b: number) => (a >= b ? "+" : "−") + dualLoad(Math.abs(a-b),unit).main;
  let at = 0;

  return (
    <div className="@container space-y-3" data-sbd-donut data-sbd-kind={view}>
      {!hideBodyweight && <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">Current bodyweight</div>
          <div className="text-sm font-semibold tabular-nums">{bw.latest ? bwText(bw.latest.kg, unit) : "Not logged"}</div>
          {bw.latest && <div className="text-[11px] text-muted-foreground">{fmtDay(bw.latest.day)}</div>}
        </div>
        <button type="button" onClick={() => setHistoryOpen(true)} className="min-h-11 shrink-0 text-right" aria-label="Open weight history">
          <span className="block text-[11px] text-muted-foreground">Closest weight class</span>
          <span className="block text-sm font-semibold">{bw.category?.label ?? "—"}</span>
          <span className="block text-[11px] text-muted-foreground">Weight history ›</span>
        </button>
      </div>}
      <Segmented<View> value={view} onChange={changeView} options={[{ key: "current", label: "Current" }, { key: "competition", label: "Competition" }, { key: "gym", label: "Gym PRs" }]} label="Performance view" size="sm" />
      {view !== "current" && (
        <div className="flex items-center gap-2">
          {(options.length > 0 || unknown) && <select aria-label="Weight class" value={classFilter} className={cn(selectStyle, "flex-1")} onChange={(e) => { setClassPick(e.target.value); setMeetPick("latest"); setLift(null); }}>
            <option value="all">All classes</option>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
            {unknown && <option value="unknown">Unclassified</option>}
          </select>}
          {view === "competition" ? (
            <select aria-label="Competition selection" value={meetPick} className={cn(selectStyle, "flex-[2]")} onChange={(e) => { setMeetPick(e.target.value); setLift(null); }}>
              <option value="latest">Latest meet</option>
              <option value="best">Best total</option>
              <option value="individual">Lift bests</option>
              {competition.options.map((m) => <option value={m.id} key={m.id}>{m.label}</option>)}
            </select>
          ) : <Segmented<Metric> className="flex-1" value={metric} onChange={(v) => { setMetric(v); setLift(null); }} options={[{ key: "actual", label: "1RM" }, { key: "estimated", label: "e1RM" }]} label="Actual or estimated max" size="sm" />}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 @[520px]:flex-row @[520px]:gap-5">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={total == null ? "Total unavailable" : `${title}: ${dualLoad(total, unit).main}`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--muted)" strokeWidth={20} />
            {total != null && sum != null && COMP_LIFTS.map((l) => {
              const sweep = (lifts[l]!.lb / sum) * 360;
              const start = at + Math.min(1.5, sweep / 4);
              at += sweep;
              const end = at - Math.min(1.5, sweep / 4);
              return <path key={l} d={arcPath(size / 2, size / 2, radius, start, end)} fill="none" stroke={LIFT_SERIES[l]} strokeWidth={lift === l ? 26 : 20} opacity={lift == null || lift === l ? 1 : 0.28} className="cursor-pointer transition-all duration-300 motion-reduce:transition-none" onClick={() => setLift(lift === l ? null : l)} data-donut-seg={l} />;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
            <span className="text-[29px] font-semibold leading-tight tabular-nums tracking-tight">{total == null ? "—" : loadNum(total, unit)}{total != null && <span className="ml-0.5 text-xs font-medium text-muted-foreground">{unit}</span>}</span>
            {total != null && <span className="text-xs tabular-nums text-muted-foreground">{dualLoad(total, unit).other}</span>}
            {total != null && low != null && <>
              <span className="mt-1 text-[11px] tabular-nums">{rangeText(low, total, unit)}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{rangeText(low, total, otherUnit(unit))}</span>
            </>}
            {total == null && <span className="text-[11px] text-muted-foreground">Insufficient data</span>}
          </div>
        </div>
        <ul className="w-full min-w-0 space-y-0.5" aria-label="Lifts">
          {COMP_LIFTS.map((l) => {
            const row = lifts[l];
            return <li key={l} className={cn("flex items-center gap-1 rounded-lg", lift === l && "bg-muted/60")}>
              <button type="button" onClick={() => setLift(lift === l ? null : l)} aria-pressed={lift === l} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-muted/40" data-donut-lift={l}>
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: LIFT_SERIES[l] }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{COMP_LIFT_LABEL[l]}</span>
                  {row && row.lowLb != null ? <span className="block text-[10px] text-muted-foreground">{rangeText(row.lowLb, row.lb, unit)} · {rangeText(row.lowLb, row.lb, otherUnit(unit))}</span> : row && <span className="block text-[10px] text-muted-foreground">{row.stale ? "Last known · " : row.classLabel ? row.classLabel + " · " : ""}{fmtDay(row.day)}</span>}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="block text-sm font-semibold">{row ? dualLoad(row.lb, unit).main : "—"}</span>
                  {row && <span className="block text-[11px] text-muted-foreground">{dualLoad(row.lb, unit).other}</span>}
                </span>
              </button>
              <InfoTip label={`About ${COMP_LIFT_LABEL[l].toLowerCase()}`} title={COMP_LIFT_LABEL[l]} className="mr-0.5">
                <p>{row?.detail ?? "No qualifying record for this view."}</p>
                {row?.bodyweightKg != null && <p>{bwText(row.bodyweightKg, unit)} bodyweight{row.classLabel ? ` · ${row.classLabel}` : ""}.</p>}
              </InfoTip>
            </li>;
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{view === "current" ? (total == null ? "Recent evidence needed" : `${projection.confidence} confidence · ${fmtDay(today)}`) : competition.meet && view === "competition" ? `${competition.meet.name ?? "Competition"} · ${fmtDay(competition.meet.date)}` : "Individual bests · different dates possible"}</span>
        <InfoTip label="About this total">{description}</InfoTip>
        {view === "gym" && onRecords && <button type="button" className="min-h-10 shrink-0 font-medium text-foreground" onClick={onRecords}>Records ›</button>}
      </div>

      {view==="current" && <div className="border-t border-border pt-3 space-y-1" data-lifter-identity>
        <div className="flex items-center justify-between"><strong className="text-sm">{scouting.identity}</strong><InfoTip label="About lifter identity">{scouting.evidence}</InfoTip></div>
        <p className="text-xs"><span className="font-medium">Weapon: </span>{scouting.weapon}</p>
        <p className="text-xs"><span className="font-medium">Vulnerability: </span>{scouting.vulnerability}</p>
        <details className="text-xs text-muted-foreground"><summary className="min-h-9 pt-2 cursor-pointer">Game-day strategy</summary>{scouting.strategy}</details>
      </div>}
      <button type="button" className="min-h-10 w-full rounded-lg border border-border text-xs font-medium" onClick={()=>{setCompareA("selected");setCompareOpen(true)}}>Compare performance</button>
      <Sheet open={compareOpen} onOpenChange={setCompareOpen}>
        <SheetContent side="bottom" swipeToClose className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-5 pb-6">
          <SheetTitle>Compare performance</SheetTitle>
          <SheetDescription>Choose two versions. Gym bests may come from different sessions.</SheetDescription>
          <label className="text-xs text-muted-foreground">Version A<select className={selectStyle+" block w-full mt-1"} value={versionA?.key??""} onChange={e=>setCompareA(e.target.value)}>{compareChoices.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <details className="text-xs"><summary className="min-h-9 cursor-pointer pt-2">Custom comparison period</summary><div className="grid grid-cols-2 gap-2"><label>From<input type="date" className={selectStyle+" block w-full"} value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label><label>To<input type="date" max={today} className={selectStyle+" block w-full"} value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label></div></details>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={allowMixed} onChange={e=>setAllowMixed(e.target.checked)}/> Allow different evidence types (e.g. projected vs achieved)</label>
          <label className="text-xs text-muted-foreground">Version B<select className={selectStyle+" block w-full mt-1"} value={comparison?.key??""} onChange={e=>setComparePick(e.target.value)}>{!compatible.length&&<option value="">No comparable version</option>}{compatible.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          {versionA && comparison ? <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">{[versionA,comparison].map((v,i)=><div key={i}><div className="text-muted-foreground">{i===0?"A":"B"} · {v.kind}</div><strong className="text-lg">{v.totalLb==null?"—":dualLoad(v.totalLb,unit).main}</strong>{v.totalLb!=null&&<div>{dualLoad(v.totalLb,unit).other}</div>}<div className="text-muted-foreground">{v.category??""} {v.bodyweightKg?bwText(v.bodyweightKg,unit):""}</div>{v.end&&<div className="text-muted-foreground">{v.start&&v.start!==v.end?v.start+" – ":""}{v.end}</div>}</div>)}</div>
            {COMP_LIFTS.map(l=>{
              const a=versionA.lifts[l],b=comparison.lifts[l],av=a&&!a.stale?a.lb:null,bv=b&&!b.stale?b.lb:null,max=Math.max(av??0,bv??0,1);
              return <div key={l} className="space-y-1"><div className="flex justify-between text-sm"><span>{COMP_LIFT_LABEL[l]}</span><span>{av==null||bv==null?"—":delta(av,bv)+" · "+((av-bv)/bv*100).toFixed(1)+"%"}</span></div>{[a,b].map((v,i)=><div key={i}><div className="flex items-center gap-2"><div className="flex-1 rounded-full bg-muted"><div className="h-2 rounded-full" style={{background:i?"#71717a":LIFT_SERIES[l],width:(v&&!v.stale?v.lb:0)/max*100+"%"}}/></div><span className="text-right text-xs">{!v||v.stale?"—":dualLoad(v.lb,unit).main+" · "+dualLoad(v.lb,unit).other}</span></div>{v&&<div className="text-[10px] text-muted-foreground">{fmtDay(v.day)} {v.classLabel??""}</div>}</div>)}</div>;
            })}
            {insights.length>0&&<div className="border-t border-border pt-3 space-y-2"><strong className="text-sm">Coach’s analysis</strong>{insights.map(i=><div key={i.label} className="text-xs"><strong>{i.label}: </strong>{i.text}</div>)}</div>}
          </div>:<p className="text-xs text-muted-foreground">Choose another version or explicitly enable mixed evidence.</p>}
          <Button variant="outline" onClick={()=>setCompareOpen(false)}>Done</Button>
        </SheetContent>
      </Sheet>
      <Sheet open={historyOpen && !hideBodyweight} onOpenChange={setHistoryOpen}>
        <SheetContent side="bottom" swipeToClose className="max-h-[82dvh] overflow-y-auto rounded-t-2xl px-5 pb-6">
          <SheetTitle>Weight history</SheetTitle>
          <SheetDescription>Training categories use a seven-day average and the nearest known class reference; they are not official competition eligibility.</SheetDescription>
          {timeline.length ? <ul className="divide-y divide-border">{timeline.map((p) => <li key={p.start + p.category} className="flex items-center justify-between gap-2 py-3">
            <div><div className="text-sm font-semibold">{p.category}</div><div className="text-xs text-muted-foreground">{fmtDay(p.start)} – {fmtDay(p.end)}</div></div>
            <div className="text-right text-xs tabular-nums">{bwText(p.averageKg, unit)}<div className="text-muted-foreground">{bwText(p.lowKg,unit)} – {bwText(p.highKg,unit)}</div><div className="text-muted-foreground">{p.samples} weigh-ins · {Math.round((Date.parse(p.end)-Date.parse(p.start))/86400000)+1} days</div></div>
          </li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">Not enough dated weigh-ins or known weight classes to build a timeline.</p>}
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>Done</Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
