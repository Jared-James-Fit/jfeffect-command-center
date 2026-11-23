/**
 * The Overview's pieces: Cleo's one observation (worked out in code,
 * performance-observation.ts), the key numbers for this athlete, recovery
 * patterns as two-bar comparisons, and consistency as a ring with its weeks.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CleoMark } from "@/components/summer/cleo-mark";
import { openSummer } from "@/components/summer/summer-assistant";
import type { Observation } from "@/lib/analytics/performance-observation";
import type { RecoveryPattern } from "@/lib/analytics/recovery-intel";
import type { AdherenceWeek, Consistency } from "@/lib/analytics/analytics-areas";
import { ProgressRing } from "@/components/analytics/viz";

/**
 * Observation and tip, one compact block. A tap shows the numbers behind it;
 * a coach with Cleo can carry it into a conversation (the words go in the
 * box, never sent by themselves).
 */
export function CleoObservationCard({
  o,
  askCleo,
  athleteName,
}: {
  o: Observation;
  askCleo?: boolean;
  athleteName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl border border-border p-4"
      data-cleo-observation={o.id}
      data-tone={o.tone}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <CleoMark size={15} className="text-foreground" />
        <span>Cleo</span>
        <span aria-hidden>·</span>
        <span>From your training logs</span>
      </div>
      <p className="mt-2 text-[15px] font-medium leading-snug text-foreground" data-observation>
        {o.observation}
      </p>
      <p className="mt-1.5 text-[14px] leading-snug text-muted-foreground" data-tip>
        <span className="font-medium text-foreground/80">Tip: </span>
        {o.tip}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        {o.evidence.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-foreground"
          >
            The numbers behind it
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        )}
        {askCleo && (
          <button
            type="button"
            onClick={() =>
              openSummer({
                prompt: `${athleteName ? `${athleteName}'s analytics: ` : ""}${o.observation} ${o.evidence.map((e) => (e.label ? `${e.label}: ${e.value}.` : e.value)).join(" ")} What would you look at next?`,
              })
            }
            className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-foreground"
            data-ask-cleo
          >
            <MessageCircle className="h-4 w-4" aria-hidden /> Ask Cleo
          </button>
        )}
      </div>
      {open && (
        <dl className="mt-1 space-y-1 border-t border-border/60 pt-2 text-[12px]" data-evidence>
          {o.evidence.map((e, i) =>
            e.label ? (
              <div key={i} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{e.label}</dt>
                <dd className="text-right tabular-nums text-foreground">{e.value}</dd>
              </div>
            ) : (
              <dd key={i} className="text-foreground/85">
                {e.value}
              </dd>
            ),
          )}
        </dl>
      )}
    </div>
  );
}

export type Kpi = {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  ring?: number | null;
  onOpen?: () => void;
};

/** The few numbers that answer "am I progressing, am I consistent": big, no boxes, a tap into the area. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  if (!items.length) return null;
  return (
    <div
      className={cn("grid gap-x-4 gap-y-4", items.length >= 3 ? "grid-cols-3" : "grid-cols-2")}
      data-kpi-strip
    >
      {items.map((k) => {
        const body = (
          <>
            <div className="truncate text-[12px] text-muted-foreground">{k.label}</div>
            <div className="mt-1 flex items-center gap-2">
              {k.ring !== undefined && (
                <ProgressRing
                  pct={k.ring}
                  size={34}
                  stroke={4}
                  tone="success"
                  label={`${k.ring ?? 0}%`}
                />
              )}
              <span className="min-w-0 truncate text-[22px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
                {k.value}
              </span>
            </div>
            {k.sub && (
              <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {k.sub}
              </div>
            )}
          </>
        );
        return k.onOpen ? (
          <button
            key={k.key}
            type="button"
            onClick={k.onOpen}
            className="min-w-0 rounded-lg text-left transition active:opacity-70"
            data-kpi={k.key}
          >
            {body}
          </button>
        ) : (
          <div key={k.key} className="min-w-0" data-kpi={k.key}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Each pattern: a title, one line, and (when it compares two groups) two bars. */
