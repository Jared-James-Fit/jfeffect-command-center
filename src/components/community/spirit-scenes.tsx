import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Saturday Spirit & Visual: pictures that say it without words. Drawn in
 * code (crisp at any size, nothing to upload), 4:5 like a feed photo, in the
 * app's dark + JF red / gold palette. Each one is a process reminder:
 * keep swinging, roots before shoots, every hit counts, show up again.
 */
export type SpiritSceneKey =
  | "keep_digging"
  | "bamboo_roots"
  | "stonecutter"
  | "iceberg"
  | "stairs_fog"
  | "water_stone"
  | "year_dots"
  | "switchback"
  | "sunrise_rack"
  | "seed_to_tree";

export const SPIRIT_SCENE_KEYS: SpiritSceneKey[] = [
  "keep_digging", "bamboo_roots", "stonecutter", "iceberg", "stairs_fog",
  "water_stone", "year_dots", "switchback", "sunrise_rack", "seed_to_tree",
];

/** What each picture is about (for screen readers and the coach screen). */
export const SPIRIT_SCENE_LABEL: Record<SpiritSceneKey, string> = {
  keep_digging: "A miner swinging a pickaxe, one swing away from a glowing vein of gold",
  bamboo_roots: "A tiny sprout above ground with a huge glowing root system underneath",
  stonecutter: "A boulder finally splitting under a hammer, with a hundred tally marks below",
  iceberg: "The small tip of an iceberg above the water and the huge mass below it",
  stairs_fog: "A figure climbing stairs that disappear into the fog, light above",
  water_stone: "Drops of water that have carved a hollow into stone",
  year_dots: "A year of weeks as dots, almost every one filled in",
  switchback: "A zigzag trail up a mountain at night, a figure most of the way up",
  sunrise_rack: "A squat rack in an empty gym as the sun comes up",
  seed_to_tree: "A seed, a sprout, a sapling and a full tree in a row",
};

export function isSpiritScene(v: unknown): v is SpiritSceneKey {
  return typeof v === "string" && (SPIRIT_SCENE_KEYS as string[]).includes(v);
}

export function SpiritScene({ scene, className }: { scene: SpiritSceneKey; className?: string }) {
  const id = useId().replace(/:/g, "");
  const draw = SCENES[scene];
  return (
    <div className={cn("relative w-full overflow-hidden bg-[#07070a]", className)} style={{ aspectRatio: "4 / 5" }}>
      <svg viewBox="0 0 400 500" className="absolute inset-0 h-full w-full" role="img" aria-label={SPIRIT_SCENE_LABEL[scene]} preserveAspectRatio="xMidYMid slice">
        {draw ? draw(id) : null}
        {/* the JF mark, small, bottom corner */}
        <g opacity="0.55">
          <rect x="356" y="468" width="30" height="18" rx="4" fill="#ef3340" />
          <text x="371" y="481" textAnchor="middle" fontSize="11" fontWeight="900" fontStyle="italic" fill="#fff" fontFamily="system-ui, sans-serif">JF</text>
        </g>
      </svg>
    </div>
  );
}

const RED = "#ef3340";
const GOLD = "#fbbf24";

/** Small stars in the night sky. Fixed positions, so every render matches. */
function Stars({ n = 26, maxY = 160, seed = 1 }: { n?: number; maxY?: number; seed?: number }) {
  const out: ReactNode[] = [];
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const x = rnd() * 400;
    const y = rnd() * maxY;
    const r = 0.5 + rnd() * 1.1;
    out.push(<circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(2)} fill="#fff" opacity={(0.25 + rnd() * 0.6).toFixed(2)} />);
  }
  return <g>{out}</g>;
}

