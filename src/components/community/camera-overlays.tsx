import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
