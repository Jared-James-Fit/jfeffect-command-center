import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LessonLift, LessonVisual } from "@/lib/lessons";

/**
 * The pictures under a coach lesson, drawn in code so they belong to the app:
 * its colours (they follow light and dark mode), its type, crisp at any size,
 * nothing generated or uploaded.
 *
 * Bodies are solid silhouettes built from real segment proportions (Winter,
 * Biomechanics and Motor Control of Human Movement) and solved, not sketched:
 * a squat keeps the bar over midfoot, a deadlift hangs straight arms from the
 * shoulders to a bar on 45 cm plates, a bench stacks the forearm under the
 * bar. So every position drawn is one a lifter could actually hold. Red only
 * ever marks the part that matters (the fault, the lever, the sticking
 * region); curves that are models say so in the card's note.
 */

export type VisualTone = "auto" | "dark";

/** The palette, as variables: "auto" follows the app's theme, "dark" is for stories (always on black). */
const TONES: Record<VisualTone, CSSProperties> = {
  auto: {
    "--lv-ink": "var(--foreground)",
    "--lv-body": "color-mix(in oklab, var(--foreground) 64%, var(--card))",
    "--lv-gap": "color-mix(in oklab, var(--muted) 40%, var(--card))",
    "--lv-sub": "var(--muted-foreground)",
    "--lv-line": "color-mix(in oklab, var(--foreground) 17%, transparent)",
    "--lv-faint": "color-mix(in oklab, var(--foreground) 6%, transparent)",
    "--lv-accent": "var(--primary)",
    "--lv-soft": "color-mix(in oklab, var(--primary) 13%, transparent)",
  } as CSSProperties,
  dark: {
    "--lv-ink": "rgba(255,255,255,0.94)",
    "--lv-body": "#c9c9cf",
    "--lv-gap": "#121215",
    "--lv-sub": "rgba(255,255,255,0.58)",
    "--lv-line": "rgba(255,255,255,0.18)",
    "--lv-faint": "rgba(255,255,255,0.07)",
    "--lv-accent": "#ff4d58",
    "--lv-soft": "rgba(255,77,88,0.17)",
  } as CSSProperties,
};

const C = {
  ink: "var(--lv-ink)",
  body: "var(--lv-body)",
  sub: "var(--lv-sub)",
  line: "var(--lv-line)",
  faint: "var(--lv-faint)",
  accent: "var(--lv-accent)",
  soft: "var(--lv-soft)",
  gap: "var(--lv-gap)",
};

const W = 320;

export function LessonVisualArt({ visual, tone = "auto", className }: { visual: LessonVisual; tone?: VisualTone; className?: string }) {
  const art = draw(visual);
  if (!art) return null;
  return (
    <div className={cn("w-full", className)} style={TONES[tone]} data-lesson-visual={visual.kind} data-tone={tone}>
      {art}
    </div>
  );
}

function draw(v: LessonVisual): ReactNode {
  switch (v.kind) {
    case "bar_path":
      return v.lift === "bench" ? <BenchPath fault={v.fault === "forward"} /> : <PullPath lift={v.lift === "squat" ? "squat" : "deadlift"} />;
    case "squat_torso":
      return <SquatLevers variant={v.variant === "lean" ? "lean" : "build"} />;
    case "squat_balance":
      return <SquatBalance />;
    case "squat_rise":
      return <SquatRise />;
    case "squat_depth":
      return <SquatDepth />;
    case "deadlift_start":
      return <DeadliftStart fault={v.fault === "hips_high" || v.fault === "bar_forward" ? v.fault : "hips_low"} />;
    case "bench_touch":
      return v.variant === "consistency" ? <BenchConsistency /> : <BenchTuckFlare />;
    case "sticking_point":
      return <StickingPoint lift={v.lift ?? "bench"} />;
    case "strength_curve":
      return <StrengthCurve shape={v.shape ?? "ascending"} />;
    case "length_tension":
      return <LengthTension />;
    case "force_velocity":
      return <ForceVelocity />;
    case "fitness_fatigue":
      return <FitnessFatigue />;
    case "sra":
      return <Sra stress={v.variant === "stress"} />;
    case "rpe_rir":
      return <RpeRir />;
    case "dose_response":
      return <DoseResponse />;
    case "velocity_loss":
      return v.variant === "cluster" ? <ClusterSets /> : <VelocityLoss />;
    case "set_structure":
      return <MyoReps />;
    default:
      return null;
  }
}

/** What a picture shows, for screen readers. */
export function visualLabel(v: LessonVisual): string {
  const lift = v.lift ? `${v.lift} ` : "";
  switch (v.kind) {
    case "bar_path":
      return v.lift === "bench"
        ? `Bench from the side: the bar comes off the lower chest and back over the shoulder${v.fault === "forward" ? ", versus finishing over the chest" : ""}`
        : `Side view of the ${lift}bar path: straight up over midfoot versus drifting forward`;
    case "squat_torso":
      return v.variant === "lean"
        ? "Two squat bottoms with the bar over midfoot: a few degrees more lean moves the hips further behind the bar"
        : "Two squat bottoms with the bar over midfoot: shorter thighs sit more upright, longer thighs lean more and load the hips more";
    case "squat_balance":
      return "Squat bottom: bar over midfoot with the whole foot down, versus weight on the toes with the heels up";
    case "squat_rise":
      return "Coming out of the hole: hips and chest rise together, versus hips rising while the bar barely moves";
    case "squat_depth":
      return "Squat depth from the side: hip crease above the top of the knee, versus below it";
    case "deadlift_start":
      return v.fault === "hips_high"
        ? "Deadlift start: shoulders just over the bar, versus hips high with the back nearly flat"
        : v.fault === "bar_forward"
          ? "Deadlift start: bar over midfoot, versus the bar out over the toes"
          : "Deadlift start: shoulders over the bar, versus starting low with shoulders behind it, where the hips rise first";
    case "bench_touch":
      return v.variant === "consistency"
        ? "Bench from the side: the bar landing on the same spot every rep, versus a different spot each rep"
        : "Bench from the side: forearm stacked under the bar with a lower touch and more tuck, or a higher touch and more flare";
    case "sticking_point":
      return `Bar speed through the ${lift}rep, with the sticking region marked`;
    case "strength_curve":
      return "How much force you can produce across the range of motion";
    case "length_tension":
      return "Muscle force across muscle length: most in the middle";
    case "force_velocity":
      return "Force and speed: heavy is slow, power peaks in between";
    case "fitness_fatigue":
      return "Fitness, fatigue and performance through a hard block and a taper";
    case "sra":
      return v.variant === "stress" ? "Recovery after a workout, normally and in a stressful week" : "Stimulus, recovery, adaptation";
    case "rpe_rir":
      return "RPE and reps in reserve";
    case "dose_response":
      return "More weekly sets, more growth, with smaller gains each step";
    case "velocity_loss":
      return v.variant === "cluster" ? "Rep speed in a straight set versus singles with short rests" : "Rep speed falling across a set taken close to failure";
    case "set_structure":
      return "A myo-rep set: one activation set, then short mini sets on a few breaths until you can't match the first";
  }
}

/** The one line under a picture: what it is, honestly (a drawing, a model, an example). */
export function visualNote(v: LessonVisual): string {
  switch (v.kind) {
    case "bar_path":
      return v.lift === "bench" ? "Side view, head on the left · illustration" : "Side view · dashed line is midfoot · illustration";
    case "squat_torso":
    case "squat_balance":
    case "squat_rise":
      return "Side view · dashed line is midfoot · illustration";
    case "squat_depth":
      return "Side view, about hip height · illustration";
    case "deadlift_start":
      return "Side view · dashed line is midfoot · illustration";
    case "bench_touch":
      return v.variant === "consistency" ? "Side view, head on the left · illustration" : "Side view, head on the left · forearm stacked under the bar in both";
    case "sticking_point":
      return "Typical shape · where yours sits shows on video";
    case "strength_curve":
    case "length_tension":
    case "sra":
      return "Simplified model, not measured data";
    case "force_velocity":
      return "Force–velocity relationship (Hill) · simplified";
    case "fitness_fatigue":
      return "Fitness–fatigue model (Banister) · simplified";
    case "rpe_rir":
      return "RPE as reps in reserve";
    case "dose_response":
      return "Shape of the research average · people vary";
    case "velocity_loss":
      return v.variant === "cluster" ? "Illustration · short rests inside the set keep reps fast" : "Illustration · rep speed slows as a set gets close to failure";
    case "set_structure":
      return "Example · your rep counts will differ";
  }
}