const SCENES: Record<SpiritSceneKey, (id: string) => ReactNode> = {
  /* ── One swing away: the tunnel stops a hand's width short of gold ───── */
  keep_digging: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1026" />
          <stop offset="1" stopColor="#1b1530" />
        </linearGradient>
        <linearGradient id={`${id}earth`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2416" />
          <stop offset="0.5" stopColor="#24160e" />
          <stop offset="1" stopColor="#120b07" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={GOLD} stopOpacity="0.9" />
          <stop offset="0.4" stopColor="#f59e0b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}beam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fde68a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}earth)`} />
      <rect width="400" height="96" fill={`url(#${id}sky)`} />
      <Stars n={18} maxY={80} seed={3} />
      <path d="M0 96 Q 60 88 120 95 T 240 93 T 400 96 V 104 H 0 Z" fill="#1f3a1d" />
      {/* strata */}
      {[150, 205, 380, 430].map((y, i) => (
        <path key={y} d={`M0 ${y} Q 100 ${y - 8 + i * 3} 200 ${y + 4} T 400 ${y - 2}`} stroke="#000" strokeOpacity="0.25" strokeWidth="2" fill="none" />
      ))}
      {/* the shaft down and the tunnel across */}
      <path d="M34 96 H 70 V 268 H 34 Z" fill="#0a0604" />
      <path d="M34 262 H 262 Q 272 262 272 272 V 318 Q 272 326 262 326 H 34 Z" fill="#0a0604" />
      {/* ladder */}
      {Array.from({ length: 9 }).map((_, i) => <rect key={i} x="40" y={108 + i * 18} width="24" height="2.5" rx="1" fill="#6b4a2f" />)}
      <rect x="40" y="100" width="2.5" height="168" fill="#6b4a2f" />
      <rect x="61.5" y="100" width="2.5" height="168" fill="#6b4a2f" />
      {/* miner, mid swing */}
      <g transform="translate(222 268)">
        <path d="M-12 14 L 14 -34" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 -42 Q 20 -40 30 -26" stroke="#e2e8f0" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M4 -42 Q -6 -36 -10 -26" stroke="#e2e8f0" strokeWidth="4" fill="none" strokeLinecap="round" />
        <rect x="-14" y="6" width="18" height="30" rx="7" fill="#e5e7eb" />
        <circle cx="-5" cy="-2" r="8" fill="#e5e7eb" />
        <path d="M-14 -4 Q -5 -16 5 -4 Z" fill={GOLD} />
        <path d="M5 -6 L 60 -22 L 60 14 Z" fill={`url(#${id}beam)`} />
        <path d="M-12 36 L -16 54 M -2 36 L 2 54" stroke="#e5e7eb" strokeWidth="5" strokeLinecap="round" />
      </g>
      {/* chips flying off the face */}
      <circle cx="268" cy="288" r="1.8" fill="#a8a29e" />
      <circle cx="262" cy="276" r="1.3" fill="#a8a29e" />
      <circle cx="274" cy="300" r="1.2" fill="#a8a29e" />
      {/* the gold, just past the rock */}
      <circle cx="318" cy="296" r="70" fill={`url(#${id}glow)`} />
      <path d="M292 270 L 306 262 L 318 272 L 334 266 L 344 280 L 338 300 L 350 314 L 332 326 L 314 318 L 298 326 L 290 308 L 296 290 Z" fill="#b45309" />
      <path d="M300 276 L 312 270 L 322 280 L 334 276 L 338 290 L 330 304 L 340 312 L 326 318 L 312 310 L 300 316 L 296 300 L 302 290 Z" fill={GOLD} />
      <path d="M306 282 L 314 278 L 320 286 L 314 292 Z M 324 294 L 332 292 L 334 300 L 326 302 Z" fill="#fff7cc" />
    </>
  ),

  /* ── Roots before shoots ───────────────────────────────────────────────── */
  bamboo_roots: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#7c2d12" />
        </linearGradient>
        <linearGradient id={`${id}soil`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c120c" />
          <stop offset="1" stopColor="#070504" />
        </linearGradient>
        <filter id={`${id}soft`}><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}soil)`} />
      <rect width="400" height="170" fill={`url(#${id}sky)`} />
      <circle cx="300" cy="170" r="46" fill="#fb923c" opacity="0.35" />
      <rect y="166" width="400" height="8" fill="#14532d" />
      {/* the sprout */}
      <path d="M200 168 V 146" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
      <path d="M200 152 Q 186 140 180 146 Q 188 156 200 152 Z" fill="#4ade80" />
      <path d="M200 146 Q 214 132 222 138 Q 214 150 200 146 Z" fill="#86efac" />
      {/* the roots: what took the time */}
      <g stroke={RED} strokeLinecap="round" fill="none">
        <g filter={`url(#${id}soft)`} opacity="0.55" strokeWidth="6">
          <path d="M200 174 C 196 240 210 300 200 380" />
          <path d="M200 210 C 160 240 120 260 70 330" />
          <path d="M200 210 C 240 240 290 260 340 340" />
        </g>
        <g strokeWidth="2.6">
          <path d="M200 174 C 196 240 210 300 200 380 C 196 420 204 450 200 480" />
          <path d="M200 210 C 160 240 120 260 70 330 C 56 352 48 380 40 410" />
          <path d="M200 210 C 240 240 290 260 340 340 C 352 360 360 390 366 420" />
          <path d="M200 260 C 170 290 150 330 130 400" />
          <path d="M200 260 C 232 296 252 330 268 410" />
        </g>
        <g strokeWidth="1.3" opacity="0.8">
          <path d="M120 270 C 100 280 84 280 60 276" /><path d="M96 300 C 90 330 80 350 66 368" />
          <path d="M290 268 C 316 274 336 270 362 262" /><path d="M312 300 C 320 326 334 344 352 356" />
          <path d="M150 330 C 130 350 110 356 90 352" /><path d="M250 330 C 272 350 296 356 318 352" />
          <path d="M200 330 C 186 360 176 380 170 420" /><path d="M200 330 C 214 360 226 380 232 430" />
          <path d="M130 400 C 120 420 106 434 92 444" /><path d="M268 410 C 282 430 296 440 312 448" />
          <path d="M70 330 C 52 336 36 346 22 362" /><path d="M340 340 C 358 344 372 356 384 372" />
        </g>
        <g strokeWidth="0.8" opacity="0.6">
          {[[60, 276, 44, 266], [66, 368, 52, 384], [362, 262, 380, 252], [352, 356, 370, 368], [92, 444, 80, 462], [312, 448, 326, 466], [170, 420, 160, 448], [232, 430, 244, 456], [40, 410, 30, 440], [366, 420, 378, 450]].map(([a, b, c, d], i) => (
            <path key={i} d={`M${a} ${b} L ${c} ${d}`} />
          ))}
        </g>
      </g>
    </>
  ),

  /* ── The hundred-and-first hit ─────────────────────────────────────────── */
  stonecutter: (id) => (
    <>
      <defs>
        <radialGradient id={`${id}bg`} cx="0.5" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#27272a" />
          <stop offset="1" stopColor="#09090b" />
        </radialGradient>
        <linearGradient id={`${id}rock`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#71717a" />
          <stop offset="1" stopColor="#3f3f46" />
        </linearGradient>
        <filter id={`${id}glow`}><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}bg)`} />
      <ellipse cx="200" cy="336" rx="150" ry="16" fill="#000" opacity="0.5" />
      {/* the boulder, splitting */}
      <path d="M70 330 L 82 238 L 130 172 L 196 150 L 200 190 L 194 240 L 204 290 L 198 334 Z" fill={`url(#${id}rock)`} />
      <path d="M206 334 L 212 290 L 202 240 L 208 190 L 204 150 L 262 162 L 318 214 L 334 300 L 322 334 Z" fill="#52525b" />
      <path d="M204 150 L 200 190 L 194 240 L 204 290 L 198 334" stroke={GOLD} strokeWidth="3" fill="none" filter={`url(#${id}glow)`} />
      <path d="M204 150 L 200 190 L 194 240 L 204 290 L 198 334" stroke="#fff7cc" strokeWidth="1.2" fill="none" />
      <path d="M110 220 L 140 236 M 120 280 L 150 270 M 262 200 L 286 230 M 290 280 L 310 266" stroke="#27272a" strokeWidth="2" />
      {/* sledgehammer, on impact */}
      <g transform="rotate(-28 204 118)">
        <rect x="196" y="-6" width="9" height="120" rx="3" fill="#a16207" />
        <rect x="178" y="104" width="46" height="26" rx="4" fill="#d4d4d8" />
        <rect x="178" y="104" width="46" height="6" rx="3" fill="#f4f4f5" />
      </g>
      {[[168, 140], [236, 136], [150, 160], [252, 158], [214, 128]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6 + (i % 2)} fill={GOLD} opacity="0.9" />
      ))}
      {/* every hit before it: 100 marks, the last one red */}
      <g transform="translate(70 380)">
        {Array.from({ length: 20 }).map((_, g) => {
          const gx = (g % 10) * 26;
          const gy = Math.floor(g / 10) * 34;
          return (
            <g key={g} stroke={g === 19 ? RED : "#a1a1aa"} strokeWidth="2" strokeLinecap="round" opacity={g === 19 ? 1 : 0.55}>
              {[0, 1, 2, 3].map((k) => <path key={k} d={`M${gx + k * 4.5} ${gy} V ${gy + 18}`} />)}
              <path d={`M${gx - 2} ${gy + 15} L ${gx + 17} ${gy + 3}`} />
            </g>
          );
        })}
      </g>
    </>
  ),

  /* ── What they see vs what it took ─────────────────────────────────────── */
  iceberg: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id={`${id}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
        <linearGradient id={`${id}ice`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0ea5e9" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}sea)`} />
      <rect width="400" height="150" fill={`url(#${id}sky)`} />
      <Stars n={20} maxY={110} seed={7} />
      {/* the tip */}
      <path d="M162 150 L 184 112 L 196 120 L 210 96 L 230 128 L 244 150 Z" fill="#f8fafc" />
      <path d="M210 96 L 230 128 L 244 150 L 218 150 Z" fill="#cbd5e1" />
      <path d="M210 96 V 70" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M210 70 L 232 77 L 210 84 Z" fill={RED} />
      <rect y="148" width="400" height="3" fill="#38bdf8" opacity="0.5" />
      {/* everything under it */}
      <path d="M150 152 L 96 210 L 64 300 L 86 390 L 150 452 L 238 466 L 310 420 L 344 330 L 322 236 L 258 152 Z" fill={`url(#${id}ice)`} stroke="#7dd3fc" strokeOpacity="0.35" />
      <g stroke="#bae6fd" strokeOpacity="0.55" fill="none" strokeWidth="2" strokeLinecap="round">
        {/* a barbell, a moon (sleep), a fork (food), a calendar, a check */}
        <path d="M150 230 H 214 M 150 222 V 238 M 214 222 V 238 M 144 226 V 234 M 220 226 V 234" />
        <path d="M262 270 a 18 18 0 1 0 14 26 a 14 14 0 1 1 -14 -26 Z" />
        <path d="M120 310 V 350 M 112 310 V 322 Q 120 330 128 322 V 310" />
        <rect x="190" y="320" width="44" height="38" rx="5" />
        <path d="M190 332 H 234 M 202 314 V 324 M 222 314 V 324" />
        <path d="M150 400 l 12 12 l 24 -26" />
        <path d="M262 380 l 8 8 l 16 -18" />
      </g>
    </>
  ),

  /* ── Only the next step ────────────────────────────────────────────────── */
  stairs_fog: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f1d2b" />
          <stop offset="0.45" stopColor="#151018" />
          <stop offset="1" stopColor="#070709" />
        </linearGradient>
        <linearGradient id={`${id}fog`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e5e7eb" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#9ca3af" stopOpacity="0.45" />
          <stop offset="1" stopColor="#6b7280" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}light`} cx="0.62" cy="0.1" r="0.5">
          <stop offset="0" stopColor="#fff7ed" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff7ed" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}bg)`} />
      <rect width="400" height="260" fill={`url(#${id}light)`} />
      {Array.from({ length: 14 }).map((_, i) => {
        const x = 30 + i * 22;
        const y = 470 - i * 26;
        return <path key={i} d={`M${x} ${y} H ${x + 64} V ${y + 26} H ${x} Z`} fill={i < 9 ? "#27272a" : "#3f3f46"} stroke="#52525b" strokeWidth="0.8" opacity={i < 10 ? 1 : 0.6} />;
      })}
      {/* climber, mid way */}
      <g transform="translate(176 306)">
        <circle cx="12" cy="-34" r="7" fill="#f4f4f5" />
        <path d="M12 -26 L 10 -6 M 10 -6 L 22 6 M 10 -6 L 0 6 M 12 -20 L 24 -12 M 12 -20 L 2 -14" stroke="#f4f4f5" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>
      {/* fog swallows the top */}
      <rect y="0" width="400" height="230" fill={`url(#${id}fog)`} />
      <ellipse cx="120" cy="214" rx="140" ry="22" fill="#d1d5db" opacity="0.25" />
      <ellipse cx="300" cy="196" rx="160" ry="26" fill="#d1d5db" opacity="0.2" />
    </>
  ),

  /* ── Not force, frequency ──────────────────────────────────────────────── */
  water_stone: (id) => (
    <>
      <defs>
        <radialGradient id={`${id}bg`} cx="0.5" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#0f2a3a" />
          <stop offset="1" stopColor="#05070a" />
        </radialGradient>
        <linearGradient id={`${id}stone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#57534e" />
          <stop offset="1" stopColor="#1c1917" />
        </linearGradient>
        <linearGradient id={`${id}drop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}bg)`} />
      <rect x="150" y="0" width="100" height="22" rx="4" fill="#1f2937" />
      {/* falling drops, one after another */}
      {[60, 120, 175, 222, 262].map((y, i) => (
        <path key={y} d={`M200 ${y} q -7 12 0 16 q 7 -4 0 -16 Z`} fill={`url(#${id}drop)`} opacity={0.35 + i * 0.15} />
      ))}
      {/* the stone, with the hollow the drops made */}
      <path d="M40 470 L 56 360 Q 70 330 120 322 L 160 318 Q 172 338 200 340 Q 228 338 240 318 L 290 324 Q 336 334 348 366 L 362 470 Z" fill={`url(#${id}stone)`} />
      <path d="M160 318 Q 172 338 200 340 Q 228 338 240 318" fill="none" stroke="#0c0a09" strokeWidth="3" />
      <ellipse cx="200" cy="326" rx="34" ry="7" fill="#38bdf8" opacity="0.45" />
      {[14, 24, 36].map((r, i) => <ellipse key={r} cx="200" cy="326" rx={r} ry={r / 5} fill="none" stroke="#bae6fd" strokeOpacity={0.6 - i * 0.18} strokeWidth="1.2" />)}
      <path d="M86 390 L 120 380 M 260 400 L 300 384 M 150 430 L 190 440" stroke="#292524" strokeWidth="2" />
    </>
  ),

  /* ── A year of showing up ──────────────────────────────────────────────── */
  year_dots: (id) => {
    const missed = new Set([5, 17, 30, 41]);
    return (
      <>
        <defs>
          <radialGradient id={`${id}bg`} cx="0.5" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#1a0b0d" />
            <stop offset="1" stopColor="#060606" />
          </radialGradient>
          <filter id={`${id}glow`}><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        <rect width="400" height="500" fill={`url(#${id}bg)`} />
        <g transform="translate(62 70)">
          {Array.from({ length: 52 }).map((_, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const cx = col * 92;
            const cy = row * 28;
            const last = i === 51;
            if (missed.has(i)) return <circle key={i} cx={cx} cy={cy} r="8" fill="none" stroke="#3f3f46" strokeWidth="2" />;
            return (
              <g key={i}>
                {last && <circle cx={cx} cy={cy} r="16" fill={RED} opacity="0.6" filter={`url(#${id}glow)`} />}
                <circle cx={cx} cy={cy} r={last ? 10 : 8} fill={last ? "#ff5a66" : RED} opacity={last ? 1 : 0.55 + (i / 52) * 0.45} />
              </g>
            );
          })}
        </g>
      </>
    );
  },

  /* ── The long way up is still up ───────────────────────────────────────── */
  switchback: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#020617" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id={`${id}mtn`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}sky)`} />
      <Stars n={40} maxY={200} seed={11} />
      <circle cx="320" cy="78" r="18" fill="#f8fafc" opacity="0.9" />
      <circle cx="328" cy="72" r="16" fill="#020617" opacity="0.85" />
      <path d="M-20 500 L 90 300 L 130 330 L 210 110 L 300 290 L 340 260 L 420 500 Z" fill={`url(#${id}mtn)`} />
      <path d="M210 110 L 236 162 L 222 170 L 210 150 L 196 172 L 186 162 Z" fill="#e2e8f0" opacity="0.9" />
      {/* the trail */}
      <path d="M120 490 L 260 450 L 140 410 L 270 370 L 160 330 L 262 290 L 180 250 L 244 210 L 206 168" fill="none" stroke={GOLD} strokeWidth="2.5" strokeDasharray="5 6" strokeLinecap="round" opacity="0.85" />
      <path d="M210 110 V 84" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M210 84 L 232 91 L 210 98 Z" fill={RED} />
      {/* climber */}
      <g transform="translate(240 272)">
        <circle cx="0" cy="-16" r="5" fill="#fef3c7" />
        <path d="M0 -10 V 4 M 0 4 L 6 14 M 0 4 L -6 14 M 0 -6 L 8 -2" stroke="#fef3c7" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="0" cy="-16" r="14" fill={GOLD} opacity="0.18" />
      </g>
    </>
  ),

  /* ── Before anyone is awake ────────────────────────────────────────────── */
  sunrise_rack: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="0.55" stopColor="#be123c" />
          <stop offset="0.8" stopColor="#f97316" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
        <radialGradient id={`${id}sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff7ed" />
          <stop offset="0.5" stopColor="#fdba74" />
          <stop offset="1" stopColor="#fdba74" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}sky)`} />
      <circle cx="200" cy="330" r="120" fill={`url(#${id}sun)`} />
      {/* window frame */}
      <rect x="30" y="40" width="340" height="300" fill="none" stroke="#0a0a0a" strokeWidth="10" />
      <path d="M200 40 V 340 M 30 190 H 370" stroke="#0a0a0a" strokeWidth="8" />
      <rect y="340" width="400" height="160" fill="#0a0a0a" />
      {/* light on the floor */}
      <path d="M40 340 L 360 340 L 400 500 L 0 500 Z" fill="#fb923c" opacity="0.12" />
      {/* the rack, the bar, the plates */}
      <g fill="#0a0a0a">
        <rect x="104" y="150" width="12" height="230" />
        <rect x="284" y="150" width="12" height="230" />
        <rect x="98" y="150" width="204" height="10" />
        <rect x="92" y="372" width="36" height="10" />
        <rect x="272" y="372" width="36" height="10" />
        <rect x="70" y="250" width="260" height="6" rx="3" />
        <rect x="58" y="226" width="14" height="54" rx="3" />
        <rect x="44" y="232" width="12" height="42" rx="3" />
        <rect x="328" y="226" width="14" height="54" rx="3" />
        <rect x="344" y="232" width="12" height="42" rx="3" />
      </g>
      <path d="M0 400 Q 200 380 400 400" stroke="#fff" strokeOpacity="0.06" strokeWidth="2" fill="none" />
    </>
  ),

  /* ── It takes the time it takes ────────────────────────────────────────── */
  seed_to_tree: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#111827" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
        <radialGradient id={`${id}halo`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#22c55e" stopOpacity="0.35" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${id}bg)`} />
      <rect y="360" width="400" height="140" fill="#140d08" />
      <rect y="356" width="400" height="6" fill="#14532d" />
      {/* 1: seed */}
      <ellipse cx="52" cy="380" rx="8" ry="5" fill="#a16207" />
      {/* 2: sprout */}
      <path d="M140 358 V 336" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
      <path d="M140 342 Q 128 332 124 338 Q 130 346 140 342 Z M 140 338 Q 152 328 156 334 Q 150 342 140 338 Z" fill="#4ade80" />
      {/* 3: sapling */}
      <path d="M236 358 V 290" stroke="#78350f" strokeWidth="5" strokeLinecap="round" />
      <circle cx="236" cy="282" r="24" fill="#16a34a" />
      <circle cx="222" cy="296" r="14" fill="#15803d" />
      <circle cx="250" cy="294" r="13" fill="#22c55e" />
      {/* 4: the tree */}
      <circle cx="338" cy="190" r="110" fill={`url(#${id}halo)`} />
      <path d="M338 358 V 220 M 338 260 L 314 230 M 338 240 L 362 212" stroke="#78350f" strokeWidth="11" strokeLinecap="round" />
      <circle cx="338" cy="170" r="50" fill="#16a34a" />
      <circle cx="300" cy="196" r="32" fill="#15803d" />
      <circle cx="376" cy="194" r="32" fill="#22c55e" />
      <circle cx="338" cy="132" r="30" fill="#4ade80" />
      <circle cx="356" cy="162" r="4" fill={RED} />
      <circle cx="318" cy="182" r="4" fill={RED} />
      <circle cx="346" cy="198" r="4" fill={RED} />
      {/* time passing */}
      <path d="M30 420 H 370" stroke="#374151" strokeWidth="2" strokeDasharray="2 6" />
      {[52, 140, 236, 338].map((x, i) => <circle key={x} cx={x} cy="420" r={4 + i} fill={i === 3 ? RED : "#4b5563"} />)}
    </>
  ),
};
