/**
 * How to film a set so its bar speed can be measured: one picture of what
 * the phone should see for this lift (the plate whole and round, the whole
 * rep inside the frame) beside where the phone goes (at the end of the bar,
 * level, 2 to 3 m away), then five short lines. Optional: opened from the
 * confirm step and from a footage note, never in the way.
 */
import { Camera, Gauge, Lightbulb, Ruler, Smartphone } from "lucide-react";
import type { GuideLift } from "@/lib/lift-analysis/exercise";

const FG = "var(--foreground)";
const MUTED = "var(--muted-foreground)";
const FAINT = "color-mix(in oklch, var(--muted-foreground) 35%, transparent)";

/** What the phone sees: a portrait frame with the lifter side-on, the plate whole, the bar's travel inside it. */
function PhoneView({ lift }: { lift: GuideLift }) {
  // the plate's centre at the top and the bottom of the rep, in a 90 × 160 frame
  const plate = { r: 13 };
  const travel =
    lift === "bench"
      ? { top: 78, bottom: 104 }
      : lift === "deadlift"
        ? { top: 92, bottom: 134 }
        : { top: 54, bottom: 98 };
  const y = lift === "deadlift" ? travel.bottom : travel.top;
  return (
    <svg
      viewBox="0 0 90 160"
      className="h-36 w-auto"
      role="img"
      aria-label="What the phone should see"
    >
      <rect
        x="1"
        y="1"
        width="88"
        height="158"
        rx="10"
        fill="none"
        stroke={MUTED}
        strokeWidth="1.5"
      />
      <line x1="6" y1="146" x2="84" y2="146" stroke={FAINT} strokeWidth="1.5" />
      {lift === "bench" ? (
        <g stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" fill="none">
          {/* bench and lifter lying on it */}
          <line x1="14" y1="114" x2="70" y2="114" />
          <line x1="22" y1="114" x2="22" y2="146" />
          <line x1="62" y1="114" x2="62" y2="146" />
          <line x1="20" y1="108" x2="58" y2="108" />
          <circle cx="64" cy="106" r="5" />
          <line x1="44" y1="108" x2="44" y2={y} />
        </g>
      ) : lift === "deadlift" ? (
        <g stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" fill="none">
          {/* lifter set up over the bar */}
          <circle cx="58" cy="62" r="5" />
          <line x1="54" y1="67" x2="34" y2="96" />
          <line x1="34" y1="96" x2="48" y2="118" />
          <line x1="48" y1="118" x2="40" y2="146" />
          <line x1="52" y1="74" x2="46" y2={y - 2} />
        </g>
      ) : (
        <g stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" fill="none">
          {/* lifter standing with the bar on the back */}
          <circle cx="50" cy="40" r="5" />
          <line x1="47" y1="46" x2="44" y2="96" />
          <line x1="44" y1="96" x2="50" y2="122" />
          <line x1="50" y1="122" x2="44" y2="146" />
        </g>
      )}
      {/* the bar's travel, top to bottom of the rep */}
      <line
        x1="44"
        y1={travel.top - plate.r - 3}
        x2="44"
        y2={travel.bottom + plate.r + 3}
        stroke={FG}
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.6"
      />
      <circle cx="44" cy={y} r={plate.r} fill="none" stroke={FG} strokeWidth="2.5" />
      <circle cx="44" cy={y} r="2.5" fill={FG} />
    </svg>
  );
}

/** Where the phone goes, seen from above: in line with the bar, past its end, pointing at the plate. */
function FromAbove() {
  return (
    <svg
      viewBox="0 0 150 90"
      className="h-24 w-auto"
      role="img"
      aria-label="Where to put the phone, seen from above"
    >
      {/* the bar and its plates */}
      <line x1="10" y1="30" x2="74" y2="30" stroke={MUTED} strokeWidth="3" strokeLinecap="round" />
      <rect x="10" y="18" width="6" height="24" rx="2" fill={MUTED} />
      <rect x="68" y="18" width="6" height="24" rx="2" fill={FG} />
      <circle cx="42" cy="30" r="7" fill="none" stroke={MUTED} strokeWidth="2" />
      {/* the phone, past the end of the bar, facing the plate */}
      <rect x="128" y="22" width="9" height="16" rx="2" fill="none" stroke={FG} strokeWidth="2" />
      <path d="M124 30 L84 30" stroke={FG} strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M88 26 L82 30 L88 34" fill="none" stroke={FG} strokeWidth="1.2" />
      <line x1="76" y1="60" x2="132" y2="60" stroke={MUTED} strokeWidth="1" />
      <line x1="76" y1="56" x2="76" y2="64" stroke={MUTED} strokeWidth="1" />
      <line x1="132" y1="56" x2="132" y2="64" stroke={MUTED} strokeWidth="1" />
      <text x="104" y="76" textAnchor="middle" fontSize="10" fill={MUTED}>
        2–3 m
      </text>
    </svg>
  );
}

const LINES: { icon: typeof Camera; text: (lift: GuideLift) => string }[] = [
  {
    icon: Smartphone,
    text: () =>
      "Side-on, pointing straight at the end of the bar. Level, about the height of the plate's middle.",
  },
  {
    icon: Camera,
    text: (lift) =>
      lift === "deadlift"
        ? "The whole plate in the frame from the floor to lockout."
        : lift === "bench"
          ? "The whole plate in the frame from your chest to lockout."
          : "The whole plate in the frame from the top to the bottom of the squat.",
  },
  { icon: Ruler, text: () => "Prop the phone up so it doesn't move. 2 to 3 m from the plate." },
  {
    icon: Gauge,
    text: () => "60 fps if your phone has it (iPhone: Settings → Camera → Record Video).",
  },
  {
    icon: Lightbulb,
    text: () => "Good light, and nobody walking between the phone and the plate.",
  },
];

export function FilmingGuide({ lift }: { lift: GuideLift }) {
  return (
    <div data-filming-guide={lift}>
      <div className="flex items-end justify-center gap-6 rounded-2xl bg-muted/50 px-3 py-4">
        <div className="flex flex-col items-center gap-1">
          <PhoneView lift={lift} />
          <span className="text-[11px] text-muted-foreground">On the phone</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <FromAbove />
          <span className="text-[11px] text-muted-foreground">From above</span>
        </div>
      </div>
      <ul className="mt-3 space-y-2.5">
        {LINES.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex gap-3 text-sm leading-snug">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{text(lift)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