/* ======================================================================
 * Building blocks
 * ==================================================================== */

type Pt = { x: number; y: number };
const pt = (x: number, y: number): Pt => ({ x, y });
const add = (a: Pt, b: Pt) => pt(a.x + b.x, a.y + b.y);
const sub = (a: Pt, b: Pt) => pt(a.x - b.x, a.y - b.y);
const mul = (a: Pt, k: number) => pt(a.x * k, a.y * k);
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt) => mul(a, 1 / (len(a) || 1));
const rad = (d: number) => (d * Math.PI) / 180;
/** A direction `d` degrees forward of straight up. */
const tilt = (d: number) => pt(Math.sin(rad(d)), Math.cos(rad(d)));
/** The chest side of a segment pointing along u (lifters face right). */
const front = (u: Pt) => pt(u.y, -u.x);
const f1 = (n: number) => n.toFixed(1);

function Svg({ label, h, children }: { label: string; h: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="block h-auto w-full" role="img" aria-label={label} style={{ fontFamily: "inherit" }}>
      {children}
    </svg>
  );
}

function T({ x, y, children, c = C.sub, size = 10.5, weight = 600, anchor = "start", caps = false }: {
  x: number; y: number; children: ReactNode; c?: string; size?: number; weight?: number; anchor?: "start" | "middle" | "end"; caps?: boolean;
}) {
  return (
    <text x={f1(x)} y={f1(y)} textAnchor={anchor} fontSize={size} fontWeight={weight} letterSpacing={caps ? "0.1em" : undefined} style={{ fill: c }}>
      {children}
    </text>
  );
}

/** A panel's name (the app's small caps label) and up to two short plain lines under it. */
function Head({ x, title, lines = [], c = C.ink }: { x: number; title: string; lines?: string[]; c?: string }) {
  return (
    <g>
      <T x={x} y={12} anchor="middle" c={c} size={9.5} weight={800} caps>{title}</T>
      {lines.map((l, i) => (
        <T key={i} x={x} y={25 + i * 12} anchor="middle" size={10}>{l}</T>
      ))}
    </g>
  );
}

/** A small key, top left: a short stroke and its name. */
function Legend({ items, x = 8, y = 13 }: { items: { label: string; c: string; dash?: boolean }[]; x?: number; y?: number }) {
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.label}>
          <line x1={x} y1={y + i * 15 - 3.5} x2={x + 18} y2={y + i * 15 - 3.5} style={{ stroke: it.c }} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={it.dash ? "4 3" : undefined} />
          <T x={x + 25} y={y + i * 15} c={it.c} size={10.5} weight={700}>{it.label}</T>
        </g>
      ))}
    </g>
  );
}

function Divider({ x = W / 2, y0 = 4, y1 }: { x?: number; y0?: number; y1: number }) {
  return <line x1={x} y1={y0} x2={x} y2={y1} style={{ stroke: C.line }} strokeWidth={1} />;
}

function Floor({ y, x0 = 6, x1 = W - 6 }: { y: number; x0?: number; x1?: number }) {
  return <line x1={x0} y1={f1(y)} x2={x1} y2={f1(y)} style={{ stroke: C.line }} strokeWidth={1.5} strokeLinecap="round" />;
}

/** A dashed plumb line: midfoot, or straight down from the bar. */
function Plumb({ x, y0, y1, c = C.sub }: { x: number; y0: number; y1: number; c?: string }) {
  return <line x1={f1(x)} y1={f1(y0)} x2={f1(x)} y2={f1(y1)} style={{ stroke: c }} strokeWidth={1.1} strokeDasharray="2.5 3" strokeLinecap="round" />;
}

function Arrow({ from, to, c = C.accent, w = 1.8 }: { from: Pt; to: Pt; c?: string; w?: number }) {
  const u = unit(sub(to, from));
  const n = front(u);
  const tip = to;
  const b = sub(tip, mul(u, 6));
  const l = add(b, mul(n, 3.4));
  const r = sub(b, mul(n, 3.4));
  return (
    <g>
      <line x1={f1(from.x)} y1={f1(from.y)} x2={f1(b.x)} y2={f1(b.y)} style={{ stroke: c }} strokeWidth={w} strokeLinecap="round" />
      <path d={`M${f1(tip.x)} ${f1(tip.y)} L${f1(l.x)} ${f1(l.y)} L${f1(r.x)} ${f1(r.y)} Z`} style={{ fill: c }} />
    </g>
  );
}

/** A limb as a tapered capsule: circles of radius ra at a and rb at b, joined by their outer tangents. */
function capsule(a: Pt, ra: number, b: Pt, rb: number): string {
  const d = len(sub(b, a));
  if (d <= Math.abs(ra - rb) + 0.01) {
    const c = ra >= rb ? a : b;
    const r = Math.max(ra, rb);
    return `M${f1(c.x - r)} ${f1(c.y)} a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`;
  }
  const th = Math.atan2(b.y - a.y, b.x - a.x);
  const ph = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / d)));
  const on = (c: Pt, r: number, ang: number) => pt(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
  const a1 = on(a, ra, th + ph);
  const b1 = on(b, rb, th + ph);
  const b2 = on(b, rb, th - ph);
  const a2 = on(a, ra, th - ph);
  return [
    `M${f1(a1.x)} ${f1(a1.y)}`,
    `L${f1(b1.x)} ${f1(b1.y)}`,
    `A${f1(rb)} ${f1(rb)} 0 ${2 * ph > Math.PI ? 1 : 0} 0 ${f1(b2.x)} ${f1(b2.y)}`,
    `L${f1(a2.x)} ${f1(a2.y)}`,
    `A${f1(ra)} ${f1(ra)} 0 ${ph < Math.PI / 2 ? 1 : 0} 0 ${f1(a1.x)} ${f1(a1.y)}`,
    "Z",
  ].join(" ");
}

/** A smooth line through points (Catmull-Rom as cubic Béziers). */
function smooth(p: Pt[], closed = false): string {
  if (p.length < 2) return "";
  const at = (i: number) => (closed ? p[(i + p.length) % p.length] : p[Math.max(0, Math.min(p.length - 1, i))]);
  let d = `M${f1(p[0].x)} ${f1(p[0].y)}`;
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += ` C${f1(c1.x)} ${f1(c1.y)} ${f1(c2.x)} ${f1(c2.y)} ${f1(p2.x)} ${f1(p2.y)}`;
  }
  return closed ? `${d} Z` : d;
}

/** Both points where two circles meet. */
function meet(a: Pt, ra: number, b: Pt, rb: number): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) return null;
  const l = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - l * l));
  const m = pt(a.x + (dx * l) / d, a.y + (dy * l) / d);
  return [pt(m.x + (dy * h) / d, m.y - (dx * h) / d), pt(m.x - (dy * h) / d, m.y + (dx * h) / d)];
}

/* ======================================================================
 * Bodies
 *
 * Model space: metres scaled to a 1.0-tall lifter, y up, floor at 0, the
 * ankle at x = 0, lifters facing right. A View puts that on the page.
 * ==================================================================== */

/** Segment lengths as a share of height (Winter 2009). */
const SEG = {
  heel: 0.042, // heel behind the ankle
  toe: 0.11, // toes in front of the ankle
  ankleH: 0.039,
  shank: 0.246,
  thigh: 0.245,
  torso: 0.288, // hip joint to shoulder joint
  upperArm: 0.186,
  forearm: 0.146,
  grip: 0.04, // wrist to the middle of the hand
  neck: 0.105, // shoulder joint to the middle of the head
};
/** Midfoot sits this far in front of the ankle joint. */
const MIDFOOT = (SEG.toe - SEG.heel) / 2;
/** A 45 cm plate on a 175 cm lifter. */
const PLATE_R = 0.129;

/** Limb thickness (radius) at each end: a touch slimmer than life, so a shape reads at a glance. */
const R = { ankle: 0.018, knee: 0.028, thighKnee: 0.031, hip: 0.05, pelvis: 0.052, chest: 0.056, neck: 0.022, shoulder: 0.03, elbow: 0.022, wrist: 0.016, head: 0.054 };

type View = { x: number; y: number; s: number };
const toPx = (q: Pt, v: View) => pt(v.x + q.x * v.s, v.y - q.y * v.s);

type Pose = { heel: Pt; toe: Pt; ankle: Pt; knee: Pt; hip: Pt; shoulder: Pt; head: Pt; elbow: Pt; hand: Pt; bar: Pt; torsoDeg: number };

