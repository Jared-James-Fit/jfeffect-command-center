import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

export type SwipeAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  color: "primary" | "destructive" | "muted";
  onSelect: () => void | Promise<void>;
};

/**
 * iMessage-style swipe-to-reveal actions.
 * Swipe left on a row to reveal action buttons on the right side.
 */
export function SwipeableRow({
  children,
  actions,
  className,
  disabled,
}: {
  children: ReactNode;
  actions: SwipeAction[];
  className?: string;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const locked = useRef<"h" | "v" | null>(null);
  const pointerId = useRef<number | null>(null);

  const actionsWidth = Math.max(72, actions.length * 88);
  const maxSwipe = actionsWidth;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    locked.current = null;
    pointerId.current = e.pointerId;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startX.current == null || startY.current == null) return;
    const deltaX = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;
    if (!locked.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      locked.current = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
      if (locked.current === "h") {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }
    }
    if (locked.current !== "h") return;
    e.preventDefault();
    const base = open ? -maxSwipe : 0;
    let next = base + deltaX;
    if (next > 0) next = 0;
    if (next < -maxSwipe - 40) next = -maxSwipe - 40;
    setDx(next);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current != null) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(pointerId.current);
      } catch {}
    }
    pointerId.current = null;
    startX.current = null;
    startY.current = null;
    const wasHorizontal = locked.current === "h";
    locked.current = null;
    if (!wasHorizontal) {
      setDx(0);
      return;
    }
    const threshold = maxSwipe / 2;
    if (-dx > threshold) {
      setOpen(true);
      setDx(-maxSwipe);
    } else {
      setOpen(false);
      setDx(0);
    }
  };

  const close = () => {
    setOpen(false);
    setDx(0);
  };

  return (
    <div className={cn("relative overflow-hidden select-none", className)}>
      {/* Actions layer */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{ width: actionsWidth }}
        aria-hidden={!open}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              await a.onSelect();
              close();
            }}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 px-2 text-[11px] font-bold text-white",
              a.color === "destructive" && "bg-red-500 active:bg-red-600",
              a.color === "primary" && "bg-blue-500 active:bg-blue-600",
              a.color === "muted" && "bg-zinc-500 active:bg-zinc-600",
            )}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      {/* Foreground */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          transform: `translate3d(${dx}px, 0, 0)`,
          transition: pointerId.current == null ? "transform 200ms ease" : "none",
          touchAction: "pan-y",
        }}
        className="relative bg-card"
      >
        {children}
      </div>
    </div>
  );
}
