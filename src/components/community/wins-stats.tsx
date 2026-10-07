import { useEffect, useState } from "react";
import { ArrowLeftRight, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { winsChallenge, winsChart, winsHero, winsTiles, winsWeekLabel, type WinsStats } from "@/lib/community";

/**
 * Wednesday Wins: the crew's week as one branded card under the post, written
 * so someone who has never lifted gets it at a glance. One big team number
 * (everything lifted together, with an everyday comparison), four plain
 * stats, workouts per week for the last 8 weeks, and a goal for this week.
 * Weight starts in the viewer's own unit; tapping it flips lb/kg just here.
 */
export function WinsStatsCard({ stats, unit, className }: { stats: WinsStats; unit: "kg" | "lb"; className?: string }) {
  const [shown, setShown] = useState(unit);
  useEffect(() => setShown(unit), [unit]);
  const hero = winsHero(stats, shown);
  const tiles = winsTiles(stats);
  const bars = winsChart(stats);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl px-4 pb-4 pt-3.5 text-white",
        // solid base so the light theme never shows through the glow
        "bg-[#0a0a0d] bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.5),rgba(127,29,29,0.14)_45%,#0a0a0d_75%)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <img src="/logo.png" alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
          <span className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-white/75">JF Effect</span>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em] text-red-400">{winsWeekLabel(stats.week_of)}</span>
      </div>

      {stats.volume_kg > 0 && (
        <div className="mt-3.5">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Together the crew lifted</div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShown(shown === "lb" ? "kg" : "lb");
            }}
            className="mt-1 flex items-baseline gap-2 text-left"
            aria-label={`Show in ${shown === "lb" ? "kg" : "lb"}`}
          >
            <span className="font-display text-[44px] uppercase leading-none">{hero.amount}</span>
            <span className="font-display text-[22px] uppercase leading-none text-white/70">{hero.unit}</span>
            <ArrowLeftRight className="h-3 w-3 shrink-0 self-center text-white/40" aria-hidden />
          </button>
          {hero.compare && <div className="mt-1.5 text-[14px] font-semibold leading-snug text-white/85">{hero.compare}</div>}
          {(hero.badge || hero.change) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hero.badge && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[linear-gradient(90deg,#fde68a,#f59e0b)] px-2.5 py-0.5 text-[11px] font-black text-[#2b1700]">
                  <Trophy className="h-3 w-3" aria-hidden /> {hero.badge}
                </span>
              )}
              {hero.change && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/85">{hero.change}</span>}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-white/10 pt-3.5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <div className="font-display truncate text-[30px] uppercase leading-none">{t.value}</div>
            <div className="mt-1 text-[12px] font-bold leading-tight text-white/80">{t.label}</div>
            {t.sub && <div className="mt-0.5 text-[11px] leading-tight text-white/50">{t.sub}</div>}
          </div>
        ))}
      </div>

      {bars.length > 1 && (
        <div className="mt-4 border-t border-white/10 pt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Workouts each week</span>
            <span className="text-[10px] text-white/45">last {bars.length} weeks</span>
          </div>
          <div className="mt-2 flex h-[64px] items-end gap-[2px]" role="img" aria-label={bars.map((b) => `${b.label}: ${b.sessions}`).join(", ")}>
            {bars.map((b) => (
              <div key={b.wk} className="flex h-full flex-1 flex-col items-center justify-end" title={`Week of ${b.label}: ${b.sessions} workouts`}>
                {b.current && <span className="mb-0.5 text-[10px] font-black leading-none">{b.sessions}</span>}
                <div
                  className={cn("w-full max-w-[22px] rounded-t-[4px]", b.current ? "bg-[#ef3340]" : "bg-white/20")}
                  style={{ height: `${Math.max(4, Math.round(b.share * 48))}px` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-white/40">
            <span>{bars[0].label}</span>
            <span>{bars[bars.length - 1].label}</span>
          </div>
        </div>
      )}

      <div className="mt-3.5 rounded-xl bg-white/[0.06] px-3 py-2 text-[12px] font-bold text-white/85">{winsChallenge(stats)}</div>
    </div>
  );
}