function footAt(heelUpDeg = 0) {
  const toe = pt(SEG.toe, 0);
  const a = rad(heelUpDeg);
  const back = pt(-Math.cos(a), Math.sin(a));
  const up = pt(Math.sin(a), Math.cos(a));
  const heel = add(toe, mul(back, SEG.toe + SEG.heel));
  const ankle = add(add(toe, mul(back, SEG.toe)), mul(up, SEG.ankleH));
  return { heel, toe, ankle };
}

/**
 * A squat position: shin `shank`° forward, thigh `thighDeg`° below level (hip
 * under the knee when positive), torso leaned until the bar on the back sits
 * over `barX` (midfoot by default). Solved for balance, not posed.
 */
function squatPose(o: { shank: number; thighDeg: number; thigh?: number; torso?: number; heelUp?: number; barX?: number }): Pose {
  const f = footAt(o.heelUp ?? 0);
  const thigh = o.thigh ?? SEG.thigh;
  const torso = o.torso ?? SEG.torso;
  const knee = add(f.ankle, mul(tilt(o.shank), SEG.shank));
  const hip = add(knee, mul(pt(-Math.cos(rad(o.thighDeg)), -Math.sin(rad(o.thighDeg))), thigh));
  // the bar rides on the upper back: just above the shoulder joint, on the back of the torso
  const barAt = (deg: number) => {
    const u = tilt(deg);
    return add(add(hip, mul(u, torso + 0.008)), mul(front(u), -0.052));
  };
  const target = o.barX ?? MIDFOOT;
  let lo = -15;
  let hi = 88;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (barAt(m).x < target) lo = m;
    else hi = m;
  }
  const deg = (lo + hi) / 2;
  const u = tilt(deg);
  const shoulder = add(hip, mul(u, torso));
  const bar = barAt(deg);
  const head = add(add(shoulder, mul(u, SEG.neck)), mul(front(u), 0.024));
  // hands on the bar, elbows pointing down along the back (from the side the arms look short: they reach out to the sides too)
  const elbow = add(add(shoulder, mul(u, -0.112)), mul(front(u), -0.036));
  return { ...f, knee, hip, shoulder, head, elbow, hand: bar, bar, torsoDeg: deg };
}

/**
 * A deadlift start: bar on the floor (45 cm plates) at `barX`, shins `shank`°
 * forward, straight arms from the shoulders, shoulders `lead` in front of the
 * bar (negative = behind it). The hip is where thigh and torso meet.
 */
function pullPose(o: { shank: number; lead: number; barX?: number }): Pose | null {
  const f = footAt(0);
  const knee = add(f.ankle, mul(tilt(o.shank), SEG.shank));
  const bar = pt(o.barX ?? MIDFOOT, PLATE_R);
  const arm = SEG.upperArm + SEG.forearm + SEG.grip;
  const shoulder = pt(bar.x + o.lead, bar.y + Math.sqrt(arm ** 2 - o.lead ** 2));
  const both = meet(knee, SEG.thigh, shoulder, SEG.torso);
  if (!both) return null;
  const hip = both[0].x < both[1].x ? both[0] : both[1];
  const u = unit(sub(shoulder, hip));
  const head = add(add(shoulder, mul(u, SEG.neck)), mul(front(u), 0.024));
  const elbow = add(shoulder, mul(unit(sub(bar, shoulder)), SEG.upperArm));
  return { ...f, knee, hip, shoulder, head, elbow, hand: bar, bar, torsoDeg: (Math.atan2(u.x, u.y) * 180) / Math.PI };
}

/** A circle as a path drawn the same way round as a capsule (so they can share one path). */
function circle(c: Pt, r: number): string {
  return `M${f1(c.x - r)} ${f1(c.y)} a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`;
}

/**
 * The silhouette: legs, torso and head in one tone, then the near arm on top
 * with a hairline gap in the card's colour, so it reads over the body.
 * Fade the whole group for a ghost (a position a moment earlier or later).
 */
function Figure({ pose, v, fill = C.body, opacity, arms = true }: { pose: Pose; v: View; fill?: string; opacity?: number; arms?: boolean }) {
  const P = (q: Pt) => toPx(q, v);
  const r = (n: number) => n * v.s;
  const fdir = unit(sub(pose.toe, pose.heel));
  const fup = pt(-fdir.y, fdir.x);
  const footBack = add(add(pose.heel, mul(fdir, 0.018)), mul(fup, 0.018));
  const footFront = add(sub(pose.toe, mul(fdir, 0.01)), mul(fup, 0.01));
  const body = [
    capsule(P(footBack), r(0.018), P(footFront), r(0.01)),
    capsule(P(pose.ankle), r(R.ankle), P(pose.knee), r(R.knee)),
    capsule(P(pose.knee), r(R.thighKnee), P(pose.hip), r(R.hip)),
    capsule(P(pose.hip), r(R.pelvis), P(pose.shoulder), r(R.chest)),
    capsule(P(pose.shoulder), r(R.neck), P(pose.head), r(R.neck)),
    circle(P(pose.head), r(R.head)),
  ];
  const arm = [capsule(P(pose.shoulder), r(R.shoulder), P(pose.elbow), r(R.elbow)), capsule(P(pose.elbow), r(R.elbow), P(pose.hand), r(R.wrist))].join(" ");
  return (
    <g opacity={opacity}>
      {body.map((d, i) => (
        <path key={i} d={d} style={{ fill }} />
      ))}
      {arms && <path d={arm} style={{ fill, stroke: C.gap, paintOrder: "stroke" }} strokeWidth={2.6} strokeLinejoin="round" />}
    </g>
  );
}

/** A plate seen from the side, behind the lifter (so the shins and arms still read). */
function Plate({ at, v, r = PLATE_R }: { at: Pt; v: View; r?: number }) {
  const c = toPx(at, v);
  return (
    <g>
      <circle cx={f1(c.x)} cy={f1(c.y)} r={f1(r * v.s)} style={{ fill: C.faint, stroke: C.sub }} strokeOpacity={0.55} strokeWidth={1.3} />
      <circle cx={f1(c.x)} cy={f1(c.y)} r={f1(0.04 * v.s)} style={{ fill: "none", stroke: C.sub }} strokeOpacity={0.45} strokeWidth={1} />
    </g>
  );
}

/** The end of the bar, with the same hairline gap so it reads on a body. */
function BarEnd({ at, c = C.ink, r = 4.4 }: { at: Pt; c?: string; r?: number }) {
  return <circle cx={f1(at.x)} cy={f1(at.y)} r={r} style={{ fill: c, stroke: C.gap, paintOrder: "stroke" }} strokeWidth={2.4} />;
}

function JointDot({ at, c }: { at: Pt; c: string }) {
  return <circle cx={f1(at.x)} cy={f1(at.y)} r={3.1} style={{ fill: c, stroke: C.gap, paintOrder: "stroke" }} strokeWidth={2.2} />;
}

/* ======================================================================
 * Squat
 * ==================================================================== */

const SQ: { s: number; floor: number; left: number; right: number } = { s: 205, floor: 176, left: 94, right: 254 };

function SquatScene({ pose, v, ghost, plumb = C.sub, plumbTo }: { pose: Pose; v: View; ghost?: Pose; plumb?: string; plumbTo?: number }) {
  const bar = toPx(pose.bar, v);
  return (
    <g>
      <Plumb x={bar.x} y0={bar.y - 12} y1={plumbTo ?? v.y} c={plumb} />
      {ghost && <Figure pose={ghost} v={v} opacity={0.2} />}
      <Figure pose={pose} v={v} />
      <BarEnd at={bar} />
    </g>
  );
}

/**
 * Hip and knee moment arms as dimension lines under the floor: each joint's
 * horizontal distance from the line straight down from the bar.
 */
function Levers({ pose, v, y, hip = C.accent }: { pose: Pose; v: View; y: number; hip?: string }) {
  const h = toPx(pose.hip, v);
  const k = toPx(pose.knee, v);
  const b = toPx(pose.bar, v).x;
  const tick = (x: number, c: string) => <line x1={f1(x)} y1={f1(y - 4)} x2={f1(x)} y2={f1(y + 4)} style={{ stroke: c }} strokeWidth={1.6} strokeLinecap="round" />;
  return (
    <g>
      <Plumb x={h.x} y0={h.y} y1={y} c={hip} />
      <Plumb x={k.x} y0={k.y} y1={y} />
      <line x1={f1(h.x)} y1={f1(y)} x2={f1(b)} y2={f1(y)} style={{ stroke: hip }} strokeWidth={2.6} strokeLinecap="round" />
      <line x1={f1(b)} y1={f1(y)} x2={f1(k.x)} y2={f1(y)} style={{ stroke: C.ink }} strokeWidth={2.6} strokeLinecap="round" />
      {tick(h.x, hip)}
      {tick(b, C.sub)}
      {tick(k.x, C.ink)}
      <JointDot at={h} c={hip} />
      <JointDot at={k} c={C.ink} />
      <T x={h.x - 7} y={y + 3.5} anchor="end" c={hip} size={10} weight={700}>hip</T>
      <T x={k.x + 7} y={y + 3.5} c={C.ink} size={10} weight={700}>knee</T>
    </g>
  );
}

