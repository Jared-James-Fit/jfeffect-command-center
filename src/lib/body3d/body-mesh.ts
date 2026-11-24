/**
 * The 3D body for the muscle map, built from the app's own anatomical
 * drawing (pain/anatomy/atlas-data.ts), never a third-party model (pure,
 * tested in analytics-redesign.test.ts).
 *
 * Its shape is the drawing's front and side silhouettes lofted into 3D: at
 * every height each part (head, trunk, each arm, each leg) is an ellipse as
 * wide as the front view and as deep as the side view, so the muscles
 * painted onto it from the same drawings line up with it. The parts are
 * joined with a smooth signed-distance union (no seams at the shoulder,
 * neck or hip) and meshed once with surface nets, about 30k triangles.
 *
 * Coordinates are the drawing's: x across (0–400, midline 200; on the front
 * view the screen's left is the athlete's right), y down (0–920), z depth in
 * the same units, front positive (the side view's x less `SIDE_CENTER`).
 */
import { FRONT, SIDE } from "@/lib/pain/anatomy/atlas-data";
import { MID, mirrorPts, parsePoints, smoothPolygon, type Pt } from "@/lib/pain/anatomy/geometry";

export const SIDE_CENTER = 205;
export const BODY_H = 920;

type Section = { cx: number; rx: number; cz: number; rz: number };
type Lane = { y0: number; y1: number; at: Array<Section | null>; xmin: number; xmax: number };

function poly(spec: string): Pt[] {
  const { pts, corners } = parsePoints(spec);
  return smoothPolygon(pts, corners, 0.5, 6);
}

/** The front outline is drawn as its screen-left half: the whole outline is it and its mirror. */
function wholeFront(): Pt[] {
  const { pts, corners } = parsePoints(FRONT.silhouette);
  const back = mirrorPts(pts.slice(1, -1), MID).reverse();
  return smoothPolygon([...pts, ...back], corners, 0.5, 6);
}

/** Where a horizontal line at `y` is inside the polygon: sorted [from, to] spans. */
export function spans(p: Pt[], y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    if (y0 === y1) continue;
    if (y >= Math.min(y0, y1) && y < Math.max(y0, y1))
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  xs.sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const contains = (s: [number, number], x: number) => s[0] <= x && x <= s[1];
const mid = (s: [number, number]) => (s[0] + s[1]) / 2;

function buildLanes() {
  const front = wholeFront();
  const side = poly(SIDE.silhouette);
  const head = poly(FRONT.head);
  const sideHead = poly(
    "196,22 214,26 230,38 238,58 240,68 248,80 250,86 244,90 244,96 240,100 242,106 238,112 238,120 230,126 218,128 206,124 194,120 182,118 172,108 166,90 166,64 172,42 182,28",
  );
  const sideSpan = (y: number, near = SIDE_CENTER): [number, number] | null => {
    const ss = spans(side, y);
    if (!ss.length) return null;
    return (
      ss.find((s) => contains(s, near)) ?? ss.reduce((a, s) => (s[1] - s[0] > a[1] - a[0] ? s : a))
    );
  };
  const lane = (y0: number, y1: number, f: (y: number) => Section | null): Lane => {
    const at: Array<Section | null> = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let y = 0; y <= BODY_H; y++) {
      const s = y >= y0 && y <= y1 ? f(y + 0.5) : null;
      at.push(s);
      if (s) {
        xmin = Math.min(xmin, s.cx - s.rx);
        xmax = Math.max(xmax, s.cx + s.rx);
      }
    }
    return { y0, y1, at, xmin, xmax };
  };

  // the trunk's width at the armpit caps the shoulders (the deltoids belong to the arms)
  const trunkHalf = (y: number) => {
    const s = spans(front, y).find((x) => contains(x, MID));
    return s ? (s[1] - s[0]) / 2 : null;
  };
  const capAt = trunkHalf(262) ?? 70;
  const armZ = (() => {
    const s = sideSpan(300);
    return s ? mid(s) - SIDE_CENTER - 3 : -3;
  })();

  // the head: the profile's lips and nose notch the outline, so each section is
  // the full extent at that height, averaged over a few heights (a plain form, no ribs)
  const extent = (p: Pt[], y: number): [number, number] | null => {
    const ss = spans(p, y);
    return ss.length ? [ss[0][0], ss[ss.length - 1][1]] : null;
  };
  const headAt = (y: number): Section | null => {
    const f = extent(head, y);
    const s = extent(sideHead, y);
    if (!f || !s) return null;
    return { cx: mid(f), rx: (f[1] - f[0]) / 2, cz: mid(s) - SIDE_CENTER, rz: (s[1] - s[0]) / 2 };
  };
  const headLane = lane(22, 132, (y) => {
    const xs = [-6, -3, 0, 3, 6].map((d) => headAt(y + d)).filter((x): x is Section => !!x);
    if (!xs.length) return null;
    const avg = (k: keyof Section) => xs.reduce((a, x) => a + x[k], 0) / xs.length;
    return { cx: avg("cx"), rx: avg("rx"), cz: avg("cz"), rz: avg("rz") };
  });
  const trunk = lane(118, 474, (y) => {
    const f = spans(front, y).find((x) => contains(x, MID));
    const s = sideSpan(y);
    if (!f || !s) return null;
    let half = (f[1] - f[0]) / 2;
    if (y < 262) half = Math.min(half, capAt + (y < 175 ? 0 : 0));
    // the neck: narrower than the side outline under the jaw says (that's the chin)
    const depth = y < 150 ? Math.min((s[1] - s[0]) / 2, half * 1.05) : (s[1] - s[0]) / 2;
    const cz = y < 150 ? mid(s) - SIDE_CENTER - 6 : mid(s) - SIDE_CENTER;
    return { cx: MID, rx: half, cz, rz: depth };
  });
  const armR = lane(176, 576, (y) => {
    const ss = spans(front, y);
    let f: [number, number] | null;
    if (y < 248) {
      const outer = ss[0];
      if (!outer) return null;
      f = [outer[0], Math.max(outer[0] + 12, 129)];
    } else {
      // the widest span left of the trunk (the thumb is its own narrow span at the wrist)
      const arm = ss.filter((s) => mid(s) < 116);
      f = arm.length ? arm.reduce((a, s) => (s[1] - s[0] > a[1] - a[0] ? s : a)) : null;
    }
    if (!f) return null;
    const half = (f[1] - f[0]) / 2;
    const k = y < 350 ? 0.95 : y < 470 ? 0.8 : 0.42;
    return { cx: mid(f), rx: half, cz: armZ, rz: Math.max(3, half * k) };
  });
  const legR = lane(462, 908, (y) => {
    const ss = spans(front, y);
    let f: [number, number] | null = null;
    const whole = ss.find((s) => contains(s, MID));
    if (whole) f = [whole[0], MID];
    else f = ss.find((s) => mid(s) < MID && mid(s) > 108) ?? null;
    const s = sideSpan(y, y > 860 ? 220 : SIDE_CENTER);
    if (!f || !s) return null;
    return { cx: mid(f), rx: (f[1] - f[0]) / 2, cz: mid(s) - SIDE_CENTER, rz: (s[1] - s[0]) / 2 };
  });
  const mirror = (l: Lane): Lane => ({
    y0: l.y0,
    y1: l.y1,
    at: l.at.map((s) => (s ? { ...s, cx: 2 * MID - s.cx } : null)),
    xmin: 2 * MID - l.xmax,
    xmax: 2 * MID - l.xmin,
  });
  return [headLane, trunk, armR, mirror(armR), legR, mirror(legR)];
}

