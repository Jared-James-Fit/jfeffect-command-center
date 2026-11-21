/**
 * A set filmed on a propped phone, drawn small: the test bench for the lift
 * finder (lift-window.ts). Not a physics engine, only what a 64 px greyscale
 * frame shows of a gym: a low camera looking up a little, a lifter who walks
 * from the lens to the bar (huge, then small), sets up, lifts and walks back,
 * and the things that confuse a motion read: other people (crossing, standing
 * around, lifting at their own station), dark clothes on a dark wall, the
 * phone re-exposing, a platform that shakes, sensor noise.
 *
 * Everything is seeded, so a failing scene can be drawn again.
 */

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (k: number) => {
  const c = clamp(k, 0, 1);
  return c * c * (3 - 2 * c);
};

export type LiftKind = "deadlift" | "squat" | "bench" | "accessory";

/** Body heights (m) for a pose: where the hips, shoulders, head, hands and the bar are. */
type Pose = { hip: number; shoulder: number; head: number; hands: number; lean: number; bar: number | null; lying?: boolean };
const STAND: Pose = { hip: 0.95, shoulder: 1.45, head: 1.62, hands: 0.8, lean: 0, bar: null };
const mix = (a: Pose, b: Pose, k: number): Pose => ({
  hip: lerp(a.hip, b.hip, k),
  shoulder: lerp(a.shoulder, b.shoulder, k),
  head: lerp(a.head, b.head, k),
  hands: lerp(a.hands, b.hands, k),
  lean: lerp(a.lean, b.lean, k),
  bar: a.bar == null || b.bar == null ? (k < 0.5 ? a.bar : b.bar) : lerp(a.bar, b.bar, k),
  lying: k < 0.5 ? a.lying : b.lying,
});

type Look = { shirt: number; shorts: number; skin: number; shoes: number; hair: number; longPants: boolean };
type ActorState = { x: number; z: number; pose: Pose; stride: number; look: Look; plates: number | null; reach?: number };

/** What a clip holds, with the times a good trim has to respect. */
export type SceneTruth = {
  /** They reach the bar (the walk from the phone is over). */
  arrive: number;
  /** The last movement into position starts (bending to the bar, getting under it, lying back). */
  setup: number;
  /** The first rep starts and the last one ends (bar down or racked). */
  firstRep: number;
  lastRep: number;
  /** They leave the bar for the phone (or the clip ends). */
  leave: number;
};

export type SceneOptions = {
  seed: number;
  lift?: LiftKind;
  reps?: number;
  /** Seconds a rep takes, and the pause between reps. */
  repSeconds?: number;
  repPause?: number;
  /** Filmed by themselves (walks to and from the phone) or by someone else (no walks). */
  selfFilmed?: boolean;
  /** Seconds at the bar before the setup starts (chalk, psyching up), and after the last rep before leaving. */
  waitBefore?: number;
  waitAfter?: number;
  /** How far the bar is from the lens (m). */
  distance?: number;
  /** Camera height (m): on the floor, a bench, a tripod. */
  cameraHeight?: number;
  /** Others in the gym. */
  crossers?: number;
  loiterers?: number;
  otherLifters?: number;
  /** A dark gym with dark clothes (the hard case) or a bright one. */
  dark?: boolean;
  /** The platform shakes the phone when the bar lands. */
  shake?: boolean;
  /** Held in a hand the whole time. */
  handheld?: boolean;
  landscape?: boolean;
  /** The phone is picked up before recording stops (the picture swings). */
  pickedUp?: boolean;
  /** Seconds of nothing after pressing record before they walk off, and standing at the phone at the end. */
  idleStart?: number;
  noise?: number;
};

export type Scene = {
  w: number;
  h: number;
  duration: number;
  truth: SceneTruth;
  options: Required<SceneOptions>;
  frame(t: number): Uint8Array;
};

const SS = 2; // drawn at twice the size, then averaged down