function SquatLevers({ variant }: { variant: "build" | "lean" }) {
  const { s, floor } = SQ;
  const left = variant === "build" ? squatPose({ shank: 33, thighDeg: 7, thigh: 0.226, torso: 0.304 }) : squatPose({ shank: 34, thighDeg: 7 });
  const right = variant === "build" ? squatPose({ shank: 31, thighDeg: 7, thigh: 0.266, torso: 0.27 }) : squatPose({ shank: 27, thighDeg: 8 });
  const vl: View = { x: SQ.left, y: floor, s };
  const vr: View = { x: SQ.right, y: floor, s };
  const dim = floor + 12;
  return (
    <Svg label={visualLabel({ kind: "squat_torso", variant })} h={floor + 22}>
      {variant === "build" ? (
        <>
          <Head x={80} title="Shorter thighs" lines={["more upright,", "knees do more"]} />
          <Head x={240} title="Longer thighs" lines={["more lean,", "hips do more"]} />
        </>
      ) : (
        <>
          <Head x={80} title="Around 85%" lines={["bar over midfoot"]} />
          <Head x={240} title="Near max" lines={["a bit more lean,", "longer hip lever"]} c={C.accent} />
        </>
      )}
      <Divider y1={floor + 18} />
      <SquatScene pose={left} v={vl} plumbTo={dim} />
      <SquatScene pose={right} v={vr} plumbTo={dim} />
      <Floor y={floor} />
      <Levers pose={left} v={vl} y={dim} hip={variant === "lean" ? C.ink : C.accent} />
      <Levers pose={right} v={vr} y={dim} />
    </Svg>
  );
}

function SquatBalance() {
  const { s, floor } = SQ;
  const good = squatPose({ shank: 33, thighDeg: 7 });
  const bad = squatPose({ shank: 40, thighDeg: 3, heelUp: 13, barX: SEG.toe - 0.035 });
  const vl: View = { x: SQ.left, y: floor, s };
  const vr: View = { x: SQ.right - 6, y: floor, s };
  const heel = toPx(bad.heel, vr);
  const mid = toPx(pt(MIDFOOT, 0), vr).x;
  return (
    <Svg label={visualLabel({ kind: "squat_balance" })} h={floor + 8}>
      <Head x={80} title="Balanced" lines={["bar over midfoot,", "whole foot down"]} />
      <Head x={240} title="On the toes" lines={["bar over the toes,", "heels up"]} c={C.accent} />
      <Divider y1={floor} />
      <SquatScene pose={good} v={vl} />
      <SquatScene pose={bad} v={vr} plumb={C.accent} />
      <Plumb x={mid} y0={floor - 30} y1={floor} />
      <Arrow from={pt(heel.x - 9, floor - 1)} to={pt(heel.x - 9, heel.y - 4)} w={1.6} />
      <Floor y={floor} />
    </Svg>
  );
}

function SquatRise() {
  const { s, floor } = SQ;
  // both frames lift the hips the same amount (about 12% of height). Kept over midfoot, the bar rises
  // about as much when the chest comes up with them, and only a fifth of that when the torso tips over.
  const bottom = squatPose({ shank: 34, thighDeg: 8 });
  const together = squatPose({ shank: 26, thighDeg: -15 });
  const hipsFirst = squatPose({ shank: 8, thighDeg: -10.25 });
  const vl: View = { x: SQ.left + 4, y: floor, s };
  const vr: View = { x: SQ.right + 4, y: floor, s };
  const rise = (p: Pose, v: View, hipColor: string, barColor: string) => {
    const hb = toPx(bottom.hip, v);
    const hn = toPx(p.hip, v);
    const bb = toPx(bottom.bar, v);
    const bn = toPx(p.bar, v);
    const hx = Math.min(hb.x, hn.x) - R.hip * v.s - 9;
    const bx = Math.min(bb.x, bn.x) - 12;
    return (
      <g>
        <Arrow from={pt(hx, hb.y)} to={pt(hx, hn.y)} c={hipColor} />
        <T x={hx - 4} y={(hb.y + hn.y) / 2 + 3.5} anchor="end" c={hipColor} size={10} weight={700}>hips</T>
        <Arrow from={pt(bx, bb.y)} to={pt(bx, bn.y)} c={barColor} />
        <T x={bx - 4} y={(bb.y + bn.y) / 2 + 3.5} anchor="end" c={barColor} size={10} weight={700}>bar</T>
      </g>
    );
  };
  return (
    <Svg label={visualLabel({ kind: "squat_rise" })} h={floor + 8}>
      <Head x={80} title="Together" lines={["hips and chest", "rise as one"]} />
      <Head x={240} title="Hips first" lines={["hips rise,", "the bar barely moves"]} c={C.accent} />
      <Divider y1={floor} />
      <SquatScene pose={together} v={vl} ghost={bottom} />
      <SquatScene pose={hipsFirst} v={vr} ghost={bottom} />
      {rise(together, vl, C.ink, C.ink)}
      {rise(hipsFirst, vr, C.accent, C.ink)}
      <Floor y={floor} />
    </Svg>
  );
}

function SquatDepth() {
  const { s, floor } = SQ;
  const high = squatPose({ shank: 29, thighDeg: -11 });
  const deep = squatPose({ shank: 34, thighDeg: 11 });
  const vl: View = { x: SQ.left, y: floor, s };
  const vr: View = { x: SQ.right, y: floor, s };
  const marks = (p: Pose, v: View, ok: boolean) => {
    const d = unit(sub(p.knee, p.hip));
    const up = pt(-d.y, d.x);
    const crease = toPx(add(p.hip, mul(up, R.hip * 0.95)), v);
    const kneeTop = toPx(add(p.knee, pt(0, R.thighKnee)), v);
    const c = ok ? C.ink : C.accent;
    return (
      <g>
        <line x1={f1(crease.x - 22)} y1={f1(kneeTop.y)} x2={f1(kneeTop.x + 18)} y2={f1(kneeTop.y)} style={{ stroke: c }} strokeWidth={1.3} strokeDasharray="3 3" strokeLinecap="round" />
        <JointDot at={crease} c={c} />
      </g>
    );
  };
  return (
    <Svg label={visualLabel({ kind: "squat_depth" })} h={floor + 8}>
      <Head x={80} title="Above parallel" lines={["hip crease above", "the top of the knee"]} c={C.accent} />
      <Head x={240} title="Depth" lines={["hip crease below", "the top of the knee"]} />
      <Divider y1={floor} />
      <SquatScene pose={high} v={vl} />
      <SquatScene pose={deep} v={vr} />
      {marks(high, vl, false)}
      {marks(deep, vr, true)}
      <Floor y={floor} />
    </Svg>
  );
}

/* ======================================================================
 * Deadlift
 * ==================================================================== */

function PullScene({ pose, v, ghost }: { pose: Pose; v: View; ghost?: Pose | null }) {
  const mid = toPx(pt(MIDFOOT, 0), v).x;
  return (
    <g>
      <Plumb x={mid} y0={toPx(pose.shoulder, v).y - 12} y1={v.y} />
      <Plate at={pose.bar} v={v} />
      {ghost && <Figure pose={ghost} v={v} opacity={0.2} />}
      <Figure pose={pose} v={v} />
      <BarEnd at={toPx(pose.bar, v)} />
    </g>
  );
}

