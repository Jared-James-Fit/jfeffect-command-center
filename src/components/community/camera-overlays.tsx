import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** The athlete's own clock, ticking while the camera is open. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const Scrim = ({ children }: { children: ReactNode }) => (
  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-6 pb-7 pt-28">{children}</div>
);

/** What the Locked in card stamps on the photo, live on the viewfinder. */
export function LockInStampPreview({ title }: { title: string }) {
  const time = useClock();
  return (
    <Scrim>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ef3340] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live {time}
      </span>
      <div className="font-display mt-1.5 text-[64px] uppercase leading-[0.9]">Locked in</div>
      <div className="mt-1 h-1 w-20 rounded-full bg-[#ef3340]" />
      <div className="mt-2 truncate text-[14px] font-bold text-white/90">{title}</div>
    </Scrim>
  );
}

/** What the photo card puts on a finished workout. */
export function WorkoutStampPreview({ title, sub }: { title: string; sub?: string | null }) {
  return (
    <Scrim>
      <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-black">✓ Done</span>
      <div className="font-display mt-1.5 line-clamp-2 text-[40px] uppercase leading-[0.95]">{title}</div>
      {sub && <div className="mt-1.5 text-[13px] font-bold text-white/80">{sub}</div>}
    </Scrim>
  );
}

/** "What this becomes" above the shutter. Tappable when there's a choice. */
export function CameraChip({ icon, title, sub, onPress, tone = "default" }: { icon: string; title: string; sub?: string | null; onPress?: () => void; tone?: "default" | "muted" }) {
  const body = (
    <>
      <span className="text-[18px] leading-none">{icon}</span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-[13px] font-black leading-tight">{title}</span>
        {sub && <span className="block truncate text-[11px] font-semibold leading-tight text-white/65">{sub}</span>}
      </span>
      {onPress && <ChevronDown className="h-4 w-4 shrink-0 text-white/70" />}
    </>
  );
  const cls = cn("inline-flex max-w-full items-center gap-2.5 rounded-full px-4 py-2", tone === "muted" ? "bg-white/5 text-white/70" : "bg-white/[0.12]");
  return onPress ? (
    <button type="button" onClick={onPress} className={cn(cls, "active:scale-[0.98]")} aria-label={`Sharing ${title}. Change`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