type Painter = {
  W: number;
  H: number;
  buf: Float32Array;
  rect(x0: number, y0: number, x1: number, y1: number, v: number): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, v: number): void;
};
function painter(W: number, H: number, buf: Float32Array): Painter {
  return {
    W,
    H,
    buf,
    rect(x0, y0, x1, y1, v) {
      const ax = Math.max(0, Math.floor(Math.min(x0, x1)));
      const bx = Math.min(W, Math.ceil(Math.max(x0, x1)));
      const ay = Math.max(0, Math.floor(Math.min(y0, y1)));
      const by = Math.min(H, Math.ceil(Math.max(y0, y1)));
      for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) buf[y * W + x] = v;
    },
    ellipse(cx, cy, rx, ry, v) {
      const ax = Math.max(0, Math.floor(cx - rx));
      const bx = Math.min(W, Math.ceil(cx + rx));
      const ay = Math.max(0, Math.floor(cy - ry));
      const by = Math.min(H, Math.ceil(cy + ry));
      for (let y = ay; y < by; y++)
        for (let x = ax; x < bx; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) buf[y * W + x] = v;
        }
    },
  };
}

/** The lift's pose over one rep (k 0→1: down and up, or up and down) and at rest. */
function liftPoses(kind: LiftKind): { rest: Pose; ready: Pose; a: Pose; b: Pose } {
  if (kind === "deadlift") {
    const bottom: Pose = { hip: 0.82, shoulder: 0.98, head: 1.06, hands: 0.24, lean: 0.32, bar: 0.225 };
    const top: Pose = { hip: 0.95, shoulder: 1.45, head: 1.62, hands: 0.74, lean: 0, bar: 0.74 };
    return { rest: { ...STAND, bar: 0.225 }, ready: bottom, a: bottom, b: top };
  }
  if (kind === "squat") {
    const top: Pose = { hip: 0.95, shoulder: 1.42, head: 1.6, hands: 1.4, lean: 0.05, bar: 1.42 };
    const bottom: Pose = { hip: 0.52, shoulder: 1.0, head: 1.16, hands: 0.98, lean: 0.22, bar: 1.0 };
    return { rest: { ...STAND, bar: 1.45 }, ready: top, a: top, b: bottom };
  }
  if (kind === "bench") {
    const up: Pose = { hip: 0.45, shoulder: 0.5, head: 0.55, hands: 1.0, lean: 0, bar: 1.0, lying: true };
    const down: Pose = { hip: 0.45, shoulder: 0.5, head: 0.55, hands: 0.66, lean: 0, bar: 0.66, lying: true };
    return { rest: { hip: 0.5, shoulder: 1.0, head: 1.17, hands: 0.6, lean: 0, bar: 1.05 }, ready: up, a: up, b: down };
  }
  // an accessory: dumbbells curled or pressed, standing
  const lo: Pose = { ...STAND, hands: 0.8, bar: null };
  const hi: Pose = { ...STAND, hands: 1.35, bar: null };
  return { rest: STAND, ready: lo, a: lo, b: hi };
}