function DeadliftStart({ fault }: { fault: "hips_low" | "hips_high" | "bar_forward" }) {
  const s = 205;
  const floor = 180;
  const good = pullPose({ shank: 6, lead: 0.03 });
  const bad =
    fault === "hips_high"
      ? pullPose({ shank: 1, lead: 0.12 })
      : fault === "bar_forward"
        ? pullPose({ shank: 9, lead: 0.03, barX: SEG.toe - 0.02 })
        : pullPose({ shank: 15, lead: -0.035, barX: MIDFOOT + 0.018 });
  // when the start is too low the hips rise first, until the shoulders are over the bar
  const after = fault === "hips_low" ? pullPose({ shank: 6, lead: 0.03, barX: MIDFOOT + 0.018 }) : null;
  if (!good || !bad) return null;
  const vl: View = { x: 90, y: floor, s };
  const vr: View = { x: fault === "hips_high" ? 238 : 252, y: floor, s };
  const head =
    fault === "hips_high"
      ? { title: "Hips high", lines: ["back nearly flat,", "the back does more"] }
      : fault === "bar_forward"
        ? { title: "Bar over the toes", lines: ["bar away from the shins"] }
        : { title: "Too low", lines: ["shoulders behind the bar,", "so the hips rise first"] };
  return (
    <Svg label={visualLabel({ kind: "deadlift_start", fault })} h={floor + 8}>
      <Head x={80} title="Set" lines={["shoulders just", "over the bar"]} />
      <Head x={240} title={head.title} lines={head.lines} c={C.accent} />
      <Divider y1={floor} />
      <PullScene pose={good} v={vl} />
      <PullScene pose={bad} v={vr} ghost={after} />
      {after &&
        (() => {
          const a = toPx(bad.hip, vr);
          const b = toPx(after.hip, vr);
          const x = Math.min(a.x, b.x) - R.hip * s - 8;
          return <Arrow from={pt(x, a.y)} to={pt(x, b.y)} />;
        })()}
      <Floor y={floor} />
    </Svg>
  );
}

/** A standing lifter at lockout, bar in the hands. */
function lockoutBar(barX = MIDFOOT): Pt {
  const f = footAt(0);
  const knee = add(f.ankle, mul(tilt(1), SEG.shank));
  const hip = add(knee, mul(tilt(-3), SEG.thigh));
  const shoulder = add(hip, mul(tilt(-4), SEG.torso));
  const arm = SEG.upperArm + SEG.forearm + SEG.grip;
  return pt(barX, shoulder.y - Math.sqrt(Math.max(0, arm ** 2 - (barX - shoulder.x) ** 2)));
}

/** The bar's path from the floor (deadlift) or the hole (squat): straight over midfoot vs drifting forward. */
function PullPath({ lift }: { lift: "deadlift" | "squat" }) {
  const floor = 196;
  const s = lift === "deadlift" ? 215 : 172;
  const v: View = { x: 150, y: floor, s };
  const start = lift === "deadlift" ? pullPose({ shank: 6, lead: 0.03 }) : squatPose({ shank: 33, thighDeg: 7 });
  if (!start) return null;
  // the top: the bar in the hands standing (deadlift) or on the shoulders standing (squat)
  const topY = lift === "deadlift" ? lockoutBar().y : SEG.ankleH + SEG.shank + SEG.thigh + SEG.torso + 0.008;
  const a = toPx(start.bar, v);
  const b = toPx(pt(start.bar.x, topY), v);
  const span = a.y - b.y;
  const drift = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return pt(a.x + Math.sin(t * Math.PI * 0.9) * 30 * (1 - 0.25 * t), a.y - t * span);
  });
  return (
    <Svg label={visualLabel({ kind: "bar_path", lift })} h={floor + 8}>
      <Legend items={[{ label: lift === "deadlift" ? "Over midfoot, close to the legs" : "Over midfoot", c: C.ink }, { label: "Drifting forward: a longer lever", c: C.accent, dash: true }]} />
      <Plumb x={toPx(pt(MIDFOOT, 0), v).x} y0={b.y - 12} y1={floor} />
      {lift === "deadlift" && <Plate at={start.bar} v={v} />}
      <Figure pose={start} v={v} opacity={0.26} />
      <path d={smooth(drift)} fill="none" style={{ stroke: C.accent }} strokeWidth={2.4} strokeDasharray="5 4" strokeLinecap="round" />
      <line x1={f1(a.x)} y1={f1(a.y)} x2={f1(b.x)} y2={f1(b.y)} style={{ stroke: C.ink }} strokeWidth={2.6} strokeLinecap="round" />
      <BarEnd at={a} />
      <BarEnd at={b} />
      <BarEnd at={drift[drift.length - 1]} c={C.accent} />
      <T x={b.x - 10} y={b.y + 4} anchor="end" c={C.ink} size={10} weight={700}>{lift === "deadlift" ? "lockout" : "standing"}</T>
      <Floor y={floor} />
    </Svg>
  );
}

/* ======================================================================
 * Bench (side view, lying, head on the left)
 * ==================================================================== */

const BENCH_TOP = 0.245;

type BenchBody = { S: Pt; hip: Pt; knee: Pt; heel: Pt; toe: Pt; ankle: Pt; headC: Pt; outline: Pt[]; chest: Pt[] };

function benchBody(): BenchBody {
  const T0 = BENCH_TOP;
  const S = pt(0.2, T0 + 0.065);
  const hip = pt(S.x + 0.285, T0 + 0.06);
  const knee = pt(hip.x + Math.sqrt(SEG.thigh ** 2 - 0.03 ** 2), hip.y - 0.03);
  const drop = knee.y - SEG.ankleH;
  const ankle = pt(knee.x - Math.sqrt(Math.max(0, SEG.shank ** 2 - drop ** 2)), SEG.ankleH);
  const heel = pt(ankle.x - SEG.heel, 0);
  const toe = pt(ankle.x + SEG.toe, 0);
  const headC = pt(S.x - 0.118, T0 + R.head + 0.002);
  // the chest's top line, neck to hip: an arch lifts the lower chest
  const chest = [
    pt(S.x - 0.065, T0 + 0.08),
    pt(S.x - 0.01, T0 + 0.135),
    pt(S.x + 0.065, T0 + 0.158),
    pt(S.x + 0.135, T0 + 0.148),
    pt(S.x + 0.215, T0 + 0.112),
    pt(hip.x + 0.05, T0 + 0.098),
  ];
  // the back on the pad: upper back pinned, lower back arched off, glutes down
  const outline = [pt(S.x - 0.07, T0 + 0.012), pt(S.x + 0.06, T0), pt(S.x + 0.18, T0 + 0.03), pt(hip.x - 0.005, T0), pt(hip.x + 0.055, T0 + 0.03), ...chest.slice().reverse()];
  return { S, hip, knee, heel, toe, ankle, headC, outline, chest };
}

/** The chest's height at x (where the bar lands). */
function chestY(b: BenchBody, x: number): number {
  const c = b.chest;
  for (let i = 0; i < c.length - 1; i++) {
    if (x >= c[i].x && x <= c[i + 1].x) {
      const t = (x - c[i].x) / (c[i + 1].x - c[i].x);
      const e = (1 - Math.cos(t * Math.PI)) / 2;
      return c[i].y + (c[i + 1].y - c[i].y) * e;
    }
  }
  return c[c.length - 1].y;
}

type BenchArm = { bar: Pt; elbow: Pt };

/**
 * The bottom of a bench with the forearm stacked straight under the bar.
 * `upper` is how long the upper arm looks from the side: tucked toward the
 * ribs it looks long (lower touch), flared out it looks short (higher touch).
 */
function benchBottom(b: BenchBody, upper: number): BenchArm {
  const reach = SEG.forearm + SEG.grip + 0.008;
  let lo = b.S.x;
  let hi = b.S.x + 0.3;
  const elbowAt = (x: number) => pt(x, chestY(b, x) + 0.01 - reach);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (len(sub(elbowAt(m), b.S)) < upper) lo = m;
    else hi = m;
  }
  const x = (lo + hi) / 2;
  return { bar: pt(x, chestY(b, x) + 0.01), elbow: elbowAt(x) };
}

function benchLockout(b: BenchBody): BenchArm {
  const arm = SEG.upperArm + SEG.forearm + SEG.grip;
  const bar = pt(b.S.x + 0.004, b.S.y + arm);
  return { bar, elbow: add(b.S, mul(unit(sub(bar, b.S)), SEG.upperArm)) };
}

function BenchArmPath({ b, a, v, opacity }: { b: BenchBody; a: BenchArm; v: View; opacity?: number }) {
  const P = (q: Pt) => toPx(q, v);
  const r = (n: number) => n * v.s;
  const d = [capsule(P(b.S), r(R.shoulder), P(a.elbow), r(R.elbow)), capsule(P(a.elbow), r(R.elbow), P(a.bar), r(R.wrist))].join(" ");
  return <path d={d} opacity={opacity} style={{ fill: C.body, stroke: C.gap, paintOrder: "stroke" }} strokeWidth={2.6} strokeLinejoin="round" />;
}

