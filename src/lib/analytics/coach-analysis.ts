import { COMP_LIFTS, COMP_LIFT_LABEL, type CompLift, type MeetResult } from "./competition-strength";
import { TYPICAL_SHARE } from "./sbd-split";
import { type RingLifts, ringTotal, officialClass } from "./performance-ring";
import { LB_PER_KG } from "./units";

export type PerformanceVersion = { key: string; label: string; kind: "projected" | "official" | "actual" | "estimated"; lifts: RingLifts; totalLb: number | null; start?: string; end?: string; bodyweightKg?: number | null; category?: string | null };
export type CoachInsight = { label: string; text: string };
const kg = (lb: number) => (lb / LB_PER_KG).toFixed(1);
const change = (a: number, b: number) => `${a >= b ? "+" : "−"}${kg(Math.abs(a-b))} kg / ${Math.round(Math.abs(a-b))} lb`;
const pct = (a: number, b: number) => b > 0 ? (a-b)/b*100 : null;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
export function compareInsights(a: PerformanceVersion, b: PerformanceVersion): CoachInsight[] {
  const rows = COMP_LIFTS.flatMap(l => {
    const x=a.lifts[l], y=b.lifts[l];
    return x && y && !x.stale && !y.stale && y.lb > 0 ? [{lift:l,delta:x.lb-y.lb,pct:pct(x.lb,y.lb)!}] : [];
  });
  const insights: CoachInsight[] = [];
  const same = a.kind === b.kind;
  const best = [...rows].sort((x,y)=>y.delta-x.delta)[0];
  const worst = [...rows].sort((x,y)=>x.delta-y.delta)[0];
  if (best && best.delta > 1) insights.push({label:same?"Largest gain":"Largest numerical advantage",text:`${COMP_LIFT_LABEL[best.lift]} accounts for the biggest positive difference (${change(best.delta,0)}; ${signed(best.pct)}).`});
  if (worst && worst.delta < -1) insights.push({label:same?"Limiting lift":"Potential gap",text:`${COMP_LIFT_LABEL[worst.lift]} is ${kg(-worst.delta)} kg / ${Math.round(-worst.delta)} lb lower in A; review specificity and comparable evidence before changing programming.`});
  if (a.bodyweightKg && b.bodyweightKg && a.totalLb && b.totalLb && (a.kind==="official" || a.kind==="projected") && (b.kind==="official" || b.kind==="projected")) {
    const ar=a.totalLb/LB_PER_KG/a.bodyweightKg, br=b.totalLb/LB_PER_KG/b.bodyweightKg;
    insights.push({label:"Bodyweight efficiency",text:`A: ${ar.toFixed(2)}× bodyweight; B: ${br.toFixed(2)}×. ${ar>br?"A has the higher ratio.":ar<br?"B has the higher ratio.":"The ratios are equal at this precision."} This is not a weight-class ranking.`});
  } else if (rows.length===3 && !insights.length) insights.push({label:"Stable profile",text:"No meaningful lift difference in this comparison."});
  if (!same) insights.unshift({label:"Evidence types differ",text:"Estimated potential and achieved performances are not interchangeable; the difference is not proof of improvement or game-day readiness."});
  return insights.slice(0,3);
}

type DetailedMeet = MeetResult & {equipment?: string|null; attempts?: {s?: Array<number|null>;b?: Array<number|null>;d?: Array<number|null>}|null};
const keys: Record<CompLift,"s"|"b"|"d">={squat:"s",bench:"b",deadlift:"d"};
export function attemptStats(meets: readonly DetailedMeet[], lift: CompLift) {
  const lists=meets.map(m=>m.attempts?.[keys[lift]]??[]);
  const recorded=lists.flat().filter((n): n is number=>typeof n==="number"&&Number.isFinite(n)&&n!==0);
  const thirds=lists.map(x=>x[2]).filter((n): n is number=>typeof n==="number"&&Number.isFinite(n)&&n!==0);
  return {attempts:recorded.length,success:recorded.filter(n=>n>0).length,thirds:thirds.length,thirdSuccess:thirds.filter(n=>n>0).length};
}
export function lifterProfile(meets: readonly DetailedMeet[], sex: "male"|"female"|null) {
  const raw=meets.filter(m=>/^(raw|classic)$/i.test(m.equipment??"")&&m.total>0&&COMP_LIFTS.every(l=>m.lifts[l]>0)&&(!m.event||m.event.toUpperCase()==="SBD"));
  const recent=[...raw].sort((a,b)=>b.date.localeCompare(a.date));
  const latest=recent[0];
  const comparable=latest?recent.filter(m=>officialClass(m)===officialClass(latest)&&m.federation===latest.federation).slice(0,5):[];
  const stats=COMP_LIFTS.map(l=>({lift:l,...attemptStats(comparable,l)}));
  const proven=stats.filter(x=>x.attempts>=6).sort((a,b)=>b.success/b.attempts-a.success/a.attempts);
  const reliable=proven[0], weakest=proven[proven.length-1];
  const distinct=proven.length>=2&&reliable.success/reliable.attempts-weakest.success/weakest.attempts>=0.15;
  const benchmark=TYPICAL_SHARE[sex??"any"];
  const lean=COMP_LIFTS.find(l=>comparable.length>=2&&comparable.every(m=>m.lifts[l]/m.total>benchmark[l][1]));
  return {
    identity: lean ? `${COMP_LIFT_LABEL[lean]}-leaning profile` : comparable.length>=2?"Competition profile":"Profile developing",
    weapon:distinct?`${COMP_LIFT_LABEL[reliable.lift]}: ${reliable.success}/${reliable.attempts} successful attempts.`:"No distinct competitive advantage established.",
    vulnerability:distinct?`${COMP_LIFT_LABEL[weakest.lift]}: ${weakest.attempts-weakest.success} missed of ${weakest.attempts} recorded attempts.`:"No reliable limiting lift established.",
    strategy:distinct?`Prioritize a reliable ${COMP_LIFT_LABEL[weakest.lift].toLowerCase()} subtotal; adjust later attempts to readiness and standings.`:"Use recent competition-specific training and attempt history to select attempts.",
    evidence:comparable.length? `Based on ${comparable.length} comparable raw meet(s)${latest&&officialClass(latest)? " in "+officialClass(latest):""}. Share ranges describe lift distribution, not competitive ranking. Attempt insights require at least six recorded attempts per compared lift.`:"Insufficient comparable raw competition history. A specialist label needs more than contribution to total.",
  };
}
