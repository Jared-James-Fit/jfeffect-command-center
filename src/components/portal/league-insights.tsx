import { Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLeaguePoints } from "@/lib/league-points";
import type { LeagueRow } from "@/lib/league-boost";
import { POINT_SOURCES, coachFocus, edgesOver, pointsBySource } from "@/lib/league-insights";

type Row = Parameters<typeof pointsBySource>[0];

/**
 * Where a row's points come from: one thin stacked bar, its length relative
 * to the board leader so the gap between rows is visible too.
 */
export function PointsBar({ row, max, className }: { row: Row; max: number; className?: string }) {
  const p = pointsBySource(row);
  const total = POINT_SOURCES.reduce((n, s) => n + p[s.key], 0);
  if (total <= 0 || max <= 0) return null;
  const parts = POINT_SOURCES.filter((s) => p[s.key] > 0);
  const label = parts.map((s) => `${s.label} ${formatLeaguePoints(p[s.key])}`).join(", ");
  return (
    <div className={cn("h-1.5 w-full", className)} role="img" aria-label={`Points: ${label}`}>
      <div className="flex h-full gap-[2px]" style={{ width: `${Math.min(100, (total / max) * 100)}%` }}>
        {parts.map((s) => (
          <span key={s.key} className={cn("h-full rounded-full", s.color)} style={{ flexGrow: p[s.key], flexBasis: 0 }} />
        ))}
      </div>
    </div>
  );
}

/** Legend for the bars: only the sources someone on the board actually scored. */
export function PointsLegend({ rows }: { rows: Row[] }) {
  const present = POINT_SOURCES.filter((s) => rows.some((r) => pointsBySource(r)[s.key] > 0));
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] font-semibold text-muted-foreground">
      <span className="font-black uppercase tracking-wider">Points from</span>
      {present.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", s.color)} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Head to head for the month: each source side by side, the bigger side
 * filled. Says in one line where the other athlete's lead comes from.
 */
export function VsCard({ me, them, themName }: { me: Row & { total_points: number }; them: Row & { total_points: number }; themName: string }) {
  const a = pointsBySource(me);
  const b = pointsBySource(them);
  const rows = POINT_SOURCES.filter((s) => a[s.key] > 0 || b[s.key] > 0);
  const top = Math.max(1, ...rows.map((s) => Math.max(a[s.key], b[s.key])));
  const theirEdges = edgesOver(them, me).slice(0, 2);
  const myEdges = edgesOver(me, them).slice(0, 2);
  const lead = Number(them.total_points) - Number(me.total_points);
  const first = themName.split(" ")[0];
  const summary = lead > 0
    ? `${first} leads by ${formatLeaguePoints(lead)}${theirEdges.length ? `, mostly from ${theirEdges.map((e) => `${e.label.toLowerCase()} (+${formatLeaguePoints(e.diff)})`).join(" and ")}` : ""}.`
    : lead < 0
      ? `You lead by ${formatLeaguePoints(-lead)}${myEdges.length ? `, mostly from ${myEdges.map((e) => `${e.label.toLowerCase()} (+${formatLeaguePoints(e.diff)})`).join(" and ")}` : ""}.`
      : "Dead even.";

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 px-4 pt-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">You</div>
          <div className={cn("text-2xl font-black tabular-nums leading-none", lead < 0 && "text-primary")}>{formatLeaguePoints(me.total_points)}</div>
        </div>
        <div className="pb-0.5 text-xs font-black text-muted-foreground">VS</div>
        <div className="text-right">
          <div className="truncate text-[10px] font-black uppercase tracking-wider text-muted-foreground">{first}</div>
          <div className={cn("text-2xl font-black tabular-nums leading-none", lead > 0 && "text-primary")}>{formatLeaguePoints(them.total_points)}</div>
        </div>
      </div>
      <p className="px-4 pt-2 text-xs font-semibold leading-snug">{summary}</p>
      <ul className="mt-2 space-y-2 border-t px-4 py-3">
        {rows.map((s) => {
          const mine = a[s.key];
          const theirs = b[s.key];
          return (
            <li key={s.key}>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className={cn("w-10 font-black tabular-nums", mine > theirs ? "text-foreground" : "text-muted-foreground")}>{formatLeaguePoints(mine)}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
                  <span className={cn("h-2 w-2 rounded-full", s.color)} />{s.label}
                </span>
                <span className={cn("w-10 text-right font-black tabular-nums", theirs > mine ? "text-foreground" : "text-muted-foreground")}>{formatLeaguePoints(theirs)}</span>
              </div>
              <div className="grid grid-cols-2 gap-[2px]">
                <div className="flex h-1.5 justify-end rounded-full bg-muted">
                  <span className={cn("h-full rounded-full", s.color, mine < theirs && "opacity-40")} style={{ width: `${(mine / top) * 100}%` }} />
                </div>
                <div className="flex h-1.5 rounded-full bg-muted">
                  <span className={cn("h-full rounded-full", s.color, theirs < mine && "opacity-40")} style={{ width: `${(theirs / top) * 100}%` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type FocusRow = Parameters<typeof coachFocus>[0];

/** The coach's 1–2 highest-value moves for the rest of the month. */
export function CoachFocus({ me, title = "Coach's focus", className }: { me: FocusRow | LeagueRow; title?: string; className?: string }) {
  const tips = coachFocus(me);
  if (tips.length === 0) return null;
  return (
    <div className={cn("rounded-2xl border border-primary/30 bg-background p-3", className)}>
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-primary">
        <Target className="h-3.5 w-3.5" /> {title}
      </div>
      <ol className="mt-2 space-y-2.5">
        {tips.map((t, i) => (
          <li key={t.key} className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-sm font-black leading-tight">{t.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{t.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
