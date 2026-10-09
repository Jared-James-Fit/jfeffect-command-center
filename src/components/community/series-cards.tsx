import { useEffect, useId, useState } from "react";
import { ArrowLeftRight, ChevronRight, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEDALS,
  compareBars,
  extraFeature,
  extraObservation,
  recapSummary,
  winsHero,
  winsWeekLabel,
  type CommunityPost,
  type CrewCompare,
  type RecapStats,
} from "@/lib/community";

/**
 * Sunday Recap: the whole week on one card, readable at a glance by someone
 * who's never lifted. A ring for how much of the plan got done, four plain
 * numbers, workouts by day, the week's top 3, and one thing to work on.
 */
export function SundayRecapCard({ stats, unit, className }: { stats: RecapStats; unit: "kg" | "lb"; className?: string }) {
  const [shown, setShown] = useState(unit);
  useEffect(() => setShown(unit), [unit]);
  const sum = recapSummary(stats);
  const hero = winsHero(stats, shown);
  const tiles: { value: string; label: string; sub?: string; flip?: boolean }[] = [
    { value: stats.prs.toLocaleString("en-US"), label: stats.prs === 1 ? "personal record" : "personal records", sub: stats.pr_people > 1 ? `set by ${stats.pr_people} people` : undefined },
    { value: `${hero.amount}`, label: `${hero.unit} lifted together`, sub: hero.change ?? undefined, flip: true },
    { value: sum.logPct != null ? `${sum.logPct}%` : "–", label: "workouts fully logged", sub: sum.logPct != null ? `${stats.fully_logged} of ${stats.completed}` : undefined },
    stats.streaks > 0
      ? { value: String(stats.streaks), label: stats.streaks === 1 ? "person hasn't missed a week" : "people haven't missed a week", sub: "in a month or more" }
      : { value: String(stats.checkins), label: stats.checkins === 1 ? "weekly check-in sent" : "weekly check-ins sent" },
  ];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl px-4 pb-4 pt-3.5 text-white",
        "bg-[#0a0a0d] bg-[radial-gradient(120%_80%_at_0%_0%,rgba(239,51,64,0.42),rgba(127,29,29,0.12)_45%,#0a0a0d_75%)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <img src="/logo.png" alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
          <span className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-white/75">Week recap</span>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em] text-red-400">{winsWeekLabel(stats.week_of)}</span>
      </div>

      {/* The plan, as one ring */}
      <div className="mt-3.5 flex items-center gap-4">
        <PlanRing pct={sum.planPct} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-black leading-tight">
            {sum.planPct != null ? "of planned sessions done" : `${stats.sessions} workouts finished`}
          </div>
          {stats.active > 0 && (
            <div className="mt-1 text-[13px] font-semibold leading-snug text-white/80">
              {stats.hit} of {stats.active} hit their weekly target
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/85">{stats.sessions} workouts</span>
            {sum.vsLast && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/70">{sum.vsLast}</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-white/10 pt-3.5">
        {tiles.map((t) =>
          t.flip ? (
            <button
              key={t.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShown(shown === "lb" ? "kg" : "lb");
              }}
              className="min-w-0 text-left"
              aria-label={`Show in ${shown === "lb" ? "kg" : "lb"}`}
            >
              <div className="flex items-center gap-1">
                <span className="font-display truncate text-[30px] uppercase leading-none">{t.value}</span>
                <ArrowLeftRight className="h-3 w-3 shrink-0 text-white/40" aria-hidden />
              </div>
              <div className="mt-1 text-[12px] font-bold leading-tight text-white/80">{t.label}</div>
              {t.sub && <div className="mt-0.5 text-[11px] leading-tight text-white/50">{t.sub}</div>}
            </button>
          ) : (
            <div key={t.label} className="min-w-0">
              <div className="font-display truncate text-[30px] uppercase leading-none">{t.value}</div>
              <div className="mt-1 text-[12px] font-bold leading-tight text-white/80">{t.label}</div>
              {t.sub && <div className="mt-0.5 text-[11px] leading-tight text-white/50">{t.sub}</div>}
            </div>
          ),
        )}
      </div>

      {/* Workouts by day */}
      <div className="mt-4 border-t border-white/10 pt-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Workouts by day</span>
          {stats.busiest_day && <span className="text-[10px] text-white/45">busiest: {stats.busiest_day}</span>}
        </div>
        <div className="mt-2 flex h-[70px] items-end gap-1.5" role="img" aria-label={sum.days.map((d) => `${d.letter}: ${d.n}`).join(", ")}>
          {sum.days.map((d, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
              <span className={cn("mb-0.5 text-[10px] font-black leading-none", d.best ? "text-white" : "text-white/55")}>{d.n}</span>
              <div className={cn("w-full max-w-[30px] rounded-t-[5px]", d.best ? "bg-[#ef3340]" : "bg-white/20")} style={{ height: `${Math.max(3, Math.round(d.share * 46))}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {sum.days.map((d, i) => (
            <span key={i} className="flex-1 text-center text-[10px] font-bold text-white/45">{d.letter}</span>
          ))}
        </div>
      </div>

      {stats.top.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3.5">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Biggest moments</div>
          <ol className="mt-2 space-y-2">
            {stats.top.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-[1px] shrink-0 text-[18px] leading-none" aria-hidden>{MEDALS[i]}</span>
                <span className="min-w-0 text-[13px] font-semibold leading-snug text-white/90">{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {stats.improve && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2.5">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/55">Work on this week</div>
            <div className="mt-0.5 text-[13px] font-semibold leading-snug text-white/90">{stats.improve.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanRing({ pct }: { pct: number | null }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const id = `recap-ring-${useId().replace(/:/g, "")}`;
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5a64" />
            <stop offset="1" stopColor="#ef3340" />
          </linearGradient>
        </defs>
        <circle cx="46" cy="46" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        {pct != null && (
          <circle cx="46" cy="46" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-[24px] leading-none">{pct != null ? `${pct}%` : "–"}</span>
      </div>
    </div>
  );
}

/** Two bars, habit vs everyone else, with how many people each side is. */
export function CompareBars({ compare, className }: { compare: CrewCompare; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {compareBars(compare).map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[12px] font-bold">
              {r.label}
              <span className="font-semibold text-muted-foreground"> · {r.count}</span>
            </span>
            <span className="shrink-0 text-[12px] font-black">{r.value}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", r.lead ? "bg-primary" : "bg-foreground/25")} style={{ width: `${Math.max(4, Math.round(r.share * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What a Tuesday data post or a Thursday feature shows under its words.
 * Nothing for library tips (their kind rides in the label) or Saturday
 * (the picture sits above the words).
 */
export function SeriesExtraCard({ post, className }: { post: CommunityPost; className?: string }) {
  const obs = post.series === "tuesday_tips" ? extraObservation(post.series_extra) : null;
  const feature = post.series === "try_it_thursday" ? extraFeature(post.series_extra) : null;
  if (obs) {
    return (
      <div className={cn("rounded-2xl border border-border/70 bg-muted/40 px-3.5 py-3", className)}>
        <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" aria-hidden />
          {obs.habit === "sleep" ? "From your workout reviews" : "From the app · last 8 weeks"}
        </div>
        <CompareBars compare={obs} />
        <div className="mt-2.5 text-[10px] leading-snug text-muted-foreground">
          {obs.habit === "sleep" ? "How sessions were rated, by sleep the night before." : "People who joined in the last 8 weeks aren't counted."}
        </div>
      </div>
    );
  }
  if (feature) {
    return (
      <div className={cn("rounded-2xl border border-border/70 bg-muted/40 px-3.5 py-3", className)}>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Try it</div>
        <div className="mt-0.5 text-[16px] font-black leading-tight">{feature.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {feature.where.map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />}
              <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold shadow-sm ring-1 ring-border/70">{w}</span>
            </span>
          ))}
        </div>
        {feature.stat && (
          <>
            <div className="mt-3 border-t border-border/60 pt-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
              How the crew trains · last 8 weeks
            </div>
            <CompareBars compare={feature.stat} className="mt-2" />
          </>
        )}
      </div>
    );
  }
  return null;
}
