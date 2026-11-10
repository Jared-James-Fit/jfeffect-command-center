import { useState } from "react";
import { Monitor, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Best on a computer": shown on a phone in the builders, where a bigger
 * screen genuinely helps, without stopping anyone working here. ✕ hides it on
 * that device (a convenience, not something to sync). Each builder keeps its
 * own key so dismissing one doesn't hide the other.
 */
export function BestOnComputerTip({
  storageKey,
  children,
  className,
}: {
  storageKey: string;
  /** The line under "Best on a computer". */
  children: React.ReactNode;
  className?: string;
}) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "hidden";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(storageKey, "hidden");
    } catch {
      /* shows again next time */
    }
  };
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-border bg-muted/40 py-3 pl-3.5 pr-1.5",
        className,
      )}
    >
      <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">Best on a computer</div>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{children}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0"
        aria-label="Hide this tip"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
