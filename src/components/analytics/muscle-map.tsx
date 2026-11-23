/**
 * The muscle map: the app's own anatomical drawing (the pain map's, front and
 * back side by side) with each muscle shaded by how much training it got in
 * the period, relative to the most-trained muscle. A tap (or hover) on a
 * muscle, or a row in the ranked list, opens it: sets a week, how many of
 * them aimed at it, days a week, its share, the exercises behind it and its
 * last 12 weeks. The counting rule is on screen and the athlete picks how
 * secondary muscles count. Exposure, never a measure of growth.
 */
import { memo, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/analytics/info-tip";
import { Figure, LabHeader, Seg } from "@/components/analytics/lab-ui";
import { atlasView } from "@/lib/pain/anatomy/atlas";
import { VIEW_W } from "@/lib/pain/anatomy/geometry";
import {
  SECONDARY_RULES,
  siteMuscles,
  type ExposureRead,
  type MuscleExposure,
  type SecondaryRule,
} from "@/lib/analytics/muscle-exposure";
import type { FineMuscle } from "@/lib/analytics/training-load";

const UNMAPPED = "color-mix(in oklch, var(--muted-foreground) 16%, var(--card))";
const heat = (level: number) => (level <= 0 ? UNMAPPED : `var(--heat-${level})`);
// the body from the head to the feet (the drawing's 920-tall frame, trimmed)
const VIEWBOX = `0 14 ${VIEW_W} 900`;

const Body = memo(function Body({
  view,
  levels,
  picked,
  onPick,
  onHover,
}: {
  view: "front" | "back";
  levels: Map<FineMuscle, number>;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle) => void;
  onHover: (m: FineMuscle | null) => void;
}) {
  const v = atlasView(view);
  const map = useMemo(() => siteMuscles(view), [view]);
  const muscles = v.parts.filter((p) => !p.deep && p.kind === "muscle");
  return (
    <svg
      viewBox={VIEWBOX}
      className="h-auto w-full"
      role="img"
      aria-label={`${view === "front" ? "Front" : "Back"} of the body, muscles shaded by training`}
      data-muscle-body={view}
    >
      <path d={v.silhouette} fill="var(--muted)" stroke="var(--border)" strokeWidth={1.5} />
      <path d={v.head} fill="var(--muted)" stroke="var(--border)" strokeWidth={1.5} />
      {muscles.map((p) => {
        const m = p.site ? (map.get(p.site) ?? null) : null;
        const level = m ? (levels.get(m) ?? 0) : -1;
        const on = !!m && picked === m;
        return (
          <path
            key={p.id}
            d={p.d}
            fill={m ? heat(level) : UNMAPPED}
            stroke={on ? "var(--foreground)" : "var(--card)"}
            strokeWidth={on ? 3 : 1.2}
            strokeLinejoin="round"
            className={cn(
              m && "cursor-pointer transition-[fill,opacity] duration-300",
              picked && m !== picked && "opacity-70",
            )}
            data-muscle-part={m ?? undefined}
            onClick={m ? () => onPick(m) : undefined}
            onPointerEnter={(e) => {
              if (m && e.pointerType === "mouse") onHover(m);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") onHover(null);
            }}
          />
        );
      })}
    </svg>
  );
});

function Bars({ values, label }: { values: Array<{ week: string; sets: number }>; label: string }) {
  const max = Math.max(1, ...values.map((v) => v.sets));
  return (
    <div
      className="flex h-10 items-end gap-[2px]"
      role="img"
      aria-label={`${label}: ${values.map((v) => v.sets).join(", ")}`}
    >
      {values.map((v, i) => (
        <span
          key={v.week}
          className={cn(
            "min-w-0 flex-1 rounded-t-[3px]",
            i === values.length - 1 ? "bg-[var(--heat-3)]" : "bg-[var(--heat-2)]",
          )}
          style={{
            height: `${Math.max(v.sets > 0 ? 8 : 2, (v.sets / max) * 100)}%`,
            opacity: v.sets > 0 ? 1 : 0.35,
          }}
          title={`Week of ${v.week}: ${v.sets} sets`}
        />
      ))}
    </div>
  );
}

