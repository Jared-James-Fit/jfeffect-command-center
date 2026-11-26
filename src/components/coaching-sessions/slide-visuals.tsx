/**
 * The shared screen's pictures (Nov 25 2026): a countdown to the meet, the
 * athlete's all-time records, their workouts week by week and their weigh-ins
 * against the class limit. Every number is the athlete's own record
 * (visuals.ts decides which slide shows which, and only when there's data);
 * nothing here is Cleo's read or the coach's note. Plain SVG in the theme's
 * own tokens (the chart pair --chart-done / --chart-planned is validated in
 * light and dark), each picture labelled in words so colour never carries it.
 */
import { Trophy } from "lucide-react";
import type { PresentationVisuals, VisualKind } from "@/lib/coaching-sessions/visuals";

const shortDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "narrow", timeZone: "UTC" });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function SlideVisual({ kind, v }: { kind: VisualKind; v: PresentationVisuals }) {
  if (kind === "countdown" && v.countdown) return <Countdown c={v.countdown} />;
  if (kind === "records" && v.records.length) return <Records records={v.records} unit={v.unit} />;
  if (kind === "training" && v.training) return <TrainingWeeks t={v.training} />;
  if (kind === "bodyweight" && v.bodyweight) return <Bodyweight b={v.bodyweight} unit={v.unit} />;
  return null;
}