export function RecoveryPatternList({ patterns }: { patterns: RecoveryPattern[] }) {
  if (!patterns.length) return null;
  return (
    <ul className="max-w-2xl space-y-4" data-recovery-patterns>
      {patterns.map((p) => {
        const max = p.compare ? Math.max(p.compare.a.value, p.compare.b.value) : 1;
        const min = p.compare ? Math.min(p.compare.a.value, p.compare.b.value) : 0;
        // bars from a baseline under the smaller value, so a real gap reads as one
        const base = p.compare ? Math.max(0, min - (max - min) * 1.5) : 0;
        return (
          <li key={p.id} data-pattern={p.id}>
            <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  p.tone === "watch"
                    ? "bg-warning"
                    : p.tone === "good"
                      ? "bg-success"
                      : "bg-foreground/40",
                )}
                aria-hidden
              />
              {p.title}
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{p.words}</p>
            {p.compare && (
              <div
                className="mt-2 space-y-1.5"
                role="img"
                aria-label={`${p.compare.a.label} ${p.compare.a.value}, ${p.compare.b.label} ${p.compare.b.value} ${p.compare.unit}`}
              >
                {[p.compare.a, p.compare.b].map((g, i) => (
                  <div key={g.label} className="flex items-center gap-2 text-[12px]">
                    <span className="w-32 shrink-0 truncate text-muted-foreground">{g.label}</span>
                    <span className="relative h-2.5 flex-1 rounded-full bg-muted/60">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full",
                          i === 0 ? "bg-foreground/80" : "bg-foreground/35",
                        )}
                        style={{
                          width: `${Math.max(6, ((g.value - base) / Math.max(0.0001, max - base)) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
                      {g.value}
                      <span className="text-muted-foreground"> ({g.n})</span>
                    </span>
                  </div>
                ))}
                <div className="text-[11px] text-muted-foreground">
                  {p.compare.unit} · number of sessions in brackets
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Planned workouts done as a ring, and the weeks as small bars (done filled, planned outlined). */
export function ConsistencyBlock({ c, loading }: { c: Consistency; loading?: boolean }) {
  if (loading)
    return <div className="h-[120px] jf-skeleton rounded-xl bg-muted/40" aria-hidden />;
  if (!c.planned)
    return (
      <p className="text-[13px] text-muted-foreground" data-consistency-empty>
        {c.logged ? `${c.logged} workout${c.logged === 1 ? "" : "s"} logged. ` : ""}No planned
        workouts in this period to measure against.
      </p>
    );
  const weeks = c.weeks.slice(-12);
  const max = Math.max(1, ...weeks.map((w) => w.planned));
  return (
    <div className="flex items-center gap-4" data-consistency>
      <ProgressRing
        pct={c.pct}
        size={76}
        stroke={8}
        tone="success"
        label={`${c.pct}% of planned workouts done`}
      >
        <span className="text-[17px] font-semibold tabular-nums text-foreground">{c.pct}%</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-foreground">
          {c.done} of {c.planned} planned workouts
        </div>
        <div className="text-[12px] text-muted-foreground">
          {c.setsPct != null ? `${c.setsPct}% of written sets` : ""}
          {c.recent && c.before
            ? ` · last ${c.recent.weeks} weeks ${c.recent.pct}%, the ${c.before.weeks} before ${c.before.pct}%`
            : ""}
        </div>
        {weeks.length >= 2 && (
          <div
            className="mt-2 flex h-8 max-w-sm items-end gap-[3px]"
            role="img"
            aria-label="Planned workouts done each week"
          >
            {weeks.map((w: AdherenceWeek) => (
              <span
                key={w.key}
                className="relative flex-1 rounded-[2px] border border-foreground/25"
                style={{ height: `${(w.planned / max) * 100}%` }}
                title={`${w.label}: ${w.done} of ${w.planned}`}
              >
                <span
                  className={cn(
                    "absolute inset-x-0 bottom-0 rounded-[1px]",
                    w.current ? "bg-success/50" : "bg-success",
                  )}
                  style={{ height: `${w.planned ? (w.done / w.planned) * 100 : 0}%` }}
                />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