function MuscleDetail({
  m,
  read,
  onClose,
}: {
  m: MuscleExposure;
  read: ExposureRead;
  onClose: () => void;
}) {
  const helping = Math.round((m.perWeek - m.directPerWeek) * 10) / 10;
  const per = read.basis.partial ? "this week" : "a week";
  return (
    <div
      className="jf-lab-in space-y-3 rounded-xl border border-border p-3"
      data-muscle-detail={m.muscle}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-[3px]"
          style={{ background: heat(m.level) }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {m.muscle}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Figure
          label={`Sets ${per}`}
          value={m.perWeek}
          sub={
            helping > 0 ? `${m.directPerWeek} aimed at it · ${helping} helping` : "all aimed at it"
          }
        />
        <Figure
          label="Days a week"
          value={m.directPerWeek > 0 ? m.frequency : "—"}
          sub={m.directPerWeek > 0 ? "with a set aimed at it" : "only as a helper"}
        />
        <Figure label="Share" value={`${Math.round(m.share * 100)}%`} sub="of all muscle sets" />
      </div>
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">
          <div>Sets each week, last 12 weeks</div>
          {m.change && (
            <div className="tabular-nums text-foreground">
              {m.change.pct === 0
                ? "No change"
                : `${m.change.pct > 0 ? "Up" : "Down"} ${Math.abs(m.change.pct)}%`}
              <span className="text-muted-foreground">
                : {m.change.now} a week over the last 4 weeks, {m.change.before} the 4 before
              </span>
            </div>
          )}
        </div>
        <Bars values={m.weekly} label={`${m.muscle}, sets each week`} />
      </div>
      {m.exercises.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Where the sets came from (this period)
          </div>
          <ul className="space-y-1">
            {m.exercises.slice(0, 6).map((e) => (
              <li key={e.name} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate text-foreground">{e.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {e.direct > 0 ? `${e.direct} set${e.direct === 1 ? "" : "s"}` : ""}
                  {e.direct > 0 && e.indirect > 0 ? " + " : ""}
                  {e.indirect > 0 ? `${e.indirect} helping` : ""}
                </span>
              </li>
            ))}
          </ul>
          {m.exercises.length > 6 && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              and {m.exercises.length - 6} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MuscleMap({
  read,
  rule,
  onRule,
  rangeLabel,
  compact = false,
  onOpen,
}: {
  read: ExposureRead;
  rule: SecondaryRule;
  onRule?: (r: SecondaryRule) => void;
  rangeLabel: string;
  /** the Overview's version: the two bodies and the top three, a tap opens Training */
  compact?: boolean;
  onOpen?: () => void;
}) {
  const [picked, setPicked] = useState<FineMuscle | null>(null);
  const [hover, setHover] = useState<FineMuscle | null>(null);
  const [shown, setShown] = useState<"map" | "list">("map");
  const levels = useMemo(() => new Map(read.muscles.map((m) => [m.muscle, m.level])), [read]);
  const pick = (m: FineMuscle) => setPicked((p) => (p === m ? null : m));
  const top = read.muscles.slice(0, 3);
  const per = read.basis.partial ? "this week" : "a week";

  if (!read.muscles.length) {
    return compact ? null : (
      <Card className="p-4 text-sm text-muted-foreground" data-muscle-map="empty">
        No sets credited to a muscle in {rangeLabel.toLowerCase()} yet.
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="p-0" data-muscle-map="compact">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-2xl p-4 text-left transition active:bg-muted/40"
          aria-label="Open Training"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">Muscle emphasis · {rangeLabel}</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2">
            <div className="pointer-events-none">
              <Body
                view="front"
                levels={levels}
                picked={null}
                onPick={() => {}}
                onHover={() => {}}
              />
            </div>
            <div className="pointer-events-none">
              <Body
                view="back"
                levels={levels}
                picked={null}
                onPick={() => {}}
                onHover={() => {}}
              />
            </div>
            <ol className="space-y-2">
              {top.map((m, i) => (
                <li key={m.muscle} className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className="tabular-nums">{i + 1}</span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ background: heat(m.level) }}
                      aria-hidden
                    />
                  </div>
                  <div className="truncate text-[13px] font-semibold text-foreground">
                    {m.muscle}
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {m.perWeek} sets {per}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </button>
      </Card>
    );
  }

  const sel = read.muscles.find((m) => m.muscle === picked) ?? null;
  const hov = hover ? (read.muscles.find((m) => m.muscle === hover) ?? null) : null;
  return (
    <Card className="space-y-3 p-4" data-muscle-map="full" data-muscle-rule={rule}>
      <LabHeader
        title="Muscles"
        sub={`Training each muscle got, ${rangeLabel.toLowerCase()}`}
        tip={
          <InfoTip label="How muscles are counted" title="How muscles are counted" align="start">
            Working sets only (never warm-ups, cardio or mobility). A set gives each muscle its
            exercise lists as primary a full set, and each secondary muscle the amount you pick
            below (½ by default). A muscle counts once per set. Shading is relative to your
            most-trained muscle. This is training exposure, not a measure of muscle growth.
          </InfoTip>
        }
        action={
          <Seg
            label="Show as"
            value={shown}
            options={[
              ["map", "Map"],
              ["list", "List"],
            ]}
            onChange={setShown}
            size="sm"
            testId="muscle-shown"
          />
        }
      />
      {onRule && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span>Secondary muscles count as</span>
          <Seg
            label="Secondary muscles count as"
            value={rule}
            options={SECONDARY_RULES}
            onChange={(r) => onRule(r)}
            size="sm"
            testId="muscle-rule"
          />
        </div>
      )}

      {shown === "map" ? (
        <div className="relative">
          <div className="mx-auto grid max-w-[460px] grid-cols-2 gap-3" data-muscle-bodies>
            {(["front", "back"] as const).map((v) => (
              <figure key={v} className="min-w-0">
                <Body view={v} levels={levels} picked={picked} onPick={pick} onHover={setHover} />
                <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">
                  {v === "front" ? "Front" : "Back"}
                </figcaption>
              </figure>
            ))}
          </div>
          {hov && hov.muscle !== picked && (
            <div
              className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background"
              role="tooltip"
            >
              {hov.muscle} · {hov.perWeek} sets {per}
            </div>
          )}
          <div
            className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
            aria-hidden
          >
            <span>Less</span>
            {[1, 2, 3, 4].map((l) => (
              <span key={l} className="h-3 w-5 rounded-[3px]" style={{ background: heat(l) }} />
            ))}
            <span>More (vs your most-trained)</span>
          </div>
          {!picked && (
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              Tap a muscle for its sets, days and exercises.
            </p>
          )}
        </div>
      ) : null}

      {/* the ranked list: the same numbers as the map, the accessible way in */}
      <ul
        className={cn("space-y-1", shown === "map" && "sr-only")}
        data-muscle-list
        aria-label="Muscles ranked by training"
      >
        {read.muscles.map((m, i) => (
          <li key={m.muscle}>
            <button
              type="button"
              onClick={() => pick(m.muscle)}
              aria-expanded={picked === m.muscle}
              className={cn(
                "w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                picked === m.muscle && "bg-muted",
              )}
              data-muscle-row={m.muscle}
            >
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {m.muscle}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  <span className="font-semibold">{m.perWeek}</span>
                  <span className="text-muted-foreground"> sets {per}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-7">
                <span className="flex h-1.5 min-w-0 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted">
                  <span
                    className="h-full rounded-full bg-[var(--heat-3)]"
                    style={{
                      width: `${(m.directPerWeek / Math.max(0.1, read.muscles[0].perWeek)) * 100}%`,
                    }}
                  />
                  <span
                    className="h-full rounded-full bg-[var(--heat-1)]"
                    style={{
                      width: `${((m.perWeek - m.directPerWeek) / Math.max(0.1, read.muscles[0].perWeek)) * 100}%`,
                    }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {m.directPerWeek > 0 ? `${m.frequency} d/wk` : "helping only"} ·{" "}
                  {Math.round(m.share * 100)}%
                </span>
              </div>
            </button>
            {shown === "list" && picked === m.muscle && sel && (
              <div className="mt-1">
                <MuscleDetail m={sel} read={read} onClose={() => setPicked(null)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {shown === "list" && (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-4 rounded-full bg-[var(--heat-3)]" /> Aimed at it
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-4 rounded-full bg-[var(--heat-1)]" /> Helping
          </span>
        </div>
      )}
      {shown === "map" && sel && (
        <MuscleDetail m={sel} read={read} onClose={() => setPicked(null)} />
      )}
      {read.untagged > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {read.untagged} set{read.untagged === 1 ? "" : "s"} in this period{" "}
          {read.untagged === 1 ? "is" : "are"} on exercises the library hasn't tagged with muscles,
          so {read.untagged === 1 ? "it isn't" : "they aren't"} counted here.
        </p>
      )}
    </Card>
  );
}
