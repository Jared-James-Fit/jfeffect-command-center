import { ReactNode, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight horizontal swipe wrapper for a task row.
 * Swipe right -> complete, swipe left -> delete. Never blocks vertical scrolling:
 * the gesture only engages once horizontal movement clearly dominates.
 */
export function TaskSwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  disabled,
}: {
  children: ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");

  const THRESHOLD = 72;

  if (disabled) return <>{children}</>;

  return (
    <div className="relative overflow-hidden">
      {/* action backdrops */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4">
        <span className={cn("flex items-center gap-1 text-xs font-semibold text-success", dx > 12 ? "opacity-100" : "opacity-0")}>
          <Check className="h-4 w-4" /> Complete
        </span>
        <span className={cn("flex items-center gap-1 text-xs font-semibold text-destructive", dx < -12 ? "opacity-100" : "opacity-0")}>
          Delete <Trash2 className="h-4 w-4" />
        </span>
      </div>
      <div
        className="relative bg-card transition-transform"
        style={{ transform: `translateX(${dx}px)`, transitionDuration: start.current ? "0ms" : "160ms" }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          start.current = { x: t.clientX, y: t.clientY };
          axis.current = "none";
        }}
        onTouchMove={(e) => {
          const s = start.current;
          const t = e.touches[0];
          if (!s || !t) return;
          const mx = t.clientX - s.x;
          const my = t.clientY - s.y;
          if (axis.current === "none") {
            if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
            axis.current = Math.abs(mx) > Math.abs(my) * 1.5 ? "x" : "y";
          }
          if (axis.current !== "x") return;
          setDx(Math.max(-140, Math.min(140, mx)));
        }}
        onTouchEnd={() => {
          const moved = dx;
          start.current = null;
          axis.current = "none";
          setDx(0);
          if (moved > THRESHOLD) onSwipeRight?.();
          else if (moved < -THRESHOLD) onSwipeLeft?.();
        }}
        onTouchCancel={() => { start.current = null; axis.current = "none"; setDx(0); }}
      >
        {children}
      </div>
    </div>
  );
}
