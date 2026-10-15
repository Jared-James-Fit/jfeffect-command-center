import { useId, type ReactNode } from "react";
import type { LessonLift, LessonVisual } from "@/lib/lessons";

/**
 * The diagrams under a coach lesson, drawn in code: crisp at any size, the
 * app's own dark card and red, nothing generated or uploaded. Where a shape
 * is a model rather than data it says so ("illustration"). The body
 * positions (squat, deadlift start, bench) are worked out from segment
 * lengths and angles with the bar kept over midfoot, so what's drawn is a
 * position a lifter could actually be in, not a sketch.
 */

const INK = "rgba(255,255,255,0.92)";
const SOFT = "rgba(255,255,255,0.62)";
const MUTED = "rgba(255,255,255,0.42)";
const GRID = "rgba(255,255,255,0.10)";
const RED = "#ff5a64";
const GOLD = "#fcd34d";
const W = 320;
const H = 200;

type Pt = { x: number; y: number };

export function LessonVisualArt({ visual, className }: { visual: LessonVisual; className?: string }) {
  const art = (() => {
    switch (visual.kind) {
      case "bar_path":
        return <BarPath lift={visual.lift ?? "squat"} fault={visual.fault ?? "none"} />;
      case "squat_torso":
        return <SquatTorso />;
      case "deadlift_start":
        return <DeadliftStart fault={visual.fault ?? "hips_low"} />;
      case "bench_touch":
        return <BenchTouch />;
      case "sticking_point":
        return <StickingPoint lift={visual.lift ?? "bench"} />;
      case "strength_curve":
        return <StrengthCurve shape={visual.shape ?? "ascending"} />;
      case "length_tension":
        return <LengthTension />;
      case "force_velocity":
        return <ForceVelocity />;
      case "fitness_fatigue":
        return <FitnessFatigue />;
      case "sra":
        return <Sra />;
      case "rpe_rir":
        return <RpeRir />;
      case "dose_response":
        return <DoseResponse />;
      case "velocity_loss":
        return <VelocityLoss />;
      default:
        return null;
    }
  })();
  if (!art) return null;
  return (
    <div className={className} data-lesson-visual={visual.kind}>
      {art}
    </div>
  );
}

/** What a diagram shows, for screen readers and the alt text. */
export function visualLabel(v: LessonVisual): string {
  const lift = v.lift ? `${v.lift} ` : "";
  switch (v.kind) {
    case "bar_path":
      return `Side view of the ${lift}bar path${v.fault && v.fault !== "none" ? ", ideal versus drifting" : ""}`;
    case "squat_torso":
      return "Two squat bottoms, more upright versus more lean, with hip and knee moment arms";
    case "deadlift_start":
      return "Deadlift start position: bar over midfoot versus the fault";
    case "bench_touch":
      return "Bench from the side: forearm stacked under the bar versus tilted";
    case "sticking_point":
      return `Bar speed through the ${lift}rep, with the sticking region marked`;
    case "strength_curve":
      return "How much force you can produce across the range of motion";
    case "length_tension":
      return "Muscle force across muscle length";
    case "force_velocity":
      return "Force velocity curve: heavy is slow, power peaks in the middle";
    case "fitness_fatigue":
      return "Fitness, fatigue and performance through a training block and taper";
    case "sra":
      return "Stimulus, recovery, adaptation";
    case "rpe_rir":
      return "RPE and reps in reserve";
    case "dose_response":
      return "More weekly sets, more growth, with diminishing returns";
    case "velocity_loss":
      return "Rep speed falling across a set";
  }
}

/* ---- frame ------------------------------------------------------------ */

function Frame({ label, children, note, noteAt = "bottom" }: { label: string; children: ReactNode; note?: string; noteAt?: "top" | "bottom" }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
      {children}
      {note && (
        <text x={W - 8} y={noteAt === "top" ? 12 : H - 5} textAnchor="end" fontSize="8.5" fontWeight={700} letterSpacing="0.08em" fill={MUTED}>
          {note}
        </text>
      )}
    </svg>
  );
}

function Label({ x, y, children, anchor = "start", color = SOFT, size = 9.5, weight = 800 }: {
  x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; color?: string; size?: number; weight?: number;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} letterSpacing="0.06em" fill={color}>
      {children}
    </text>
  );
}

/** The key, top left, one line each (they never run into each other). */
function Legend({ items, x = 12, y = 15 }: { items: { label: string; color: string; dash?: boolean }[]; x?: number; y?: number }) {
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.label}>
          <line x1={x} y1={y + i * 13 - 3} x2={x + 18} y2={y + i * 13 - 3} stroke={it.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={it.dash ? "4 3" : undefined} />
          <Label x={x + 24} y={y + i * 13} color={SOFT} size={9}>{it.label}</Label>
        </g>
      ))}
    </g>
  );
}