function BenchFigure({ b, v, arm, opacity }: { b: BenchBody; v: View; arm?: BenchArm | null; opacity?: number }) {
  const P = (q: Pt) => toPx(q, v);
  const r = (n: number) => n * v.s;
  return (
    <g opacity={opacity}>
      <g style={{ fill: C.body }}>
        <path d={smooth(b.outline.map(P), true)} />
        <path d={capsule(P(b.S), r(R.neck), P(b.headC), r(R.neck))} />
        <circle cx={f1(P(b.headC).x)} cy={f1(P(b.headC).y)} r={f1(r(R.head))} />
        <path d={capsule(P(b.hip), r(R.hip), P(b.knee), r(R.thighKnee))} />
        <path d={capsule(P(b.knee), r(R.knee), P(b.ankle), r(R.ankle))} />
        <path d={capsule(P(add(b.heel, pt(0.018, 0.018))), r(0.018), P(sub(b.toe, pt(0.01, -0.01))), r(0.01))} />
      </g>
      {arm && <BenchArmPath b={b} a={arm} v={v} />}
    </g>
  );
}

function Bench({ b, v }: { b: BenchBody; v: View }) {
  const P = (q: Pt) => toPx(q, v);
  const a = P(pt(b.S.x - 0.2, BENCH_TOP));
  const z = P(pt(b.hip.x + 0.17, BENCH_TOP - 0.042));
  const leg = (x: number) => {
    const t = P(pt(x, BENCH_TOP - 0.042));
    return <rect x={f1(t.x)} y={f1(t.y)} width={f1(0.026 * v.s)} height={f1(v.y - t.y)} rx={1.5} style={{ fill: C.faint, stroke: C.line }} strokeWidth={1} />;
  };
  return (
    <g>
      {leg(b.S.x - 0.13)}
      {leg(b.hip.x + 0.09)}
      <rect x={f1(a.x)} y={f1(a.y)} width={f1(z.x - a.x)} height={f1(z.y - a.y)} rx={3} style={{ fill: C.faint, stroke: C.line }} strokeWidth={1} />
    </g>
  );
}

const BN = { s: 178, floor: 150 };

/** Touch point and elbows move together: both forearms stacked, one tucked and low, one flared and high. */
function BenchTuckFlare() {
  const { s, floor } = BN;
  const b = benchBody();
  const tuck = benchBottom(b, 0.16);
  const flare = benchBottom(b, 0.094);
  const vl: View = { x: 4, y: floor, s };
  const vr: View = { x: 164, y: floor, s };
  const stack = (a: BenchArm, v: View) => {
    const top = toPx(a.bar, v);
    const el = toPx(a.elbow, v);
    return (
      <g>
        <Plumb x={top.x} y0={top.y - 16} y1={el.y + 10} c={C.accent} />
        <BarEnd at={top} />
      </g>
    );
  };
  return (
    <Svg label={visualLabel({ kind: "bench_touch" })} h={floor + 8}>
      <Head x={80} title="Lower touch" lines={["more tuck"]} />
      <Head x={240} title="Higher touch" lines={["more flare"]} />
      <Divider y1={floor} />
      <Bench b={b} v={vl} />
      <Bench b={b} v={vr} />
      <BenchFigure b={b} v={vl} arm={tuck} />
      <BenchFigure b={b} v={vr} arm={flare} />
      {stack(tuck, vl)}
      {stack(flare, vr)}
      <Floor y={floor} />
    </Svg>
  );
}

/** Same spot every rep vs a different spot each rep (and the elbows changing with it). */
function BenchConsistency() {
  const { s, floor } = BN;
  const b = benchBody();
  const same = [0.144, 0.147, 0.15].map((u) => benchBottom(b, u));
  const spread = [0.1, 0.128, 0.156].map((u) => benchBottom(b, u));
  const vl: View = { x: 4, y: floor, s };
  const vr: View = { x: 164, y: floor, s };
  // where each rep touched, as small marks on the chest
  const marks = (arms: BenchArm[], v: View, c: string) =>
    arms.map((a, i) => {
      const p = toPx(pt(a.bar.x, chestY(b, a.bar.x) + 0.004), v);
      return <circle key={i} cx={f1(p.x)} cy={f1(p.y)} r={3.2} style={{ fill: c, stroke: C.gap, paintOrder: "stroke" }} strokeWidth={2} />;
    });
  return (
    <Svg label={visualLabel({ kind: "bench_touch", variant: "consistency" })} h={floor + 8}>
      <Head x={80} title="Same spot" lines={["same elbows every rep"]} />
      <Head x={240} title="A different spot" lines={["elbows change,", "so the touch changes"]} c={C.accent} />
      <Divider y1={floor} />
      <Bench b={b} v={vl} />
      <Bench b={b} v={vr} />
      <BenchFigure b={b} v={vl} />
      <BenchFigure b={b} v={vr} />
      {same.map((a, i) => (
        <BenchArmPath key={i} b={b} a={a} v={vl} opacity={i === 1 ? 1 : 0.3} />
      ))}
      {spread.map((a, i) => (
        <BenchArmPath key={i} b={b} a={a} v={vr} opacity={0.3 + 0.35 * i} />
      ))}
      {marks(same, vl, C.ink)}
      {marks(spread, vr, C.accent)}
      <Floor y={floor} />
    </Svg>
  );
}

/** Off the chest the bar travels up and back to lock out over the shoulder; drifting toward the feet leaves it over the chest. */
function BenchPath({ fault }: { fault: boolean }) {
  const floor = 196;
  const s = 205;
  const b = benchBody();
  const v: View = { x: 70, y: floor, s };
  const bottom = benchBottom(b, 0.14);
  const lock = benchLockout(b);
  const P = (q: Pt) => toPx(q, v);
  const t0 = P(bottom.bar);
  const t1 = P(lock.bar);
  const j = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    const back = 1 - (1 - Math.min(1, t / 0.7)) ** 2;
    return pt(t0.x + (t1.x - t0.x) * back, t0.y + (t1.y - t0.y) * t);
  });
  const drift = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return pt(t0.x + 0.03 * s * Math.sin(t * Math.PI * 0.55), t0.y + (t1.y - t0.y) * t);
  });
  const sh = P(b.S);
  return (
    <Svg label={visualLabel({ kind: "bar_path", lift: "bench", fault: fault ? "forward" : "none" })} h={floor + 8}>
      <Legend
        items={[
          { label: "Up and back, over the shoulder", c: C.ink },
          ...(fault ? [{ label: "Finishing over the chest", c: C.accent, dash: true }] : []),
        ]}
      />
      <Bench b={b} v={v} />
      <Plumb x={sh.x} y0={t1.y - 12} y1={sh.y} />
      <BenchFigure b={b} v={v} arm={lock} opacity={0.2} />
      <BenchFigure b={b} v={v} arm={bottom} />
      {fault && <path d={smooth(drift)} fill="none" style={{ stroke: C.accent }} strokeWidth={2.4} strokeDasharray="5 4" strokeLinecap="round" />}
      <path d={smooth(j)} fill="none" style={{ stroke: C.ink }} strokeWidth={2.6} strokeLinecap="round" />
      <BarEnd at={t0} />
      <BarEnd at={t1} />
      {fault && <BarEnd at={drift[drift.length - 1]} c={C.accent} />}
      <T x={sh.x - 9} y={t1.y + 4} anchor="end" c={C.ink} size={10} weight={700}>lockout</T>
      <T x={t0.x + 8} y={t0.y - 7} c={C.ink} size={10} weight={700}>touch</T>
      <Floor y={floor} />
    </Svg>
  );
}

/* ======================================================================
 * Charts: one quiet baseline, direct labels, red only where it matters
 * ==================================================================== */

const BOX = { x0: 14, x1: 306, y0: 138, y1: 34 };
const CH = 166;

function Chart({ label, y, ends, children }: { label: string; y: string; ends: [string, string]; children: ReactNode }) {
  return (
    <Svg label={label} h={CH}>
      <T x={BOX.x0} y={14} size={10.5} weight={700} c={C.sub}>{y}</T>
      {children}
      <line x1={BOX.x0} y1={BOX.y0} x2={BOX.x1} y2={BOX.y0} style={{ stroke: C.line }} strokeWidth={1.5} strokeLinecap="round" />
      <T x={BOX.x0} y={BOX.y0 + 17} size={10}>{ends[0]}</T>
      <T x={BOX.x1} y={BOX.y0 + 17} anchor="end" size={10}>{ends[1]}</T>
    </Svg>
  );
}