export function buildScene(opts: SceneOptions): Scene {
  const r = rng(opts.seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const between = (a: number, b: number) => a + (b - a) * r();
  const o: Required<SceneOptions> = {
    seed: opts.seed,
    lift: opts.lift ?? pick<LiftKind>(["deadlift", "squat", "bench", "accessory"]),
    reps: opts.reps ?? 1 + Math.floor(r() * 8),
    repSeconds: opts.repSeconds ?? between(1.8, 3.6),
    repPause: opts.repPause ?? between(0.2, 2.5),
    selfFilmed: opts.selfFilmed ?? true,
    waitBefore: opts.waitBefore ?? between(0, 12),
    waitAfter: opts.waitAfter ?? between(0, 3),
    distance: opts.distance ?? between(2.4, 4.6),
    cameraHeight: opts.cameraHeight ?? pick([0.12, 0.15, 0.5, 1.0]),
    crossers: opts.crossers ?? Math.floor(r() * 3),
    loiterers: opts.loiterers ?? Math.floor(r() * 2),
    otherLifters: opts.otherLifters ?? Math.floor(r() * 2),
    dark: opts.dark ?? r() < 0.5,
    shake: opts.shake ?? r() < 0.3,
    handheld: opts.handheld ?? false,
    landscape: opts.landscape ?? false,
    pickedUp: opts.pickedUp ?? r() < 0.5,
    idleStart: opts.idleStart ?? between(0, 1.2),
    noise: opts.noise ?? 1.5,
  };
  // a long breath between heavy reps now and then, on the big lifts only
  if (opts.repPause == null && o.lift !== "accessory" && r() < 0.15) o.repPause = between(3.5, 8);
  const w = o.landscape ? 64 : 36;
  const h = o.landscape ? 36 : 64;
  const W = w * SS;
  const H = h * SS;
  // the camera: focal length in frame heights (a phone's main lens), tilted up more the lower it sits
  const f = (o.landscape ? 1.25 : 0.8) * H;
  const horizon = H * (o.cameraHeight < 0.3 ? between(0.66, 0.8) : o.cameraHeight < 0.8 ? between(0.55, 0.68) : between(0.45, 0.58));
  const cx = W / 2;
  const project = (x: number, y: number, z: number) => ({ sx: cx + (f * x) / z, sy: horizon - (f * (y - o.cameraHeight)) / z, s: f / z });

  /* ---- the gym ---- */
  const wall = o.dark ? between(28, 55) : between(120, 190);
  const floor = o.dark ? pick([60, 165, 175]) : between(90, 150);
  const strips = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ y: between(0.05, 0.4) * H, slope: between(-0.25, 0.25), th: between(0.008, 0.02) * H }));
  const posters = Array.from({ length: 4 + Math.floor(r() * 5) }, () => ({ x: between(0, 1) * W, y: between(0.3, 0.62) * H, w: between(0.05, 0.22) * W, h: between(0.04, 0.14) * H, v: between(40, 215) }));
  const racks = Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ x: between(0, 1) * W, top: between(0.35, 0.55) * H, w: between(0.008, 0.02) * W, v: between(20, 120) }));
  const bg = new Float32Array(W * H);
  {
    const p = painter(W, H, bg);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const grain = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 13;
        bg[y * W + x] = (y > horizon ? floor + (y - horizon) * 0.05 : wall) + grain - 6;
      }
    for (const s of strips) for (let x = 0; x < W; x++) p.rect(x, s.y + s.slope * (x - cx), x + 1, s.y + s.slope * (x - cx) + s.th, o.dark ? 235 : 250);
    for (const q of posters) p.rect(q.x, q.y, q.x + q.w, q.y + q.h, q.v);
    for (const k of racks) p.rect(k.x, k.top, k.x + k.w, horizon + 0.02 * H, k.v);
    // the platform under the bar
    p.rect(cx - 0.3 * W, horizon + 0.01 * H, cx + 0.3 * W, horizon + 0.07 * H, o.dark ? 38 : 70);
  }

  /* ---- people ---- */
  const lookFor = (subject: boolean): Look => {
    const darkClothes = subject ? (o.dark ? r() < 0.75 : r() < 0.4) : r() < 0.6;
    return {
      shirt: darkClothes ? between(18, 40) : between(110, 230),
      shorts: r() < 0.7 ? between(18, 45) : between(90, 160),
      skin: between(120, 175),
      shoes: r() < 0.5 ? between(190, 240) : between(20, 60),
      hair: between(15, 70),
      longPants: r() < 0.3,
    };
  };

  /* ---- the subject's timeline ---- */
  const D = o.distance;
  const barX = between(-0.25, 0.25);
  const walkSpeed = between(1.0, 1.5);
  const walkSeconds = (D - 0.45) / walkSpeed;
  const poses = liftPoses(o.lift);
  const setupSeconds = o.lift === "squat" ? between(3.5, 6) : o.lift === "bench" ? between(3, 5) : between(1.2, 2.6);
  const finishSeconds = o.lift === "squat" ? between(2, 3.5) : o.lift === "bench" ? between(1.5, 3) : between(0.8, 1.6);
  const t0 = o.selfFilmed ? o.idleStart : 0;
  const arrive = o.selfFilmed ? t0 + walkSeconds : 0;
  const setup = arrive + (o.selfFilmed ? o.waitBefore : between(0.5, 4));
  const firstRep = setup + setupSeconds;
  const repBlock = o.reps * o.repSeconds + (o.reps - 1) * o.repPause;
  const lastRep = firstRep + repBlock;
  const leave = lastRep + finishSeconds + o.waitAfter;
  const backAt = leave + walkSeconds;
  const stopHold = between(0.3, 0.9);
  const duration = o.selfFilmed ? backAt + stopHold : leave + between(0.5, 3);
  const subjectLook = lookFor(true);
  const plateGrey = pick([30, 95, 110, 140, 70]);
  // waiting at the bar: mostly still, a shift or a reach every few seconds (chalk, belt, a step)
  const fidgets: { t: number; len: number; dx: number; hands: number }[] = [];
  for (let t = arrive + between(0.3, 3); t < setup - 0.4; t += between(1.5, 6)) fidgets.push({ t, len: between(0.5, 1.3), dx: between(-0.08, 0.08), hands: between(0.7, 1.3) });

  const subjectAt = (t: number): ActorState | null => {
    const stride = (z: number, tt: number) => Math.sin(tt * 2 * Math.PI * 1.8) * 0.22 * (z > 0 ? 1 : 0);
    if (o.selfFilmed && t < t0) return { x: 0.02, z: 0.42, pose: { ...STAND, hands: 1.2 }, stride: 0, look: subjectLook, plates: null, reach: 1 };
    if (o.selfFilmed && t < arrive) {
      const k = (t - t0) / walkSeconds;
      const z = lerp(0.45, D, k);
      return { x: lerp(0.05, barX, ease(k)), z, pose: STAND, stride: stride(z, t), look: subjectLook, plates: null, reach: Math.max(0, 1 - (t - t0) / 0.5) };
    }
    if (t < setup) {
      // waiting at the bar: standing, the odd shift
      let dx = 0;
      let hands = STAND.hands;
      for (const fi of fidgets) if (fi.t <= t && t - fi.t < fi.len) { const k = Math.sin(((t - fi.t) / fi.len) * Math.PI); dx = fi.dx * k; hands = lerp(STAND.hands, fi.hands, k); }
      return { x: barX + dx, z: D, pose: { ...poses.rest, hands }, stride: 0, look: subjectLook, plates: plateGrey };
    }
    if (t < firstRep) {
      const k = ease((t - setup) / setupSeconds);
      // a squat's walkout: a step back from the rack as it comes off the hooks
      const dz = o.lift === "squat" ? -0.5 * ease((t - setup - setupSeconds * 0.4) / (setupSeconds * 0.5)) : 0;
      return { x: barX, z: D + dz + (o.lift === "squat" ? 0.5 : 0), pose: mix(poses.rest, poses.ready, k), stride: o.lift === "squat" && k > 0.4 && k < 0.95 ? Math.sin(t * 9) * 0.1 : 0, look: subjectLook, plates: plateGrey };
    }
    if (t < lastRep) {
      const cycle = o.repSeconds + o.repPause;
      const inRep = (t - firstRep) % cycle;
      const k = inRep >= o.repSeconds ? 0 : Math.sin((inRep / o.repSeconds) * Math.PI) ** 1.2;
      return { x: barX, z: D, pose: mix(poses.a, poses.b, k), stride: 0, look: subjectLook, plates: plateGrey };
    }
    if (t < leave) {
      const k = ease((t - lastRep) / finishSeconds);
      const dz = o.lift === "squat" ? 0.5 * k : 0;
      return { x: barX, z: D + dz, pose: mix(poses.ready, poses.rest, k), stride: o.lift === "squat" && k < 0.9 ? Math.sin(t * 9) * 0.1 : 0, look: subjectLook, plates: plateGrey };
    }
    if (!o.selfFilmed) return { x: barX, z: D, pose: poses.rest, stride: 0, look: subjectLook, plates: plateGrey };
    if (t < backAt) {
      const k = (t - leave) / walkSeconds;
      const z = lerp(D, 0.45, k);
      return { x: lerp(barX, 0.05, ease(k)), z, pose: STAND, stride: stride(z, t), look: subjectLook, plates: null, reach: Math.max(0, 1 - (backAt - t) / 0.6) };
    }
    return { x: 0.02, z: 0.42, pose: { ...STAND, hands: 1.2 }, stride: 0, look: subjectLook, plates: null, reach: 1 };
  };
  // the bar stays where the lift happens when they're not holding it
  const barAt = (t: number): { y: number; z: number } | null => {
    if (o.lift === "accessory") return null;
    if (t >= setup && t < leave) return null; // drawn with the lifter
    return { y: o.lift === "deadlift" ? 0.225 : o.lift === "squat" ? 1.45 : 1.05, z: o.lift === "squat" ? D + 0.5 : D };
  };

  /* ---- everyone else ---- */
  type Other = { at(t: number): ActorState | null };
  const others: Other[] = [];
  for (let i = 0; i < o.crossers; i++) {
    const z = r() < 0.25 ? between(1.4, D - 0.6) : between(D + 0.8, 9);
    const start = between(0, Math.max(1, duration - 2));
    const dir = r() < 0.5 ? 1 : -1;
    const speed = between(0.9, 1.5);
    const span = (W / 2 / f) * z + 0.6;
    const look = lookFor(false);
    others.push({
      at(t) {
        const x = -dir * span + dir * speed * (t - start);
        if (t < start || Math.abs(x) > span) return null;
        return { x, z, pose: STAND, stride: Math.sin(t * 2 * Math.PI * 1.8) * 0.22, look, plates: null };
      },
    });
  }
  for (let i = 0; i < o.loiterers; i++) {
    // someone standing around: usually beside or behind the lifter, now and then close to the phone
    const z = r() < 0.2 ? between(1.6, 2.3) : between(Math.max(2.2, D - 1.2), D + 3);
    const side = r() < 0.5 ? -1 : 1;
    const x = side * between(0.5, 1.0) * ((W / 2 / f) * z);
    const look = lookFor(false);
    // a shift of weight or a reach every few seconds, eased, not a jump
    const moves: { t: number; len: number; dx: number; hands: number }[] = [];
    for (let t = between(0, 4); t < duration; t += between(1.5, 7)) moves.push({ t, len: between(0.6, 1.6), dx: between(-0.15, 0.15), hands: between(0.7, 1.45) });
    const from = r() < 0.3 ? between(0, duration * 0.6) : -1;
    const until = r() < 0.3 ? between(duration * 0.5, duration) : duration + 1;
    others.push({
      at(t) {
        if (t < from || t > until) return null;
        let dx = 0;
        let hands = 0.8;
        // each move ends where it went: the next starts from there
        for (const m of moves) {
          if (m.t > t) break;
          const k = ease((t - m.t) / m.len);
          dx = lerp(dx, m.dx, k);
          hands = lerp(hands, m.hands, k);
        }
        return { x: x + dx, z, pose: { ...STAND, hands }, stride: 0, look, plates: null };
      },
    });
  }
  for (let i = 0; i < o.otherLifters; i++) {
    const z = between(D + 0.5, 8);
    const side = r() < 0.5 ? -1 : 1;
    const x = side * between(0.35, 0.9) * ((W / 2 / f) * z);
    const look = lookFor(false);
    const kind = pick<LiftKind>(["squat", "deadlift", "accessory"]);
    const ps = liftPoses(kind);
    const period = between(2, 3.5);
    const from = between(0, duration * 0.5);
    const until = from + between(8, 30);
    others.push({
      at(t) {
        const active = t >= from && t <= until;
        const k = active ? Math.sin(((t - from) / period) * Math.PI) ** 2 : 0;
        return { x, z, pose: mix(ps.a, ps.b, k), stride: 0, look, plates: 60 };
      },
    });
  }

  /* ---- the camera ---- */
  const nearAt = (t: number) => {
    const s = subjectAt(t);
    return s && s.z < 1.1 ? 1 : 0;
  };
  // exposure: darker picture with someone at the lens, easing back over a second; a slow drift
  const driftA = between(-0.03, 0.03);
  const driftF = between(0.05, 0.2);
  const gainAt = (t: number) => {
    let g = 1 + driftA * Math.sin(t * driftF * 2 * Math.PI);
    for (let back = 0; back <= 1.2; back += 0.2) if (nearAt(t - back)) { g += 0.12 * (1 - back / 1.2); break; }
    return g;
  };
  const bumps: number[] = [];
  if (o.shake && o.lift === "deadlift") for (let i = 0; i < o.reps; i++) bumps.push(firstRep + i * (o.repSeconds + o.repPause) + o.repSeconds * 0.95);
  const hand = o.handheld ? Array.from({ length: 6 }, () => ({ a: between(0.4, 2.2) * SS, fq: between(0.15, 0.9), ph: between(0, 6.28) })) : [];
  const shiftAt = (t: number): { dx: number; dy: number } => {
    let dx = 0;
    let dy = 0;
    for (const b of bumps) if (t >= b && t - b < 0.35) { const a = (1 - (t - b) / 0.35) * 0.5 * SS; dx += a * Math.sin((t - b) * 60); dy += a * Math.cos((t - b) * 47); }
    hand.forEach((hh, i) => { const v = hh.a * Math.sin(t * hh.fq * 2 * Math.PI + hh.ph); if (i % 2) dx += v; else dy += v; });
    if (o.selfFilmed && o.pickedUp && t > backAt + stopHold * 0.3) { const k = (t - backAt - stopHold * 0.3) / 0.25; dx += 9 * SS * k; dy -= 14 * SS * k; }
    return { dx, dy };
  };

  const drawPerson = (p: Painter, a: ActorState) => {
    const L = a.look;
    const P = a.pose;
    const at = (x: number, y: number) => project(a.x + x, y, a.z);
    const s = f / a.z;
    const box = (x0: number, y0: number, x1: number, y1: number, v: number) => { const A = at(x0, y0); const B = at(x1, y1); p.rect(A.sx, A.sy, B.sx, B.sy, v); };
    if (P.lying) {
      // on a bench: the body along the bench, arms up to the bar
      box(-0.25, 0.4, 0.25, 0.46, 45); // the bench
      box(-0.3, 0.46, 0.3, 0.62, L.shirt);
      box(-0.12, 0.0, -0.02, 0.46, L.longPants ? L.shorts : L.skin);
      box(0.02, 0.0, 0.12, 0.46, L.longPants ? L.shorts : L.skin);
      box(-0.3, 0.6, -0.22, P.hands, L.skin);
      box(0.22, 0.6, 0.3, P.hands, L.skin);
      const hd = at(0, 0.66);
      p.ellipse(hd.sx, hd.sy, 0.1 * s, 0.1 * s, L.hair);
    } else {
      const legW = 0.14;
      const spread = 0.1 + Math.abs(a.stride) * 0.6;
      const legV = L.longPants ? L.shorts : L.skin;
      const lx = a.stride * 0.5;
      box(-spread - legW / 2 + lx, 0.06, -spread + legW / 2 + lx, P.hip - 0.22, legV);
      box(spread - legW / 2 - lx, 0.06, spread + legW / 2 - lx, P.hip - 0.22, legV);
      box(-spread - 0.09 + lx, 0, -spread + 0.09 + lx, 0.08, L.shoes);
      box(spread - 0.09 - lx, 0, spread + 0.09 - lx, 0.08, L.shoes);
      box(-0.2, P.hip - 0.24, 0.2, P.hip + 0.02, L.shorts);
      // the torso: leaning forward shows it shorter and lower
      box(-0.21 - P.lean * 0.2, P.hip, 0.21 + P.lean * 0.2, P.shoulder, L.shirt);
      // arms from the shoulders to the hands
      box(-0.29, Math.min(P.shoulder, P.hands), -0.21, Math.max(P.shoulder, P.hands), L.skin);
      box(0.21, Math.min(P.shoulder, P.hands), 0.29, Math.max(P.shoulder, P.hands), L.skin);
      const hd = at(0, P.head);
      p.ellipse(hd.sx, hd.sy, 0.1 * s, 0.12 * s, P.lean > 0.15 ? L.hair : (L.skin + L.hair) / 2);
    }
    if (a.plates != null && P.bar != null) drawBar(p, a.x, P.bar, a.z, a.plates);
    // dumbbells in the hands on an accessory
    if (a.plates != null && P.bar == null && !P.lying) {
      box(-0.36, P.hands - 0.07, -0.14, P.hands + 0.07, a.plates);
      box(0.14, P.hands - 0.07, 0.36, P.hands + 0.07, a.plates);
    }
    // a hand over the lens (pressing record, reaching to stop)
    if (a.reach && a.reach > 0.02) {
      const cover = a.reach;
      p.ellipse(cx + 0.1 * W, H * (0.45 + 0.6 * (1 - cover)), W * 0.75 * cover, H * 0.7 * cover, L.skin * 0.7);
    }
  };
  const drawBar = (p: Painter, x: number, y: number, z: number, plate: number) => {
    const s = f / z;
    const c = project(x, y, z);
    p.rect(c.sx - 1.1 * s, c.sy - 0.014 * s, c.sx + 1.1 * s, c.sy + 0.014 * s, 175);
    p.ellipse(c.sx - 0.92 * s, c.sy, 0.225 * s * 0.55, 0.225 * s, plate);
    p.ellipse(c.sx + 0.92 * s, c.sy, 0.225 * s * 0.55, 0.225 * s, plate);
  };

  const noiseSeed = Math.floor(r() * 1e9);
  const frame = (t: number): Uint8Array => {
    const big = new Float32Array(bg);
    const p = painter(W, H, big);
    const actors: ActorState[] = [];
    for (const ot of others) { const a = ot.at(t); if (a) actors.push(a); }
    const sub = subjectAt(t);
    const bar = barAt(t);
    // far to near
    const drawables: { z: number; draw: () => void }[] = actors.map((a) => ({ z: a.z, draw: () => drawPerson(p, a) }));
    if (bar) drawables.push({ z: bar.z + 0.01, draw: () => drawBar(p, barX, bar.y, bar.z, plateGrey) });
    if (sub) drawables.push({ z: sub.z, draw: () => drawPerson(p, sub) });
    drawables.sort((a, b) => b.z - a.z).forEach((d) => d.draw());
    const g = gainAt(t);
    const sh = shiftAt(t);
    const out = new Uint8Array(w * h);
    const nr = rng(noiseSeed + Math.round(t * 1000));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let yy = 0; yy < SS; yy++)
          for (let xx = 0; xx < SS; xx++) {
            const sx = clamp(Math.round(x * SS + xx + sh.dx), 0, W - 1);
            const sy = clamp(Math.round(y * SS + yy + sh.dy), 0, H - 1);
            sum += big[sy * W + sx];
          }
        const n = (nr() + nr() + nr() - 1.5) * 2 * o.noise;
        out[y * w + x] = clamp(Math.round((sum / (SS * SS)) * g + n), 0, 255);
      }
    return out;
  };

  return { w, h, duration, truth: { arrive, setup, firstRep, lastRep, leave: o.selfFilmed ? leave : duration }, options: o, frame };
}