/** A chart's axes: y up the left, x along the bottom, with their names. */
function Axes({ x0, y0, x1, y1, xLabel, yLabel }: { x0: number; y0: number; x1: number; y1: number; xLabel: string; yLabel: string }) {
  return (
    <g>
      <line x1={x0} y1={y0} x2={x0} y2={y1} stroke={MUTED} strokeWidth={1.2} />
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke={MUTED} strokeWidth={1.2} />
      <Label x={x1} y={y0 + 14} anchor="end" color={MUTED}>{xLabel}</Label>
      <text x={x0 - 6} y={y1} transform={`rotate(-90 ${x0 - 6} ${y1})`} textAnchor="end" fontSize={9.5} fontWeight={800} letterSpacing="0.06em" fill={MUTED}>
        {yLabel}
      </text>
    </g>
  );
}

function path(points: Pt[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** A function sampled across a chart's box: f(t) for t in 0..1 → 0..1 (up). */
function plot(f: (t: number) => number, box: { x0: number; y0: number; w: number; h: number }, n = 60): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: box.x0 + t * box.w, y: box.y0 - Math.max(0, Math.min(1.05, f(t))) * box.h };
  });
}

/* ---- bodies ----------------------------------------------------------- */

const deg = (d: number) => (d * Math.PI) / 180;

/** Where two circles meet (the one with the smaller x, i.e. behind). */
function circleMeet(a: Pt, ra: number, b: Pt, rb: number, pick: "back" | "front" = "back"): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) return null;
  const l = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - l * l));
  const mx = a.x + (dx * l) / d;
  const my = a.y + (dy * l) / d;
  const p1 = { x: mx + (dy * h) / d, y: my - (dx * h) / d };
  const p2 = { x: mx - (dy * h) / d, y: my + (dx * h) / d };
  return (pick === "back" ? p1.x < p2.x : p1.x > p2.x) ? p1 : p2;
}

/** Model space (metres-ish, y up) → the panel's pixels. */
function toPx(p: Pt, o: { x: number; y: number; s: number }): Pt {
  return { x: o.x + p.x * o.s, y: o.y - p.y * o.s };
}

function Foot({ heel, toe, y }: { heel: number; toe: number; y: number }) {
  return <path d={`M${heel} ${y} L${toe} ${y} L${toe - 6} ${y - 7} L${heel + 4} ${y - 9} Z`} fill="rgba(255,255,255,0.22)" />;
}

function Body({ pts, color = INK, head }: { pts: Pt[]; color?: string; head?: { from: Pt; to: Pt; r: number } }) {
  // the head sits on past the shoulder, along the line of the torso
  const h = head ? (() => {
    const dx = head.to.x - head.from.x;
    const dy = head.to.y - head.from.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: head.to.x + (dx / d) * head.r * 2.3, y: head.to.y + (dy / d) * head.r * 2.3 };
  })() : null;
  return (
    <g>
      {h && <circle cx={h.x} cy={h.y} r={head!.r} fill="#0a0a0d" stroke={color} strokeWidth={3} />}
      <path d={path(pts)} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.slice(1, -1).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.4} fill="#0a0a0d" stroke={color} strokeWidth={2} />
      ))}
    </g>
  );
}

function Plate({ at, r = 14, color = INK }: { at: Pt; r?: number; color?: string }) {
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={r} fill="rgba(255,255,255,0.08)" stroke={color} strokeWidth={2} />
      <circle cx={at.x} cy={at.y} r={2.6} fill={color} />
    </g>
  );
}

/* ---- bar path ----------------------------------------------------------- */