/** f(t), t in 0..1, value 0..1 (up), across the chart box. */
function plot(f: (t: number) => number, n = 48, top = BOX.y1, x0 = BOX.x0, x1 = BOX.x1): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return pt(x0 + t * (x1 - x0), BOX.y0 - Math.max(0, Math.min(1.04, f(t))) * (BOX.y0 - top));
  });
}

function Curve({ pts, c = C.ink, w = 2.6, dash }: { pts: Pt[]; c?: string; w?: number; dash?: string }) {
  return <path d={smooth(pts)} fill="none" style={{ stroke: c }} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />;
}

/** A soft fill under a curve, fading to nothing at the baseline. */
function Area({ pts, c = C.accent }: { pts: Pt[]; c?: string }) {
  const id = `lv${useId().replace(/:/g, "")}`;
  const d = `${smooth(pts)} L${f1(pts[pts.length - 1].x)} ${BOX.y0} L${f1(pts[0].x)} ${BOX.y0} Z`;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: c, stopOpacity: 0.09 }} />
          <stop offset="1" style={{ stopColor: c, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={d} style={{ fill: `url(#${id})` }} />
    </g>
  );
}

const yAt = (pts: Pt[], x: number) => {
  for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i].x && x <= pts[i + 1].x) return pts[i].y + ((pts[i + 1].y - pts[i].y) * (x - pts[i].x)) / (pts[i + 1].x - pts[i].x);
  return pts[pts.length - 1].y;
};

function StickingPoint({ lift }: { lift: LessonLift }) {
  const ends: Record<LessonLift, [string, string]> = { squat: ["Bottom", "Lockout"], bench: ["Chest", "Lockout"], deadlift: ["Floor", "Lockout"] };
  const dip = lift === "deadlift" ? 0.42 : lift === "squat" ? 0.3 : 0.32;
  // speed builds off the bottom, sags through the sticking region, then slows to a stop at lockout
  const f = (t: number) => Math.sin(Math.PI * t) ** 0.7 * (1 - 0.62 * Math.exp(-((t - dip) ** 2) / 0.0095)) * 0.93;
  const pts = plot(f, 64);
  const a = BOX.x0 + (dip - 0.1) * (BOX.x1 - BOX.x0);
  const b = BOX.x0 + (dip + 0.1) * (BOX.x1 - BOX.x0);
  return (
    <Chart label={visualLabel({ kind: "sticking_point", lift })} y="Bar speed" ends={ends[lift]}>
      <rect x={f1(a)} y={BOX.y1 - 6} width={f1(b - a)} height={BOX.y0 - BOX.y1 + 6} rx={6} style={{ fill: C.soft }} />
      <T x={(a + b) / 2} y={BOX.y1 + 6} anchor="middle" c={C.accent} size={10} weight={700}>{lift === "deadlift" ? "around the knees" : "sticking region"}</T>
      <Area pts={pts} c={C.ink} />
      <Curve pts={pts} />
    </Chart>
  );
}

function StrengthCurve({ shape }: { shape: string }) {
  const f =
    shape === "descending"
      ? (t: number) => 0.9 - 0.55 * t
      : shape === "bell"
        ? (t: number) => 0.3 + 0.62 * Math.sin(Math.PI * t)
        : (t: number) => 0.3 + 0.62 * t ** 1.3;
  const pts = plot(f);
  const name = shape === "descending" ? "strongest at the start" : shape === "bell" ? "strongest mid range" : "strongest near lockout";
  return (
    <Chart label={visualLabel({ kind: "strength_curve" })} y="Force you can make" ends={["Start", "End of the range"]}>
      <Area pts={pts} c={C.ink} />
      <Curve pts={pts} />
      <T x={BOX.x1} y={BOX.y1 - 4} anchor="end" c={C.ink} size={10.5} weight={700}>{name}</T>
    </Chart>
  );
}

function LengthTension() {
  const f = (t: number) => Math.max(0.06, Math.exp(-((t - 0.47) ** 2) / 0.045) * 0.94);
  const pts = plot(f);
  const peak = BOX.x0 + 0.47 * (BOX.x1 - BOX.x0);
  return (
    <Chart label={visualLabel({ kind: "length_tension" })} y="Force" ends={["Short", "Long (stretched)"]}>
      <Area pts={pts} c={C.ink} />
      <Curve pts={pts} />
      <T x={peak} y={BOX.y1 - 4} anchor="middle" c={C.ink} size={10.5} weight={700}>most force in the middle</T>
    </Chart>
  );
}

function ForceVelocity() {
  const a = 0.25;
  const force = (vv: number) => Math.max(0, ((1 + a) / (vv + a)) * a - a);
  const pts = plot((t) => force(t) * 0.94);
  const power = (vv: number) => force(vv) * vv;
  const pmax = Math.max(...Array.from({ length: 101 }, (_, i) => power(i / 100)));
  const pow = plot((t) => (power(t) / pmax) * 0.5);
  const peak = pow.reduce((m, p) => (p.y < m.y ? p : m), pow[0]);
  return (
    <Chart label={visualLabel({ kind: "force_velocity" })} y="Force" ends={["Slow", "Fast"]}>
      <Curve pts={pow} c={C.accent} w={2.2} dash="5 4" />
      <Curve pts={pts} />
      <T x={BOX.x0 + 16} y={BOX.y1 + 6} c={C.ink} size={10.5} weight={700}>heavy = slow</T>
      <T x={BOX.x1} y={BOX.y0 - 30} anchor="end" c={C.ink} size={10.5} weight={700}>light = fast</T>
      <T x={peak.x + 8} y={peak.y - 7} c={C.accent} size={10.5} weight={700}>power peaks in between</T>
    </Chart>
  );
}

/**
 * Banister's model: fitness builds slowly and fades slowly, fatigue builds and
 * fades fast. Performance = fitness − fatigue, so it comes up in a taper.
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

/** Labels at the right edge, nudged apart so they never touch. */
function spread(ys: number[], gap = 13): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((p, q) => p.y - q.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out = [...ys];
  for (const o of order) out[o.i] = o.y;
  return out;
}

function FitnessFatigue() {
  const days = 42;
  const hard = 30;
  const { fit, fat, perf } = banister(days, hard);
  const top = Math.max(...fit, ...fat);
  const low = Math.min(...perf, 0);
  const x1 = BOX.x1 - 78;
  const y = (val: number) => BOX.y0 - ((val - low) / (top - low)) * (BOX.y0 - BOX.y1);
  const xs = (i: number) => BOX.x0 + (i / (days - 1)) * (x1 - BOX.x0);
  const line = (arr: number[]) => arr.map((val, i) => pt(xs(i), y(val)));
  const taper = xs(hard);
  const ends = spread([y(fit[days - 1]), y(fat[days - 1]), y(perf[days - 1])]);
  return (
    <Chart label={visualLabel({ kind: "fitness_fatigue" })} y="Training effect" ends={["Hard training", ""]}>
      <rect x={f1(taper)} y={BOX.y1 - 6} width={f1(x1 - taper + 4)} height={BOX.y0 - BOX.y1 + 6} rx={6} style={{ fill: C.faint }} />
      <T x={(taper + x1) / 2 + 2} y={BOX.y0 + 17} anchor="middle" size={10}>Taper</T>
      <Curve pts={line(fat)} c={C.sub} w={2} dash="4 4" />
      <Curve pts={line(fit)} />
      <Curve pts={line(perf)} c={C.accent} w={2.8} />
      <T x={x1 + 10} y={ends[0] + 3.5} c={C.ink} size={10.5} weight={700}>Fitness</T>
      <T x={x1 + 10} y={ends[1] + 3.5} size={10.5} weight={700}>Fatigue</T>
      <T x={x1 + 10} y={ends[2] + 3.5} c={C.accent} size={10.5} weight={700}>Performance</T>
    </Chart>
  );
}