function laneDist(l: Lane, x: number, y: number, z: number): number {
  if (x < l.xmin - 40 || x > l.xmax + 40) return 60;
  const yc = Math.max(l.y0, Math.min(l.y1, y));
  const s = l.at[Math.round(yc)];
  if (!s) return 60;
  const rx = Math.max(0.5, s.rx);
  const rz = Math.max(0.5, s.rz);
  const q = Math.hypot((x - s.cx) / rx, (z - s.cz) / rz);
  const dxz = (q - 1) * Math.min(rx, rz);
  const dy = Math.max(l.y0 - y, y - l.y1, 0);
  return dy > 0 ? Math.hypot(Math.max(dxz, 0), dy) : dxz;
}

/** Polynomial smooth minimum: joins two shapes with a fillet of about k. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export type BodyMesh = {
  /** x, y, z per vertex, the drawing's coordinates */
  positions: Float32Array;
  /** unit normals in the same space (y down) */
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
};

let cached: BodyMesh | null = null;

/** Build (once) and return the body mesh. `h` is the grid step in drawing units. */
export function bodyMesh(h = 5): BodyMesh {
  if (cached && h === 5) return cached;
  const lanes = buildLanes();
  const K = 7;
  const sdf = (x: number, y: number, z: number) => {
    let d = 80;
    for (const l of lanes) {
      if (y < l.y0 - 30 || y > l.y1 + 30) continue;
      d = smin(d, laneDist(l, x, y, z), K);
    }
    return d;
  };
  const x0 = 14,
    x1 = 386,
    y0 = 12,
    y1 = 914,
    z0 = -66,
    z1 = 80;
  const nx = Math.ceil((x1 - x0) / h) + 1;
  const ny = Math.ceil((y1 - y0) / h) + 1;
  const nz = Math.ceil((z1 - z0) / h) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) vals[id(i, j, k)] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);

  const cellId = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const CORNERS: Array<[number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const EDGES: Array<[number, number]> = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = CORNERS[c];
          cv[c] = vals[id(i + a, j + b, k + d)];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [a, b] of EDGES) {
          const va = cv[a];
          const vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const [ax, ay, az] = CORNERS[a];
          const [bx, by, bz] = CORNERS[b];
          sx += ax + t * (bx - ax);
          sy += ay + t * (by - ay);
          sz += az + t * (bz - az);
          n++;
        }
        cellVert[cellId(i, j, k)] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
      }

  const vcount = pos.length / 3;
  const normals = new Float32Array(vcount * 3);
  const e = h * 0.5;
  for (let v = 0; v < vcount; v++) {
    const x = pos[v * 3],
      y = pos[v * 3 + 1],
      z = pos[v * 3 + 2];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / len;
    normals[v * 3 + 1] = gy / len;
    normals[v * 3 + 2] = gz / len;
  }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tri(a, b, c);
    tri(a, c, d);
  };
  const tri = (a: number, b: number, c: number) => {
    // wind it so its face points out (along the normals)
    const ax = pos[a * 3],
      ay = pos[a * 3 + 1],
      az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax,
      uy = pos[b * 3 + 1] - ay,
      uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax,
      vy = pos[c * 3 + 1] - ay,
      vz = pos[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy,
      fy = uz * vx - ux * vz,
      fz = ux * vy - uy * vx;
    const nx_ = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const ny_ = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nz_ = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (fx * nx_ + fy * ny_ + fz * nz_ >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = vals[id(i, j, k)] < 0;
        if (
          i < nx - 1 &&
          j > 0 &&
          k > 0 &&
          j < ny - 1 &&
          k < nz - 1 &&
          v0 !== vals[id(i + 1, j, k)] < 0
        )
          quad(
            cellVert[cellId(i, j - 1, k - 1)],
            cellVert[cellId(i, j, k - 1)],
            cellVert[cellId(i, j, k)],
            cellVert[cellId(i, j - 1, k)],
          );
        if (
          j < ny - 1 &&
          i > 0 &&
          k > 0 &&
          i < nx - 1 &&
          k < nz - 1 &&
          v0 !== vals[id(i, j + 1, k)] < 0
        )
          quad(
            cellVert[cellId(i - 1, j, k - 1)],
            cellVert[cellId(i, j, k - 1)],
            cellVert[cellId(i, j, k)],
            cellVert[cellId(i - 1, j, k)],
          );
        if (
          k < nz - 1 &&
          i > 0 &&
          j > 0 &&
          i < nx - 1 &&
          j < ny - 1 &&
          v0 !== vals[id(i, j, k + 1)] < 0
        )
          quad(
            cellVert[cellId(i - 1, j - 1, k)],
            cellVert[cellId(i, j - 1, k)],
            cellVert[cellId(i, j, k)],
            cellVert[cellId(i - 1, j, k)],
          );
      }

  const mesh: BodyMesh = {
    positions: new Float32Array(pos),
    normals,
    indices: new Uint32Array(idx),
    vertexCount: vcount,
    triangleCount: idx.length / 3,
  };
  if (h === 5) cached = mesh;
  return mesh;
}

/**
 * Where a ray first meets the body (Möller–Trumbore over every triangle,
 * a few milliseconds), in the drawing's coordinates, or null.
 */
export function rayHit(
  mesh: BodyMesh,
  o: [number, number, number],
  d: [number, number, number],
): { p: [number, number, number]; n: [number, number, number] } | null {
  const P = mesh.positions;
  const I = mesh.indices;
  let best = Infinity;
  let hit = -1;
  let bu = 0,
    bv = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3,
      b = I[t + 1] * 3,
      c = I[t + 2] * 3;
    const e1x = P[b] - P[a],
      e1y = P[b + 1] - P[a + 1],
      e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a],
      e2y = P[c + 1] - P[a + 1],
      e2z = P[c + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y,
      py = d[2] * e2x - d[0] * e2z,
      pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det;
    const tx = o[0] - P[a],
      ty = o[1] - P[a + 1],
      tz = o[2] - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y,
      qy = tz * e1x - tx * e1z,
      qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 0 && dist < best) {
      best = dist;
      hit = t;
      bu = u;
      bv = v;
    }
  }
  if (hit < 0) return null;
  const p: [number, number, number] = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  const N = mesh.normals;
  const w = 1 - bu - bv;
  const [ia, ib, ic] = [I[hit] * 3, I[hit + 1] * 3, I[hit + 2] * 3];
  const n: [number, number, number] = [0, 1, 2].map(
    (k) => N[ia + k] * w + N[ib + k] * bu + N[ic + k] * bv,
  ) as [number, number, number];
  const len = Math.hypot(...n) || 1;
  return { p, n: [n[0] / len, n[1] / len, n[2] / len] };
}

/**
 * Which drawing a surface point is read from and where on it: the front or
 * back view facing the camera, the side view on the flanks (the inner side
 * of a limb leans on the front / back drawing, which shows the inner thigh).
 * The shader blends the same three the same way.
 */
export function viewWeights(
  p: [number, number, number],
  n: [number, number, number],
): { front: number; back: number; side: number } {
  const inward = Math.sign(n[0]) !== Math.sign(p[0] - MID) && Math.abs(p[0] - MID) > 20;
  const sw = Math.pow(Math.abs(n[0]), 4) * (inward ? 0.25 : 1);
  const fw = Math.pow(Math.max(n[2], 0), 4);
  const bw = Math.pow(Math.max(-n[2], 0), 4);
  const s = sw + fw + bw || 1;
  return { front: fw / s, back: bw / s, side: sw / s };
}