function BarPath({ lift, fault }: { lift: LessonLift; fault: string }) {
  const showFault = fault === "forward" || fault === "loop";
  if (lift === "bench") return <BenchPath showFault={showFault} />;
  const floor = 170;
  const mid = 160;
  const top = 46;
  const bottom = lift === "deadlift" ? floor - 16 : 122;
  const start = lift === "deadlift" ? bottom : top;
  const end = lift === "deadlift" ? 70 : bottom;
  // the ideal: straight up and down over midfoot (a squat travels down then up the same line)
  const ideal = lift === "deadlift" ? [{ x: mid, y: start }, { x: mid, y: end }] : [{ x: mid, y: top }, { x: mid, y: bottom }];
  const span = Math.abs(end - start);
  const drift = (t: number) => (fault === "loop" ? Math.sin(t * Math.PI) * 26 * (1 - t * 0.35) : Math.sin(t * Math.PI * 0.85) * 30);
  const faultPts = Array.from({ length: 31 }, (_, i) => {
    const t = i / 30;
    // the way up: from the bottom (squat) / the floor (deadlift) to the top
    const y = lift === "deadlift" ? start - t * span : bottom - t * (bottom - top);
    return { x: mid + drift(t), y };
  });
  return (
    <Frame label={visualLabel({ kind: "bar_path", lift, fault })} note="SIDE VIEW · ILLUSTRATION" noteAt="top">
      <Legend items={[{ label: "BAR OVER MIDFOOT", color: INK }, ...(showFault ? [{ label: "DRIFTING FORWARD", color: RED, dash: true }] : [])]} y={30} />
      <line x1={20} y1={floor} x2={300} y2={floor} stroke={MUTED} strokeWidth={1.5} />
      <Foot heel={mid - 34} toe={mid + 40} y={floor} />
      <line x1={mid} y1={floor + 2} x2={mid} y2={top - 10} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
      <Label x={mid} y={floor + 14} anchor="middle" color={MUTED}>MIDFOOT</Label>
      <Label x={mid + 44} y={floor + 14} anchor="start" color={MUTED}>TOES →</Label>
      <path d={path(ideal)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      {showFault && <path d={path(faultPts)} fill="none" stroke={RED} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 5" />}
      <Plate at={{ x: mid, y: lift === "deadlift" ? start : top }} r={lift === "deadlift" ? 16 : 12} />
      <Label x={mid - 26} y={lift === "deadlift" ? end + 4 : bottom + 4} anchor="end" color={SOFT}>{lift === "deadlift" ? "LOCKOUT" : "DEPTH"}</Label>
      {showFault && (
        <Label x={mid + 44} y={(start + end) / 2 + (lift === "deadlift" ? 0 : 0)} color={RED}>
          {fault === "loop" ? "OUT & BACK" : "LONGER LEVER"}
        </Label>
      )}
    </Frame>
  );
}

function BenchPath({ showFault }: { showFault: boolean }) {
  // the lifter lies along the bench, head on the left; the bar starts over the shoulder
  const bench = 160;
  const shoulder = { x: 92, y: bench - 18 };
  const touch = { x: 168, y: bench - 30 };
  const lock = { x: shoulder.x + 4, y: 56 };
  // the J: off the chest it moves up and back toward the shoulder, then straight up
  const j = Array.from({ length: 31 }, (_, i) => {
    const t = i / 30;
    const back = 1 - Math.pow(1 - Math.min(1, t * 1.6), 2);
    return { x: touch.x + (lock.x - touch.x) * back, y: touch.y + (lock.y - touch.y) * t };
  });
  const straight = Array.from({ length: 31 }, (_, i) => {
    const t = i / 30;
    return { x: touch.x + 10 * Math.sin(t * Math.PI * 0.6), y: touch.y + (lock.y + 4 - touch.y) * t };
  });
  return (
    <Frame label={visualLabel({ kind: "bar_path", lift: "bench", fault: showFault ? "forward" : "none" })} note="SIDE VIEW · ILLUSTRATION" noteAt="top">
      <Legend items={[{ label: "OFF THE CHEST, BACK OVER THE SHOULDER", color: INK }, ...(showFault ? [{ label: "DRIFTING TOWARD THE FEET", color: RED, dash: true }] : [])]} y={30} />
      {/* bench and a lying torso */}
      <rect x={30} y={bench} width={250} height={8} rx={3} fill="rgba(255,255,255,0.16)" />
      <path d={`M34 ${bench - 2} Q52 ${bench - 30} 92 ${bench - 22} Q150 ${bench - 42} 210 ${bench - 22} L262 ${bench - 12} L262 ${bench - 2} Z`} fill="rgba(255,255,255,0.10)" />
      <circle cx={shoulder.x} cy={shoulder.y} r={4} fill={SOFT} />
      <Label x={shoulder.x} y={bench + 22} anchor="middle" color={MUTED}>SHOULDER</Label>
      <Label x={touch.x} y={bench + 22} anchor="middle" color={MUTED}>LOWER CHEST</Label>
      <line x1={shoulder.x} y1={shoulder.y} x2={shoulder.x} y2={48} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
      <path d={path(j)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      {showFault && <path d={path(straight)} fill="none" stroke={RED} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 5" />}
      <Plate at={touch} r={7} />
      <Plate at={lock} r={7} />
      <Label x={lock.x + 14} y={lock.y + 4} color={SOFT}>LOCKOUT</Label>
      <Label x={touch.x + 14} y={touch.y + 4} color={SOFT}>TOUCH</Label>
    </Frame>
  );
}

/* ---- squat: torso angle and moment arms ----------------------------------- */

type Squat = { ankle: Pt; knee: Pt; hip: Pt; shoulder: Pt; mid: number };

/** A squat bottom with the bar (on the shoulders) right over midfoot. */
function squatBottom(o: { shank: number; thigh: number; torso: number; shankDeg: number; hipBelow: number }): Squat | null {
  const ankle = { x: 0, y: 0.08 };
  const mid = 0.06;
  const knee = { x: ankle.x + o.shank * Math.sin(deg(o.shankDeg)), y: ankle.y + o.shank * Math.cos(deg(o.shankDeg)) };
  // thigh back from the knee, hip a touch below the knee (below parallel)
  const hip = { x: knee.x - Math.sqrt(Math.max(0, o.thigh ** 2 - o.hipBelow ** 2)), y: knee.y - o.hipBelow };
  const dx = mid - hip.x;
  if (Math.abs(dx) > o.torso) return null;
  const shoulder = { x: mid, y: hip.y + Math.sqrt(o.torso ** 2 - dx ** 2) };
  return { ankle, knee, hip, shoulder, mid };
}

function SquatPanel({ s, at, title, accent }: { s: Squat; at: { x: number; y: number; s: number }; title: string; accent: string }) {
  const P = (p: Pt) => toPx(p, at);
  const ankle = P(s.ankle);
  const knee = P(s.knee);
  const hip = P(s.hip);
  const sh = P(s.shoulder);
  const midX = P({ x: s.mid, y: 0 }).x;
  const floor = at.y;
  const hipArm = midX - hip.x;
  const kneeArm = Math.max(1, knee.x - midX);
  return (
    <g>
      <Foot heel={ankle.x - 10} toe={ankle.x + 26} y={floor} />
      <line x1={midX} y1={floor} x2={midX} y2={sh.y - 12} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
      <Body pts={[ankle, knee, hip, sh]} head={{ from: hip, to: sh, r: 8 }} />
      <Plate at={{ x: sh.x, y: sh.y + 3 }} r={7} />
      {/* moment arms: horizontal distance from each joint to the bar's line */}
      <line x1={hip.x} y1={hip.y + 10} x2={midX} y2={hip.y + 10} stroke={accent} strokeWidth={3} strokeLinecap="round" />
      <line x1={midX} y1={knee.y - 10} x2={knee.x} y2={knee.y - 10} stroke={GOLD} strokeWidth={3} strokeLinecap="round" />
      <Label x={hip.x - 4} y={hip.y + 13} anchor="end" color={accent} size={8.5}>HIP</Label>
      <Label x={knee.x + 5} y={knee.y - 7} color={GOLD} size={8.5}>KNEE</Label>
      <Label x={at.x + 6} y={26} anchor="middle" color={INK}>{title}</Label>
      <Label x={at.x + 6} y={38} anchor="middle" color={MUTED} size={8}>{hipArm > kneeArm * 1.6 ? "HIPS & BACK DO MORE" : "KNEES SHARE MORE"}</Label>
    </g>
  );
}

function SquatTorso() {
  const upright = squatBottom({ shank: 0.44, thigh: 0.44, torso: 0.6, shankDeg: 40, hipBelow: 0.03 });
  const lean = squatBottom({ shank: 0.42, thigh: 0.5, torso: 0.54, shankDeg: 27, hipBelow: 0.03 });
  if (!upright || !lean) return null;
  return (
    <Frame label={visualLabel({ kind: "squat_torso" })} note="BAR OVER MIDFOOT IN BOTH · ILLUSTRATION">
      <SquatPanel s={upright} at={{ x: 82, y: 180, s: 122 }} title="MORE UPRIGHT" accent={RED} />
      <SquatPanel s={lean} at={{ x: 232, y: 180, s: 122 }} title="MORE LEAN" accent={RED} />
      <line x1={160} y1={20} x2={160} y2={178} stroke={GRID} strokeWidth={1} />
      <line x1={14} y1={180} x2={306} y2={180} stroke={MUTED} strokeWidth={1.5} />
    </Frame>
  );
}

/* ---- deadlift start ------------------------------------------------------- */

type Pull = { ankle: Pt; knee: Pt; hip: Pt; shoulder: Pt; bar: Pt; mid: number };

/** A deadlift start: shins in, arms straight to the bar, shoulders `lead` in front of (or behind) the bar. */
function pullStart(o: { barX: number; lead: number; shankDeg: number }): Pull | null {
  const shank = 0.45;
  const thigh = 0.45;
  const torso = 0.52;
  const arm = 0.66;
  const ankle = { x: 0, y: 0.08 };
  const bar = { x: o.barX, y: 0.225 };
  const knee = { x: ankle.x + shank * Math.sin(deg(o.shankDeg)), y: ankle.y + shank * Math.cos(deg(o.shankDeg)) };
  const shoulder = { x: bar.x + o.lead, y: bar.y + Math.sqrt(arm ** 2 - o.lead ** 2) };
  const hip = circleMeet(knee, thigh, shoulder, torso, "back");
  if (!hip) return null;
  return { ankle, knee, hip, shoulder, bar, mid: 0.06 };
}

function PullPanel({ p, at, title, color }: { p: Pull; at: { x: number; y: number; s: number }; title: string; color: string }) {
  const P = (q: Pt) => toPx(q, at);
  const ankle = P(p.ankle);
  const knee = P(p.knee);
  const hip = P(p.hip);
  const sh = P(p.shoulder);
  const bar = P(p.bar);
  const midX = P({ x: p.mid, y: 0 }).x;
  return (
    <g>
      <Foot heel={ankle.x - 10} toe={ankle.x + 26} y={at.y} />
      <line x1={midX} y1={at.y} x2={midX} y2={sh.y - 14} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
      <line x1={sh.x} y1={sh.y} x2={bar.x} y2={bar.y} stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.85} />
      <Body pts={[ankle, knee, hip, sh]} color={color} head={{ from: hip, to: sh, r: 8 }} />
      <Plate at={bar} r={15} color={color} />
      <Label x={at.x + 4} y={26} anchor="middle" color={color === RED ? RED : INK}>{title}</Label>
    </g>
  );
}

function DeadliftStart({ fault }: { fault: string }) {
  const good = pullStart({ barX: 0.06, lead: 0.05, shankDeg: 18 });
  const bad =
    fault === "hips_high"
      ? pullStart({ barX: 0.06, lead: 0.17, shankDeg: 8 })
      : fault === "bar_forward"
        ? pullStart({ barX: 0.15, lead: 0.05, shankDeg: 18 })
        : pullStart({ barX: 0.06, lead: -0.07, shankDeg: 30 });
  if (!good || !bad) return null;
  const badTitle = fault === "hips_high" ? "HIPS TOO HIGH" : fault === "bar_forward" ? "BAR OVER TOES" : "HIPS TOO LOW";
  return (
    <Frame label={visualLabel({ kind: "deadlift_start", fault })} note="SIDE VIEW · ILLUSTRATION" noteAt="top">
      <PullPanel p={good} at={{ x: 92, y: 172, s: 128 }} title="BAR OVER MIDFOOT" color={INK} />
      <PullPanel p={bad} at={{ x: 238, y: 172, s: 128 }} title={badTitle} color={RED} />
      <line x1={160} y1={20} x2={160} y2={170} stroke={GRID} strokeWidth={1} />
      <line x1={14} y1={172} x2={306} y2={172} stroke={MUTED} strokeWidth={1.5} />
      <Label x={92} y={188} anchor="middle" color={MUTED} size={8}>SHOULDERS OVER THE BAR</Label>
      <Label x={238} y={188} anchor="middle" color={RED} size={8}>{fault === "hips_low" ? "SHOULDERS BEHIND THE BAR" : fault === "hips_high" ? "CHEST DOWN, BACK DOES MORE" : "BAR FURTHER FROM THE HIPS"}</Label>
    </Frame>
  );
}

/* ---- bench touch ----------------------------------------------------------- */

function BenchTouch() {
  // side view, head on the left: the shoulder, the bar on the lower chest, the elbow under it (or not)
  const bench = 132;
  const Panel = ({ x, stacked }: { x: number; stacked: boolean }) => {
    const shoulder = { x: x - 40, y: bench - 18 };
    const bar = { x: x + 16, y: bench - 36 };
    const elbow = stacked ? { x: bar.x, y: bench + 38 } : { x: x - 30, y: bench + 36 };
    const color = stacked ? INK : RED;
    return (
      <g>
        <path d={`M${x - 60} ${bench - 2} Q${x - 56} ${bench - 22} ${x - 42} ${bench - 22} Q${x + 2} ${bench - 40} ${x + 46} ${bench - 22} L${x + 64} ${bench - 6} L${x + 64} ${bench - 2} Z`} fill="rgba(255,255,255,0.12)" />
        <circle cx={x - 62} cy={bench - 16} r={8} fill="#0a0a0d" stroke={SOFT} strokeWidth={2.5} />
        <line x1={bar.x} y1={bar.y - 14} x2={bar.x} y2={bench + 50} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
        <Body pts={[shoulder, elbow, bar]} color={color} />
        <Plate at={bar} r={8} color={color} />
        <Label x={x} y={36} anchor="middle" color={color}>{stacked ? "FOREARM STACKED" : "FOREARM TILTED"}</Label>
        <Label x={x} y={bench + 62} anchor="middle" color={MUTED} size={8}>{stacked ? "ELBOW UNDER THE BAR" : "BAR AHEAD OF ELBOW"}</Label>
      </g>
    );
  };
  return (
    <Frame label={visualLabel({ kind: "bench_touch" })} note="SIDE VIEW · ILLUSTRATION" noteAt="top">
      <rect x={14} y={bench} width={292} height={6} rx={3} fill="rgba(255,255,255,0.18)" />
      <Panel x={88} stacked />
      <Panel x={238} stacked={false} />
      <line x1={160} y1={24} x2={160} y2={190} stroke={GRID} strokeWidth={1} />
    </Frame>
  );
}

/* ---- curves ------------------------------------------------------------------ */

const BOX = { x0: 30, y0: 168, w: 272, h: 120 };

function StickingPoint({ lift }: { lift: LessonLift }) {
  const ends: Record<LessonLift, [string, string]> = { squat: ["HOLE", "LOCKOUT"], bench: ["CHEST", "LOCKOUT"], deadlift: ["FLOOR", "LOCKOUT"] };
  const dip = lift === "deadlift" ? 0.45 : lift === "squat" ? 0.33 : 0.3;
  // fast off the bottom, a slow patch, faster again, stopping at lockout
  const f = (t: number) => {
    const rise = 1 - Math.exp(-t * 14);
    const slow = 0.62 * Math.exp(-((t - dip) ** 2) / 0.012);
    const stop = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1;
    return Math.max(0.03, (0.85 * rise - slow + 0.1 * t) * stop);
  };
  const pts = plot(f, BOX);
  const x0 = BOX.x0 + (dip - 0.11) * BOX.w;
  const x1 = BOX.x0 + (dip + 0.11) * BOX.w;
  return (
    <Frame label={visualLabel({ kind: "sticking_point", lift })} note="ILLUSTRATION">
      <rect x={x0} y={BOX.y0 - BOX.h - 4} width={x1 - x0} height={BOX.h + 4} fill="rgba(255,90,100,0.14)" />
      <Label x={(x0 + x1) / 2} y={BOX.y0 - BOX.h - 8} anchor="middle" color={RED}>STICKING REGION</Label>
      <Axes x0={BOX.x0} y0={BOX.y0} x1={BOX.x0 + BOX.w} y1={BOX.y0 - BOX.h} xLabel="" yLabel="BAR SPEED" />
      <path d={path(pts)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      <Label x={BOX.x0} y={BOX.y0 + 14} color={MUTED}>{ends[lift][0]}</Label>
      {lift === "deadlift" && <Label x={BOX.x0 + 0.45 * BOX.w} y={BOX.y0 + 14} anchor="middle" color={MUTED}>KNEES</Label>}
      <Label x={BOX.x0 + BOX.w} y={BOX.y0 + 14} anchor="end" color={MUTED}>{ends[lift][1]}</Label>
    </Frame>
  );
}

function StrengthCurve({ shape }: { shape: string }) {
  const f =
    shape === "descending"
      ? (t: number) => 0.95 - 0.6 * t * t
      : shape === "bell"
        ? (t: number) => 0.3 + 0.65 * Math.sin(Math.PI * t)
        : (t: number) => 0.3 + 0.65 * Math.pow(t, 1.3);
  const name = shape === "descending" ? "STRONGEST AT THE START" : shape === "bell" ? "STRONGEST MID RANGE" : "STRONGEST NEAR LOCKOUT";
  return (
    <Frame label={visualLabel({ kind: "strength_curve", shape })} note="ILLUSTRATION">
      <Legend items={[{ label: name, color: INK }]} />
      <Axes x0={BOX.x0} y0={BOX.y0} x1={BOX.x0 + BOX.w} y1={BOX.y0 - BOX.h} xLabel="RANGE OF MOTION →" yLabel="FORCE YOU CAN MAKE" />
      <path d={path(plot(f, BOX))} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      <Label x={BOX.x0} y={BOX.y0 + 14} color={MUTED}>START</Label>
    </Frame>
  );
}

function LengthTension() {
  // active force: rises, plateaus around resting length, falls when overstretched
  const f = (t: number) => (t < 0.38 ? 0.15 + 0.85 * (t / 0.38) ** 0.9 : t < 0.55 ? 1 : Math.max(0.08, 1 - ((t - 0.55) / 0.45) * 0.92));
  const peakX = BOX.x0 + 0.465 * BOX.w;
  return (
    <Frame label={visualLabel({ kind: "length_tension" })} note="SIMPLIFIED MODEL">
      <Axes x0={BOX.x0} y0={BOX.y0} x1={BOX.x0 + BOX.w} y1={BOX.y0 - BOX.h} xLabel="MUSCLE LENGTH →" yLabel="FORCE" />
      <path d={path(plot(f, BOX))} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      <Label x={peakX} y={BOX.y0 - BOX.h - 8} anchor="middle" color={GOLD}>MOST FORCE</Label>
      <Label x={BOX.x0 + 6} y={BOX.y0 + 14} color={MUTED}>SHORT</Label>
      <Label x={BOX.x0 + BOX.w} y={BOX.y0 - 0.32 * BOX.h} anchor="end" color={SOFT} size={8.5}>OVERSTRETCHED</Label>
    </Frame>
  );
}

function ForceVelocity() {
  // Hill's curve (a = 0.25): force falls as speed rises; power = force × speed peaks around a third of max speed
  const a = 0.25;
  const force = (v: number) => Math.max(0, ((1 + a) / (v + a)) * a - a);
  const pts = plot((t) => force(t), BOX);
  const power = (v: number) => force(v) * v;
  const pmax = Math.max(...Array.from({ length: 101 }, (_, i) => power(i / 100)));
  const powPts = plot((t) => (power(t) / pmax) * 0.62, BOX);
  return (
    <Frame label={visualLabel({ kind: "force_velocity" })} note="CLASSIC MODEL">
      <Legend items={[{ label: "FORCE", color: INK }, { label: "POWER", color: GOLD, dash: true }]} />
      <Axes x0={BOX.x0} y0={BOX.y0} x1={BOX.x0 + BOX.w} y1={BOX.y0 - BOX.h} xLabel="SPEED →" yLabel="FORCE" />
      <path d={path(pts)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      <path d={path(powPts)} fill="none" stroke={GOLD} strokeWidth={2.5} strokeDasharray="5 4" />
      <Label x={BOX.x0 + 14} y={BOX.y0 - BOX.h + 6} color={SOFT} size={8.5}>A MAX: HEAVY, SLOW</Label>
      <Label x={BOX.x0 + BOX.w} y={BOX.y0 - 40} anchor="end" color={SOFT} size={8.5}>LIGHT: FAST</Label>
    </Frame>
  );
}

/**
 * Banister's model run on a real schedule: 4 weeks of hard training then a
 * 10-day taper at a third of the load. Fitness (k 1, τ 42 days) and fatigue
 * (k 2, τ 7 days); performance is the difference.
 */
export function banister(days = 42, hardDays = 30) {
  const fit: number[] = [];
  const fat: number[] = [];
  let f = 0;
  let g = 0;
  for (let d = 0; d < days; d++) {
    const load = d < hardDays ? 0.85 : 0.3;
    f = f * Math.exp(-1 / 42) + load;
    g = g * Math.exp(-1 / 7) + load;
    fit.push(f);
    fat.push(2 * g);
  }
  const perf = fit.map((v, i) => v - fat[i]);
  return { fit, fat, perf };
}

function FitnessFatigue() {
  const days = 42;
  const hard = 30;
  const { fit, fat, perf } = banister(days, hard);
  const top = Math.max(...fit, ...fat);
  const low = Math.min(...perf, 0);
  const box = { x0: 30, y0: 172, w: 272, h: 124 };
  const y = (v: number) => box.y0 - ((v - low) / (top - low)) * box.h;
  const xs = (i: number) => box.x0 + (i / (days - 1)) * box.w;
  const line = (arr: number[]) => path(arr.map((v, i) => ({ x: xs(i), y: y(v) })));
  const taperX = xs(hard);
  return (
    <Frame label={visualLabel({ kind: "fitness_fatigue" })} note="BANISTER MODEL" noteAt="top">
      <Legend items={[{ label: "FITNESS", color: INK }, { label: "FATIGUE", color: RED, dash: true }, { label: "PERFORMANCE", color: GOLD }]} />
      <rect x={taperX} y={box.y0 - box.h} width={box.x0 + box.w - taperX} height={box.h} fill="rgba(255,255,255,0.05)" />
      <Label x={(taperX + box.x0 + box.w) / 2} y={box.y0 + 14} anchor="middle" color={SOFT}>TAPER</Label>
      <Label x={box.x0 + 2} y={box.y0 + 14} color={MUTED}>HARD TRAINING</Label>
      <line x1={box.x0} y1={y(0)} x2={box.x0 + box.w} y2={y(0)} stroke={GRID} strokeWidth={1} />
      <line x1={box.x0} y1={box.y0} x2={box.x0} y2={box.y0 - box.h} stroke={MUTED} strokeWidth={1.2} />
      <path d={line(fit)} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d={line(fat)} fill="none" stroke={RED} strokeWidth={2.5} strokeDasharray="5 4" />
      <path d={line(perf)} fill="none" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" />
    </Frame>
  );
}

function Sra() {
  const f = (t: number) => {
    // baseline, a dip after the session, back up past baseline, drifting back down
    const base = 0.5;
    if (t < 0.12) return base;
    const u = (t - 0.12) / 0.88;
    return base - 0.32 * Math.sin(Math.min(1, u / 0.4) * Math.PI) * (u < 0.4 ? 1 : 0) + (u > 0.25 ? 0.16 * Math.sin(Math.min(1, (u - 0.25) / 0.75) * Math.PI) : 0);
  };
  const pts = plot(f, BOX, 80);
  const baseY = BOX.y0 - 0.5 * BOX.h;
  return (
    <Frame label={visualLabel({ kind: "sra" })} note="SIMPLIFIED MODEL">
      <line x1={BOX.x0} y1={baseY} x2={BOX.x0 + BOX.w} y2={baseY} stroke={GRID} strokeWidth={1.2} strokeDasharray="3 4" />
      <Label x={BOX.x0 + BOX.w} y={baseY + 14} anchor="end" color={MUTED}>WHERE YOU STARTED</Label>
      <line x1={BOX.x0} y1={BOX.y0} x2={BOX.x0} y2={BOX.y0 - BOX.h} stroke={MUTED} strokeWidth={1.2} />
      <path d={path(pts)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      <Label x={BOX.x0 + 0.12 * BOX.w} y={BOX.y0 - 0.5 * BOX.h - 12} anchor="middle" color={RED}>SESSION</Label>
      <Label x={BOX.x0 + 0.3 * BOX.w} y={BOX.y0 + 2} anchor="middle" color={SOFT}>RECOVERY</Label>
      <Label x={BOX.x0 + 0.66 * BOX.w} y={BOX.y0 - 0.74 * BOX.h} anchor="middle" color={GOLD}>ADAPTATION</Label>
      <Label x={BOX.x0} y={BOX.y0 + 14} color={MUTED}>TIME →</Label>
    </Frame>
  );
}

function RpeRir() {
  const rows = [
    { rpe: "10", rir: "0", note: "MAX, NOTHING LEFT" },
    { rpe: "9", rir: "1", note: "COULD DO 1 MORE" },
    { rpe: "8", rir: "2", note: "COULD DO 2 MORE" },
    { rpe: "7", rir: "3", note: "COULD DO 3 MORE" },
    { rpe: "6", rir: "4+", note: "4 OR MORE LEFT" },
  ];
  return (
    <Frame label={visualLabel({ kind: "rpe_rir" })}>
      <Label x={20} y={22} color={MUTED}>RPE</Label>
      <Label x={70} y={22} color={MUTED}>REPS LEFT</Label>
      {rows.map((r, i) => {
        const y = 34 + i * 31;
        const w = 110 + (4 - i) * 22;
        return (
          <g key={r.rpe}>
            <rect x={110} y={y} width={w} height={22} rx={6} fill={i === 0 ? RED : `rgba(255,255,255,${0.32 - i * 0.05})`} />
            <text x={20} y={y + 17} fontSize={20} fontWeight={900} fill={INK}>{r.rpe}</text>
            <text x={70} y={y + 17} fontSize={18} fontWeight={900} fill={i === 0 ? RED : SOFT}>{r.rir}</text>
            <Label x={118} y={y + 15} color={i === 0 ? "#fff" : INK} size={9}>{r.note}</Label>
          </g>
        );
      })}
    </Frame>
  );
}

function DoseResponse() {
  const growth = (t: number) => 0.92 * (1 - Math.exp(-t * 3.2));
  const fatigue = (t: number) => 0.08 + 0.85 * Math.pow(t, 1.8);
  return (
    <Frame label={visualLabel({ kind: "dose_response" })} note="ILLUSTRATION · NOT DATA">
      <Legend items={[{ label: "GROWTH", color: INK }, { label: "FATIGUE", color: RED, dash: true }]} />
      <Axes x0={BOX.x0} y0={BOX.y0} x1={BOX.x0 + BOX.w} y1={BOX.y0 - BOX.h} xLabel="HARD SETS A WEEK →" yLabel="" />
      <path d={path(plot(growth, BOX))} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      <path d={path(plot(fatigue, BOX))} fill="none" stroke={RED} strokeWidth={2.5} strokeDasharray="5 4" />
      <Label x={BOX.x0 + BOX.w * 0.62} y={BOX.y0 - 0.95 * BOX.h} anchor="middle" color={SOFT} size={8.5}>EACH SET ADDS A LITTLE LESS</Label>
    </Frame>
  );
}

function VelocityLoss() {
  const reps = [1, 0.96, 0.91, 0.86, 0.8, 0.71, 0.58, 0.38];
  const box = { x0: 30, y0: 170, w: 272, h: 120 };
  const bw = box.w / reps.length - 8;
  return (
    <Frame label={visualLabel({ kind: "velocity_loss" })} note="ILLUSTRATION">
      <Axes x0={box.x0} y0={box.y0} x1={box.x0 + box.w} y1={box.y0 - box.h} xLabel="" yLabel="REP SPEED" />
      {reps.map((v, i) => {
        const x = box.x0 + 6 + i * (bw + 8);
        const h = v * box.h;
        const last = i >= reps.length - 2;
        return <rect key={i} x={x} y={box.y0 - h} width={bw} height={h} rx={4} fill={last ? RED : `rgba(255,255,255,${0.75 - i * 0.05})`} />;
      })}
      <Label x={box.x0 + 6} y={box.y0 + 14} color={MUTED}>REP 1</Label>
      <Label x={box.x0 + box.w} y={box.y0 + 14} anchor="end" color={RED}>CLOSE TO FAILURE</Label>
    </Frame>
  );
}

/** A stable id for gradients if a diagram ever needs one. */
export function useVisualId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