function Frame({ title, sub, children }: { title: string; sub?: string | null; children: React.ReactNode }) {
  return (
    <figure className="w-full rounded-3xl border border-border bg-card p-5 sm:p-7" data-slide-visual>
      <figcaption className="mb-4">
        <p className="text-[15px] font-semibold sm:text-[17px]">{title}</p>
        {sub ? <p className="text-[13px] text-muted-foreground sm:text-[14px]">{sub}</p> : null}
      </figcaption>
      {children}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Countdown: one dot a day, today filled, the meet a trophy            */

function Countdown({ c }: { c: NonNullable<PresentationVisuals["countdown"]> }) {
  const days = c.daysOut;
  if (days > 28) {
    const weeks = Math.ceil(days / 7);
    return (
      <Frame title={`${weeks} weeks to ${c.title}`} sub={c.date ? shortDay(c.date) : null}>
        <div className="flex flex-wrap gap-2" aria-hidden>
          {Array.from({ length: Math.min(weeks, 17) }).map((_, i) => (
            <span key={i} className={i === 0 ? "h-3 w-8 rounded-full bg-foreground" : "h-3 w-8 rounded-full bg-muted"} />
          ))}
        </div>
      </Frame>
    );
  }
  const start = c.date ? addDays(c.date, -days) : null;
  return (
    <Frame title={days === 0 ? "Meet day" : `${days} day${days === 1 ? "" : "s"} to go`} sub={c.date ? `${c.title} · ${shortDay(c.date)}` : c.title}>
      <ol className="flex flex-wrap items-end gap-2.5" aria-label={`${days} days until ${c.title}`}>
        {Array.from({ length: days + 1 }).map((_, i) => {
          const last = i === days;
          const iso = start ? addDays(start, i) : null;
          return (
            <li key={i} className="flex flex-col items-center gap-1.5">
              {last ? (
                <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-warning text-warning">
                  <Trophy className="h-5 w-5" />
                </span>
              ) : (
                <span className={i === 0 ? "h-7 w-7 rounded-full bg-foreground" : "h-7 w-7 rounded-full border-2 border-border"} />
              )}
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {i === 0 ? "Today" : last ? "Meet" : iso ? weekday(iso) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Records: a tile each, the load big                                  */

function Records({ records, unit }: { records: PresentationVisuals["records"]; unit: "kg" | "lb" }) {
  return (
    <Frame title="All-time PRs" sub="The last 4 weeks">
      <div className="grid gap-3">
        {records.slice(0, 3).map((r) => (
          <div key={`${r.exercise}-${r.date}`} className="flex items-center gap-4 rounded-2xl bg-muted px-4 py-3.5">
            <Trophy className="h-6 w-6 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium leading-tight sm:text-[17px]">{r.exercise}</p>
              <p className="text-[12px] text-muted-foreground sm:text-[13px]">{shortDay(r.date)}</p>
            </div>
            <p className="shrink-0 text-[24px] font-semibold tabular-nums sm:text-[30px]">
              {fmt(r.load)}
              <span className="ml-1 text-[14px] font-medium text-muted-foreground sm:text-[16px]">{unit}</span>
              <span className="ml-1.5 text-[18px] font-medium sm:text-[22px]">× {r.reps}</span>
            </p>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Training: each week's planned workouts as squares, done ones filled */

function TrainingWeeks({ t }: { t: NonNullable<PresentationVisuals["training"]> }) {
  const most = Math.max(...t.weeks.map((w) => w.planned), 1);
  return (
    <Frame title={`${t.done} of ${t.planned} planned workouts done`} sub="Week by week, the last 4 weeks">
      <div className="grid grid-cols-4 items-end gap-3 sm:gap-5" role="img" aria-label={t.weeks.map((w) => `Week of ${shortDay(w.start)}: ${w.done} of ${w.planned}`).join(". ")}>
        {t.weeks.map((w, k) => (
          <div key={w.start} className="flex flex-col items-center gap-2">
            <p className="text-[15px] font-semibold tabular-nums sm:text-[17px]">
              {w.done}
              <span className="text-muted-foreground">/{w.planned}</span>
            </p>
            <div className="flex flex-col-reverse gap-1.5" style={{ minHeight: most * 26 }}>
              {Array.from({ length: w.planned }).map((_, i) => (
                <span
                  key={i}
                  className="h-5 w-9 rounded-[5px] sm:w-12"
                  style={i < w.done ? { background: "var(--chart-done)" } : { border: "2px solid var(--chart-planned)" }}
                />
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground sm:text-[13px]">{k === 3 ? "This week" : shortDay(w.start)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-[12px] text-muted-foreground sm:text-[13px]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[3px]" style={{ background: "var(--chart-done)" }} /> Done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[3px]" style={{ border: "2px solid var(--chart-planned)" }} /> Planned, not done
        </span>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Bodyweight: each weigh-in, a soft line through them, the class limit */

function Bodyweight({ b, unit }: { b: NonNullable<PresentationVisuals["bodyweight"]>; unit: "kg" | "lb" }) {
  const pts = b.points;
  if (pts.length < 2) return null;
  const W = 560;
  const H = 220;
  const pad = { l: 44, r: 16, t: 14, b: 26 };
  const values = pts.map((p) => p.value).concat(b.limit != null ? [b.limit] : []);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = Math.max(hi - lo, unit === "kg" ? 2 : 4);
  const mid = (hi + lo) / 2;
  lo = mid - span * 0.65;
  hi = mid + span * 0.65;
  const d0 = Date.parse(`${pts[0]!.date}T00:00:00Z`);
  const d1 = Math.max(Date.parse(`${pts[pts.length - 1]!.date}T00:00:00Z`), d0 + 86_400_000);
  const x = (iso: string) => pad.l + ((Date.parse(`${iso}T00:00:00Z`) - d0) / (d1 - d0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  // a 3-point moving average, the line people read (single weigh-ins move with water)
  const avg = pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - 2), i + 1);
    return { date: p.date, value: win.reduce((a, q) => a + q.value, 0) / win.length };
  });
  const path = avg.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const latest = pts[pts.length - 1]!;
  const ticks = [lo + (hi - lo) * 0.2, (lo + hi) / 2, lo + (hi - lo) * 0.8];
  const sub = b.limit != null ? `${b.classLabel ?? "Class"} limit ${fmt(b.limit)} ${unit} · latest ${fmt(latest.value)} ${unit}` : `Latest ${fmt(latest.value)} ${unit} (${shortDay(latest.date)})`;
  return (
    <Frame title="Bodyweight, the last 6 weeks" sub={sub}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Bodyweight from ${shortDay(pts[0]!.date)} to ${shortDay(latest.date)}: ${pts.map((p) => fmt(p.value)).join(", ")} ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {b.limit != null ? (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(b.limit)} y2={y(b.limit)} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="6 5" />
            <text x={W - pad.r} y={y(b.limit) - 6} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">
              Limit {fmt(b.limit)}
            </text>
          </g>
        ) : null}
        <path d={path} fill="none" stroke="var(--chart-done)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={3.5} fill="var(--card)" stroke="var(--chart-done)" strokeWidth={2}>
            <title>{`${shortDay(p.date)}: ${fmt(p.value)} ${unit}`}</title>
          </circle>
        ))}
        <circle cx={x(latest.date)} cy={y(latest.value)} r={6} fill="var(--chart-done)" stroke="var(--card)" strokeWidth={2} />
        <text x={pad.l} y={H - 6} fontSize={11} fill="var(--muted-foreground)">
          {shortDay(pts[0]!.date)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
          {shortDay(latest.date)}
        </text>
      </svg>
    </Frame>
  );
}
