/**
 * The validation set for lift analysis (validation only, never the app): every
 * kind of footage the brief names, rendered by gym-scene.ts with a known
 * answer. Each scenario says what it tests.
 */
import { deadliftSet, squatSet, type Phase } from "../../src/test/lift-analysis/synthetic";
import type { GymScene } from "./gym-scene";

/** Competition bench: lowered, paused on the chest, pressed. */
export function pausedBench(o: {
  reps: number;
  rom: number;
  down: number;
  pause: number;
  up: number;
  slowdown?: number;
  dip?: number;
}): Phase[] {
  const out: Phase[] = [{ kind: "hold", dur: 1.2 }];
  for (let r = 0; r < o.reps; r++) {
    out.push({ kind: "down", rom: o.rom, dur: o.down });
    out.push({ kind: "hold", dur: o.pause });
    out.push({
      kind: "up",
      rom: o.rom,
      dur: o.up * (1 + (o.slowdown ?? 0) * r),
      dip: o.dip ?? 0.2,
      dipAt: 0.45,
    });
    out.push({ kind: "hold", dur: 0.5 });
  }
  out.push({ kind: "hold", dur: 0.8 });
  return out;
}

/**
 * A conventional deadlift set filmed the way athletes do it (the coach's 185 kg × 4, Nov 2026): a
 * rep every ~3 s, reset on the floor between reps, a short hold at lockout. `after`: the bar picked
 * part way up once the set is over (to roll it or move it) and the clip ending before it's down.
 */
export function cadenceDeadlift(o: {
  reps: number;
  rom: number;
  up: number;
  hold: number;
  down: number;
  rest: number;
  after?: { wait: number; rom: number; dur: number; tail: number };
}): Phase[] {
  const out: Phase[] = [{ kind: "hold", dur: 1.5 }];
  for (let r = 0; r < o.reps; r++) {
    out.push({ kind: "up", rom: o.rom, dur: o.up * (1 + 0.06 * r), gradual: true });
    out.push({ kind: "hold", dur: o.hold });
    out.push({ kind: "down", rom: o.rom, dur: o.down });
    out.push({ kind: "hold", dur: o.rest });
  }
  if (o.after) {
    out.push({ kind: "hold", dur: o.after.wait });
    out.push({ kind: "up", rom: o.after.rom, dur: o.after.dur });
    out.push({ kind: "hold", dur: o.after.tail });
  } else out.push({ kind: "hold", dur: 1 });
  return out;
}

const DEADLIFT_185X4 = cadenceDeadlift({
  reps: 4,
  rom: 450,
  up: 0.85,
  hold: 0.35,
  down: 0.55,
  rest: 1.25,
  after: { wait: 1.6, rom: 260, dur: 0.6, tail: 0.25 },
});

