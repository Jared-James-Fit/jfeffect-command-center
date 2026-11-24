import { describe,it,expect } from "vitest";
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { calibratedSetMean,setupQuality } from "@/lib/lift-analysis/quality";
import { velocityVerdict } from "@/lib/lift-analysis/verdict";
import { analysableExercise, olympicExercise, repDirection } from "@/lib/lift-analysis/exercise";

function screenshotRead(confirmed=true):LiftAnalysis {
  const base=analyzeTrack(Array.from({length:300},(_,i)=>({t:i/30,x:140,y:160+49*(1-Math.cos(Math.max(0,Math.min(1,(i/30-1)/4))*Math.PI*4)),r:40,a:40,b:40,conf:1,found:true})),{plate:{mm:450,rel:0.01,confirmed:true},source:"tap",seed:{x:140,y:160,r:40,t:0},frame:{w:270,h:480},dirHint:"lower_first"});
  const rep=base.reps[0];if(!rep)throw new Error("Fixture must contain reps");
  return {...base,plate:{...base.plate,confirmed,view:"turned",ratio:0.783},calibration:{...base.calibration,relErr:0.0814},reps:[0.4303838228,0.42707726,0.42417017,0.40935681].map(v=>({...rep,complete:true,mcv:{v,u:0.0724,tier:"estimated"}}))};
}
describe("screenshot set 3",()=>{
  it("does not turn an assumed 450 mm diameter into speed",()=>expect(calibratedSetMean(screenshotRead(false))).toBeNull());
  it("logs the arithmetic set mean after confirmation, not the fastest rep",()=>{
    const read=calibratedSetMean(screenshotRead());
    expect(read?.value).toBe(0.423);expect(read?.tier).toBe("estimated");
    expect(read?.uncertainty).toBeGreaterThan(0.068);
    expect(velocityVerdict(screenshotRead()).value).toBe(0.423);
  });
  it("keeps a partial set out",()=>{const a=screenshotRead();const r=a.reps[0];if(!r)throw new Error("Fixture missing rep");expect(calibratedSetMean({...a,reps:[{...r,complete:false},...a.reps.slice(1)]})).toBeNull();});
  it("keeps unreliable scale out",()=>{const a=screenshotRead();expect(calibratedSetMean({...a,calibration:{...a.calibration,relErr:0.2}})).toBeNull();});
  it("keeps pixel paths and real timestamps when diameter is unknown",()=>{const a=analyzeTrack(Array.from({length:300},(_,i)=>({t:i/30,x:140,y:160+49*(1-Math.cos(Math.max(0,Math.min(1,(i/30-1)/4))*Math.PI*4)),r:40,a:40,b:40,conf:1,found:true})),{source:"auto",seed:{x:140,y:160,r:40,t:0},frame:{w:270,h:480}});expect(a.units).toBe("px");expect(a.velocity.value).toBeNull();expect(a.series.t[30]).toBe(1);expect(a.reps).toHaveLength(2);});
  it("quality is bounded and calibration is a separate part",()=>{expect(setupQuality(screenshotRead(false)).parts[0]?.points).toBe(0);expect(setupQuality(screenshotRead()).score).toBeGreaterThan(0);expect(setupQuality(screenshotRead()).score).toBeLessThanOrEqual(100);});
});
describe("exercise identity boundaries",()=>{
  it("leaves unknown and irrelevant exercises out",()=>{expect(analysableExercise("Stretch" )).toBe(false);expect(analysableExercise("Cable Row")).toBe(false);expect(analysableExercise("Barbell Row")).toBe(true);});
  it("marks Olympic phases separately instead of claiming squat rep semantics",()=>{expect(olympicExercise("Clean and Jerk")).toBe(true);expect(olympicExercise("Competition Squat")).toBe(false);});
  it("distinguishes RDL lowering from deadlift pulling",()=>{expect(repDirection("Romanian Deadlift")).toBe("lower_first");expect(repDirection("Competition Deadlift")).toBe("lift_first");});
});