function Sra({ stress }: { stress: boolean }) {
  const base = 0.55;
  const f = (t: number, slow = 1) => {
    const tt = t / slow;
    const dip = -0.3 * Math.exp(-(((tt - 0.16) / 0.11) ** 2));
    const up = 0.15 * Math.exp(-(((tt - 0.6) / 0.17) ** 2));
    return base + dip + up;
  };
  const pts = plot((t) => f(t));
  const slowPts = plot((t) => f(t, 1.45) - (t > 0.4 ? 0.02 : 0));
  const baseY = BOX.y0 - base * (BOX.y0 - BOX.y1);
  const dipX = BOX.x0 + 0.16 * (BOX.x1 - BOX.x0);
  const peakX = BOX.x0 + 0.6 * (BOX.x1 - BOX.x0);
  return (
    <Chart label={visualLabel({ kind: "sra", variant: stress ? "stress" : undefined })} y="Performance" ends={["Workout", "Days after"]}>
      {stress && <Legend items={[{ label: "Normal week", c: C.ink }, { label: "Stressful week: slower", c: C.accent, dash: true }]} x={BOX.x1 - 150} y={13} />}
      <line x1={BOX.x0} y1={f1(baseY)} x2={BOX.x1} y2={f1(baseY)} style={{ stroke: C.line }} strokeWidth={1.1} strokeDasharray="3 4" />
      <T x={BOX.x1} y={baseY + 13} anchor="end" size={9.5}>where you started</T>
      {stress && <Curve pts={slowPts} c={C.accent} w={2.2} dash="5 4" />}
      <Curve pts={pts} />
      <T x={dipX} y={yAt(pts, dipX) + 16} anchor="middle" c={C.ink} size={10.5} weight={700}>recovery</T>
      <T x={peakX} y={yAt(pts, peakX) - 9} anchor="middle" c={C.ink} size={10.5} weight={700}>adaptation</T>
    </Chart>
  );
}

function RpeRir() {
  const rows = [
    { rpe: "10", left: 0, text: "nothing left" },
    { rpe: "9", left: 1, text: "1 rep left" },
    { rpe: "8", left: 2, text: "2 reps left" },
    { rpe: "7", left: 3, text: "3 reps left" },
    { rpe: "6", left: 4, text: "4 or more left" },
  ];
  return (
    <Svg label={visualLabel({ kind: "rpe_rir" })} h={150}>
      <T x={16} y={13} size={9.5} weight={800} caps>RPE</T>
      <T x={66} y={13} size={9.5} weight={800} caps>Reps left in the tank</T>
      {rows.map((r, i) => {
        const y = 36 + i * 25;
        return (
          <g key={r.rpe}>
            {i > 0 && <line x1={14} y1={y - 15} x2={306} y2={y - 15} style={{ stroke: C.line }} strokeWidth={1} opacity={0.6} />}
            <T x={16} y={y + 5} c={i === 0 ? C.accent : C.ink} size={17} weight={800}>{r.rpe}</T>
            {r.left === 0 ? (
              <circle cx={72} cy={y} r={5} style={{ fill: "none", stroke: C.accent }} strokeWidth={1.6} />
            ) : (
              Array.from({ length: r.left }, (_, k) => <circle key={k} cx={72 + k * 15} cy={y} r={5} style={{ fill: C.ink }} />)
            )}
            <T x={r.left >= 4 ? 140 : 72 + Math.max(1, r.left) * 15 + 6} y={y + 4} c={i === 0 ? C.accent : C.sub} size={11} weight={i === 0 ? 700 : 600}>{r.text}</T>
          </g>
        );
      })}
    </Svg>
  );
}

function DoseResponse() {
  const f = (t: number) => 0.9 * (1 - Math.exp(-3.1 * t)) + 0.04;
  const pts = plot(f);
  const dots = [0.18, 0.38, 0.6, 0.85].map((t) => pts[Math.round(t * (pts.length - 1))]);
  return (
    <Chart label={visualLabel({ kind: "dose_response" })} y="Growth" ends={["Fewer sets", "More sets a week"]}>
      <Area pts={pts} c={C.ink} />
      <Curve pts={pts} />
      {dots.map((p, i) => (
        <circle key={i} cx={f1(p.x)} cy={f1(p.y)} r={3.6} style={{ fill: i === dots.length - 1 ? C.accent : C.ink }} />
      ))}
      <T x={dots[0].x + 10} y={dots[0].y + 14} c={C.ink} size={10.5} weight={700}>more sets, more growth</T>
      <T x={dots[3].x} y={dots[3].y - 11} anchor="end" c={C.accent} size={10.5} weight={700}>each step adds less</T>
    </Chart>
  );
}

function Bars({ values, x0, x1, top = BOX.y1, red = () => false, gap = 6 }: { values: number[]; x0: number; x1: number; top?: number; red?: (i: number) => boolean; gap?: number }) {
  const w = (x1 - x0 - gap * (values.length - 1)) / values.length;
  return (
    <g>
      {values.map((val, i) => {
        const h = val * (BOX.y0 - top);
        return <rect key={i} x={f1(x0 + i * (w + gap))} y={f1(BOX.y0 - h)} width={f1(w)} height={f1(h)} rx={Math.min(5, w / 3)} style={{ fill: red(i) ? C.accent : C.body }} opacity={red(i) ? 1 : 0.85} />;
      })}
    </g>
  );
}

function VelocityLoss() {
  const vals = [1, 0.97, 0.93, 0.87, 0.8, 0.71, 0.59, 0.45];
  return (
    <Chart label={visualLabel({ kind: "velocity_loss" })} y="Rep speed" ends={["Rep 1", ""]}>
      <Bars values={vals} x0={BOX.x0} x1={BOX.x1} top={BOX.y1 + 4} red={(i) => i >= 6} gap={8} />
      <T x={BOX.x1} y={BOX.y0 + 17} anchor="end" c={C.accent} size={10} weight={700}>close to failure</T>
    </Chart>
  );
}

function ClusterSets() {
  const straight = [1, 0.94, 0.86, 0.77, 0.66];
  const cluster = [1, 0.98, 0.97, 0.96, 0.94];
  const mid = (BOX.x0 + BOX.x1) / 2;
  return (
    <Chart label={visualLabel({ kind: "velocity_loss", variant: "cluster" })} y="Rep speed" ends={["Straight set", "Singles, short rests"]}>
      <Bars values={straight} x0={BOX.x0} x1={mid - 14} top={BOX.y1 + 4} red={(i) => i >= 3} gap={5} />
      <Bars values={cluster} x0={mid + 14} x1={BOX.x1} top={BOX.y1 + 4} gap={12} />
      <line x1={mid} y1={BOX.y1} x2={mid} y2={BOX.y0} style={{ stroke: C.line }} strokeWidth={1} />
    </Chart>
  );
}

function MyoReps() {
  const reps = [15, 4, 4, 4, 3];
  const max = 16;
  const top = BOX.y1 + 6;
  const x0 = BOX.x0 + 4;
  const wBig = 54;
  const w = 30;
  const gap = 26;
  const xs = [x0, x0 + wBig + gap + 8];
  for (let i = 2; i < reps.length; i++) xs.push(xs[i - 1] + w + gap);
  const h = (r: number) => (r / max) * (BOX.y0 - top);
  return (
    <Chart label={visualLabel({ kind: "set_structure" })} y="Reps" ends={["", ""]}>
      {reps.map((r, i) => {
        const bw = i === 0 ? wBig : w;
        const last = i === reps.length - 1;
        return (
          <g key={i}>
            <rect x={f1(xs[i])} y={f1(BOX.y0 - h(r))} width={bw} height={f1(h(r))} rx={6} style={{ fill: last ? C.accent : C.body }} opacity={last ? 1 : 0.85} />
            <T x={xs[i] + bw / 2} y={BOX.y0 - h(r) - 6} anchor="middle" c={last ? C.accent : C.ink} size={12} weight={800}>{String(r)}</T>
          </g>
        );
      })}
      {reps.slice(1).map((_, i) => {
        const a = xs[i] + (i === 0 ? wBig : w);
        const b = xs[i + 1];
        return <line key={i} x1={f1(a + 5)} y1={BOX.y0 - 8} x2={f1(b - 5)} y2={BOX.y0 - 8} style={{ stroke: C.sub }} strokeWidth={1.4} strokeDasharray="1.5 3.5" strokeLinecap="round" />;
      })}
      <T x={xs[0] + wBig / 2} y={BOX.y0 + 17} anchor="middle" size={10}>Activation set</T>
      <T x={(xs[1] + xs[3] + w) / 2} y={BOX.y0 + 17} anchor="middle" size={10}>3–5 breaths, then mini sets</T>
      <T x={xs[4] + w} y={BOX.y0 - h(3) - 32} anchor="end" c={C.accent} size={10} weight={700}>can't match 4,</T>
      <T x={xs[4] + w} y={BOX.y0 - h(3) - 20} anchor="end" c={C.accent} size={10} weight={700}>so stop</T>
    </Chart>
  );
}

/** The body solvers, for tests: every position drawn has to be one a lifter could hold. */
export const lessonGeometry = { SEG, MIDFOOT, PLATE_R, squatPose, pullPose, benchBody, benchBottom, chestY };