export const SCENARIOS: GymScene[] = [
  {
    // the coach's failing clip, as close as it can be drawn: black iron on black, the upright and the
    // J-hook right behind the plate at lockout, the bar out of the hooks and back, the phone a little off
    // straight on so the far plate shows up and to the right (moving at ~0.55 of the bar's travel),
    // auto-exposure drifting, a 1/30 s exposure, the plate ~55 px across its radius at 720p
    name: "bench-coach-30",
    lift: "bench",
    phases: pausedBench({ reps: 4, rom: 320, down: 1.1, pause: 1.0, up: 0.9, slowdown: 0.15 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 110,
    yawDeg: 14,
    farPlate: { dx: 2.6, dy: -1.7, scale: 0.55 },
    rackMove: 260,
    uprightBehind: true,
    darkBack: true,
    aeDrift: 0.08,
  },
  {
    // the same with a collar over the hub: no bright sleeve end to lock onto, exposure pumping
    name: "bench-collar-30",
    lift: "bench",
    phases: pausedBench({ reps: 4, rom: 320, down: 1.1, pause: 1.0, up: 0.9, slowdown: 0.15 }),
    fps: 30,
    style: "iron-dark",
    plateDiameterPx: 104,
    yawDeg: 14,
    farPlate: { dx: 2.6, dy: -1.7, scale: 0.55 },
    rackMove: 260,
    uprightBehind: true,
    darkBack: true,
    aeDrift: 0.15,
    noise: 5,
    bitrate: "2.2M",
  },
  {
    name: "bench-coach-60",
    lift: "bench",
    phases: pausedBench({ reps: 4, rom: 320, down: 1.1, pause: 1.0, up: 0.9, slowdown: 0.15 }),
    fps: 60,
    exposure: 1 / 60,
    style: "iron",
    plateDiameterPx: 110,
    yawDeg: 14,
    farPlate: { dx: 2.6, dy: -1.7, scale: 0.55 },
    rackMove: 260,
    uprightBehind: true,
    darkBack: true,
    aeDrift: 0.08,
  },
  {
    // a squat with its walk-out, filmed the same way
    name: "squat-real-30",
    lift: "squat",
    phases: squatSet({
      reps: 3,
      rom: 560,
      down: 1.5,
      up: 1.4,
      slowdown: 0.25,
      dip: 0.3,
      gradual: true,
    }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 120,
    yawDeg: 12,
    farPlate: { dx: 2.4, dy: -1.4, scale: 0.55 },
    rackMove: 380,
    uprightBehind: true,
    darkBack: true,
    aeDrift: 0.08,
  },
  {
    name: "deadlift-real-30",
    lift: "deadlift",
    phases: deadliftSet({ reps: 3, rom: 560, up: 1.6, down: 1.0, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 120,
    yawDeg: 12,
    farPlate: { dx: 2.4, dy: -1.2, scale: 0.55 },
    darkBack: true,
    aeDrift: 0.08,
  },
  {
    name: "squat-heavy-30",
    lift: "squat",
    phases: squatSet({
      reps: 3,
      rom: 560,
      down: 1.5,
      up: 1.4,
      slowdown: 0.25,
      dip: 0.3,
      gradual: true,
    }),
    fps: 30,
    style: "iron",
  },
  {
    name: "squat-heavy-60",
    lift: "squat",
    phases: squatSet({
      reps: 3,
      rom: 560,
      down: 1.5,
      up: 1.4,
      slowdown: 0.25,
      dip: 0.3,
      gradual: true,
    }),
    fps: 60,
    exposure: 1 / 120,
    style: "iron",
  },
  {
    // the coach's own footage: a paused competition bench, phone a little off straight on, far plate in view
    name: "bench-paused-30",
    lift: "bench",
    phases: pausedBench({ reps: 4, rom: 380, down: 1.1, pause: 1.0, up: 0.95, slowdown: 0.15 }),
    fps: 30,
    style: "bumper",
    yawDeg: 14,
    farPlate: true,
  },
  {
    name: "bench-paused-60",
    lift: "bench",
    phases: pausedBench({ reps: 4, rom: 380, down: 1.1, pause: 1.0, up: 0.95, slowdown: 0.15 }),
    fps: 60,
    exposure: 1 / 120,
    style: "comp",
  },
  {
    name: "deadlift-conv-30",
    lift: "deadlift",
    phases: deadliftSet({ reps: 3, rom: 560, up: 1.6, down: 1.0, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
  },
  {
    name: "deadlift-sumo-60",
    lift: "sumo",
    phases: deadliftSet({ reps: 3, rom: 430, up: 1.8, down: 0.9, slowdown: 0.2 }),
    fps: 60,
    exposure: 1 / 120,
    style: "bumper",
  },
  {
    // a slow grind with a sticking region
    name: "squat-grinder-60",
    lift: "squat",
    phases: squatSet({ reps: 1, rom: 560, down: 1.6, up: 3.6, dip: 0.75, gradual: true }),
    fps: 60,
    exposure: 1 / 120,
    style: "comp",
  },
  {
    // someone walks past the camera during rep 2
    name: "bench-walker-30",
    lift: "bench",
    phases: pausedBench({ reps: 3, rom: 380, down: 1.0, pause: 0.8, up: 1.0 }),
    fps: 30,
    style: "iron",
    walker: { t0: 4.6, t1: 5.6 },
  },
  {
    // a bottle in front of the lower part of the plate at the floor
    name: "deadlift-bottle-30",
    lift: "deadlift",
    phases: deadliftSet({ reps: 2, rom: 560, up: 1.5, down: 1.0 }),
    fps: 30,
    style: "bumper",
    bottle: true,
  },
  {
    // the biggest plate a 15 kg competition plate (400 mm): the athlete must say so
    name: "squat-400mm-60",
    lift: "squat",
    phases: squatSet({ reps: 3, rom: 540, down: 1.2, up: 0.9, slowdown: 0.1 }),
    fps: 60,
    exposure: 1 / 120,
    style: "comp",
    plateMm: 400,
    plateDiameterPx: 133,
  },
  {
    // light bench with 10 kg plates (325 mm)
    name: "bench-325mm-30",
    lift: "bench",
    phases: pausedBench({ reps: 3, rom: 380, down: 0.9, pause: 0.6, up: 0.6 }),
    fps: 30,
    style: "iron",
    plateMm: 325,
    plateDiameterPx: 108,
  },
  {
    name: "squat-yaw25-30",
    lift: "squat",
    phases: squatSet({ reps: 3, rom: 560, down: 1.4, up: 1.2, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
    yawDeg: 25,
    farPlate: true,
  },
  {
    name: "deadlift-pitch12-60",
    lift: "deadlift",
    phases: deadliftSet({ reps: 3, rom: 560, up: 1.4, down: 1.0, slowdown: 0.2 }),
    fps: 60,
    exposure: 1 / 120,
    style: "iron",
    pitchDeg: 12,
  },
  {
    // filmed from far away: a small plate
    name: "squat-far-30",
    lift: "squat",
    phases: squatSet({ reps: 3, rom: 560, down: 1.4, up: 1.2, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 92,
  },
  {
    name: "bench-handheld-30",
    lift: "bench",
    phases: pausedBench({ reps: 3, rom: 380, down: 1.0, pause: 0.8, up: 1.0 }),
    fps: 30,
    style: "bumper",
    shake: 4,
  },
  {
    name: "squat-dim-30",
    lift: "squat",
    phases: squatSet({ reps: 3, rom: 560, down: 1.4, up: 1.3, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
    light: 0.55,
    noise: 5,
  },
  // ── filmed the way athletes really do (production, Nov 2026: every clip 25–35° off side-on,
  // the plate 180–250 px across at 720 wide, portrait, 30 fps, the stack's edge showing)
  {
    name: "bench-yaw30-30",
    lift: "bench",
    phases: pausedBench({ reps: 5, rom: 340, down: 1.1, pause: 1.0, up: 1.0, slowdown: 0.2 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 190,
    yawDeg: 30,
    stackMm: 120,
    farPlate: { dx: 1.9, dy: -1.1, scale: 0.6 },
    rackMove: 260,
    uprightBehind: true,
    aeDrift: 0.08,
  },
  {
    name: "squat-yaw35-30",
    lift: "squat",
    phases: squatSet({
      reps: 3,
      rom: 560,
      down: 1.5,
      up: 1.4,
      slowdown: 0.25,
      dip: 0.3,
      gradual: true,
    }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 210,
    yawDeg: 35,
    stackMm: 160,
    farPlate: { dx: 1.8, dy: -1.0, scale: 0.6 },
    rackMove: 380,
    uprightBehind: true,
    aeDrift: 0.08,
  },
  {
    name: "deadlift-yaw35-30",
    lift: "deadlift",
    phases: deadliftSet({ reps: 5, rom: 560, up: 1.5, down: 1.0, slowdown: 0.2 }),
    fps: 30,
    style: "bumper",
    plateDiameterPx: 200,
    yawDeg: 35,
    stackMm: 200,
    farPlate: { dx: 1.8, dy: -0.9, scale: 0.6 },
    aeDrift: 0.08,
  },
  {
    name: "sumo-yaw30-30",
    lift: "sumo",
    phases: deadliftSet({ reps: 3, rom: 430, up: 1.8, down: 0.9, slowdown: 0.25 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 250,
    yawDeg: 30,
    stackMm: 160,
    darkBack: true,
  },
  {
    // the slowest press there is: a 4 s grind with a long sticking region, filmed at 30 fps and turned
    name: "bench-grinder-yaw25-30",
    lift: "bench",
    phases: pausedBench({ reps: 1, rom: 360, down: 1.4, pause: 1.2, up: 4.2, dip: 0.8 }),
    fps: 30,
    style: "comp",
    plateDiameterPx: 200,
    yawDeg: 25,
    stackMm: 140,
  },
  {
    // a hand / the spotter crossing the plate for half a second mid-press in rep 2 and rep 4
    name: "bench-hidden-yaw28-30",
    lift: "bench",
    phases: pausedBench({ reps: 5, rom: 340, down: 1.0, pause: 0.9, up: 1.1, slowdown: 0.15 }),
    fps: 30,
    style: "iron",
    plateDiameterPx: 180,
    yawDeg: 28,
    stackMm: 120,
    walker: { t0: 6.9, t1: 7.4 },
  },
  // ── the coach's 185 kg × 4 competition deadlift (Nov 2026): phone ~38° off side-on, 30 fps, a
  // small plate (~120 px across at 720 wide), four reps every ~3 s and the bar picked part way up
  // after the set with the clip ending before it's down; the first also has the plate covered for
  // a moment at rep 4's lockout (someone passing), the way the real read lost it there
  {
    name: "deadlift-185x4-yaw38-30",
    lift: "deadlift",
    phases: DEADLIFT_185X4,
    fps: 30,
    style: "comp",
    plateDiameterPx: 120,
    yawDeg: 38,
    stackMm: 220,
    farPlate: { dx: 1.8, dy: -0.9, scale: 0.6 },
    aeDrift: 0.08,
    walker: { t0: 10.9, t1: 12.9 },
  },
  {
    name: "deadlift-185x4-end-30",
    lift: "deadlift",
    phases: DEADLIFT_185X4,
    fps: 30,
    style: "comp",
    plateDiameterPx: 120,
    yawDeg: 38,
    stackMm: 220,
    farPlate: { dx: 1.8, dy: -0.9, scale: 0.6 },
    aeDrift: 0.08,
  },
  {
    // a phone well round toward the front: the plate a narrow ellipse (cos 58° ≈ 0.53 as wide as tall)
    name: "deadlift-yaw58-30",
    lift: "deadlift",
    phases: deadliftSet({ reps: 3, rom: 480, up: 1.2, down: 0.8 }),
    fps: 30,
    style: "bumper",
    plateDiameterPx: 200,
    yawDeg: 58,
    stackMm: 200,
    farPlate: { dx: 1.2, dy: -0.6, scale: 0.6 },
  },
];

/** Which way reps go, by lift (what the exercise's name tells the engine). */
export const dirOf = (lift: GymScene["lift"]) =>
  lift === "deadlift" || lift === "sumo" ? ("lift_first" as const) : ("lower_first" as const);