/** The frames a phone's keyframes give: one every `step` seconds from the start (a little uneven, like real files). */
export function sampleScene(scene: Scene, step: number, jitter = 0.03, seed = 1): { t: number; px: Uint8Array }[] {
  const r = rng(seed);
  const out: { t: number; px: Uint8Array }[] = [];
  for (let t = 0; t < scene.duration - 0.02; t += step) {
    const tt = Math.max(0, Math.min(scene.duration - 0.02, t + (out.length ? (r() - 0.5) * 2 * jitter : 0)));
    out.push({ t: Math.round(tt * 1000) / 1000, px: scene.frame(tt) });
  }
  return out;
}

/** How a suggested window did against what the scene holds. The worst is "cut": part of the lifting is gone. */
export type LiftGrade = "ok" | "cut" | "setup-clipped" | "loose-start" | "loose-end" | "loose-both" | "none" | "none-ok";

export function gradeLift(win: { start: number; end: number } | null, scene: Scene): LiftGrade {
  const t = scene.truth;
  // what there was to cut: the walk in and the wait, the walk back
  const cuttable = t.setup - 0.5 + (scene.duration - (t.leave + 1));
  if (!win) return cuttable >= 3 ? "none" : "none-ok";
  if (win.start > t.firstRep - 0.2 || win.end < t.lastRep + 0.1) return "cut";
  const early = t.setup - win.start; // lead-in kept before the setup
  const late = win.end - t.leave; // the walk back kept
  if (early < -0.6) return "setup-clipped";
  if (early > 6.5 && late > 2.5) return "loose-both";
  if (early > 6.5) return "loose-start";
  if (late > 2.5) return "loose-end";
  return "ok";
}
