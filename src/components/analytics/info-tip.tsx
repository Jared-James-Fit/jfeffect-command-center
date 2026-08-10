import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  /** Accessible label for the trigger, e.g. "About PRs in range". */
  label: string;
  /** Optional bold heading inside the tooltip. */
  title?: string;
  /** Explanation body — keep it short and plain-language. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * Small info icon that explains an analytics metric.
 * Desktop: opens on hover (and keyboard focus). Mobile: opens on tap — the
 * tap focuses the trigger, which Radix treats like focus. Tap anywhere else
 * to dismiss. Never rely on hover alone.
 */
export function InfoTip({
  label,
  title,
  children,
  side = "top",
  align = "center",
  className,
}: InfoTipProps) {
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              "text-muted-foreground/60 transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="max-w-[260px] whitespace-normal rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-lg"
        >
          {title && (
            <div className="mb-1 font-bold text-popover-foreground">{title}</div>
          )}
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}