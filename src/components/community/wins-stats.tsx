import { cn } from "@/lib/utils";
import { pct, winsHabitsLine, winsStatTiles, winsWeekLabel, type WinsStats } from "@/lib/community";

/**
 * Wednesday Wins: the crew's week as one branded card under the post. Big
 * "X of Y trained" ring up top, then six plain-English numbers, then the
 * small habits line. Same dark/red look as the workout and Locked In cards.
 */
export function WinsStatsCard({ stats, unit, className }: { stats: WinsStats; unit: "kg" | "lb"; className?: string }) {
  const tiles = winsStatTiles(stats, unit);
  const habits = winsHabitsLine(stats);
  const showed = pct(stats.trained, stats.roster);
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

      <div className="mt-3.5 flex items-center gap-4">
        <Ring value={showed} />
        <div className="min-w-0">
          <div className="font-display text-[38px] uppercase leading-none">
            {stats.trained} <span className="text-white/45">of</span> {stats.roster}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-white/75">trained last week</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3.5 border-t border-white/10 pt-3.5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <div className="font-display truncate text-[26px] uppercase leading-none">{t.value}</div>
            <div className="mt-1 text-[10px] font-black uppercase leading-tight tracking-[0.1em] text-white/60">{t.label}</div>
            {t.sub && <div className="mt-0.5 text-[10px] leading-tight text-white/50">{t.sub}</div>}
          </div>
        ))}
      </div>

      {habits && <div className="mt-3.5 border-t border-white/10 pt-2.5 text-[11px] font-semibold text-white/55">{habits}</div>}
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#ef3340" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * Math.min(value, 100)) / 100} ${c}`} />
      </svg>
      <span className="font-display absolute inset-0 grid place-items-center text-[17px] leading-none">{value}%</span>
    </div>
  );
}
