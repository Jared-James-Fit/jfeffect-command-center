import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  /** Accessible label for the trigger, e.g. "About PRs in range". */
  label: string;
  /** Optional bold heading (the sheet's title on a phone; the label stands in without one). */
  title?: string;
  /** Explanation body: short, plain words, an example where it helps. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A small ⓘ that explains a number or a chart in a sentence or two.
 * A computer: a small popover on hover, focus or click. A phone: a clean
 * bottom sheet (a grip that swipes down, Done), never a cramped tooltip over
 * the chart. The tap target is 32px however small the icon looks.
 */
export function InfoTip({
  label,
  title,
  children,
  side = "top",
  align = "center",
  className,
}: InfoTipProps) {
  const phone = useIsMobile();
  // Radix opens on hover/focus only; touch taps never produce a hover, so we
  // control the open state and toggle it on click as well.
  const [open, setOpen] = useState(false);
  const touchHandled = useRef(false);
  const trigger = cn(
    "-m-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full align-middle",
    "text-muted-foreground/70 transition-colors hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );

  if (phone)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <button
          type="button"
          aria-label={label}
          data-info-tip
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(true);
          }}
          className={trigger}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
        <SheetContent
          side="bottom"
          swipeToClose
          hideCloseButton
          className="gap-0 rounded-t-[22px] px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-0"
          data-info-sheet
        >
          <span
            aria-hidden
            className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-muted-foreground/30"
          />
          <SheetTitle className="mt-4 text-[17px] font-semibold">{title ?? label}</SheetTitle>
          <SheetDescription asChild>
            <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-foreground/85">
              {children}
            </div>
          </SheetDescription>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-5 h-11 w-full rounded-lg bg-secondary text-[15px] font-semibold text-foreground"
          >
            Done
          </button>
        </SheetContent>
      </Sheet>
    );

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            data-info-tip
            onPointerDown={(e) => {
              // Touch/pen never hovers, and Radix closes the tooltip on
              // pointerdown — toggle here so a tap reliably opens it.
              if (e.pointerType === "mouse") return;
              e.stopPropagation();
              e.preventDefault();
              touchHandled.current = true;
              // Radix's own pointerdown handler closes the tooltip right
              // after ours, so apply the toggle on the next tick.
              const next = !open;
              setTimeout(() => setOpen(next), 0);
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (touchHandled.current) {
                touchHandled.current = false;
                return; // already toggled on the touch pointerdown
              }
              setOpen((v) => !v);
            }}
            className={trigger}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="max-w-[280px] space-y-1.5 whitespace-normal rounded-lg border border-border bg-popover px-3 py-2.5 text-left text-[13px] font-normal leading-relaxed text-popover-foreground shadow-lg"
        >
          {title && <div className="font-semibold text-popover-foreground">{title}</div>}
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
