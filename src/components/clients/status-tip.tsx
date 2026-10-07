import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A status chip that explains itself.
 *
 * Phone or tablet: tap it to read what it means, tap anywhere else to dismiss. Computer: hover it
 * (or click to keep it open). This is a popover rather than a tooltip on purpose: tooltips only
 * open on hover, and a finger never hovers, so on an iPhone they simply never appear.
 *
 * The explanation can carry buttons (`footer`), so a status that used to run an action when tapped
 * now says what it is first and offers the action beside it, instead of acting on a stray tap.
 * Only one explanation is open at a time.
 */

type Tone = "danger" | "warn" | "info" | "ok" | "muted";

const ICON_TONE: Record<Tone, string> = {
  danger: "bg-destructive/15 text-destructive",
  warn: "bg-amber-500/15 text-amber-500",
  info: "bg-blue-500/15 text-blue-400",
  ok: "bg-emerald-500/15 text-emerald-500",
  muted: "bg-muted text-muted-foreground",
};

// App-wide: opening one explanation closes whichever was open.
let closeActive: (() => void) | null = null;

export type StatusTipProps = {
  /** Heading of the explanation. */
  title: string;
  /** What this is, in plain English. */
  body: ReactNode;
  /** What to do about it. */
  next?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  /** Buttons under the text. A function receives `close`, so an action can dismiss the popover. */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  /** Classes for the tappable element (the chip) itself. */
  className?: string;
  /** Accessible name, for chips whose content alone isn't one (a bare icon, a progress bar). */
  label?: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  children: ReactNode;
};

type PointerKind = "mouse" | "touch" | "pen" | "keyboard" | null;

export function StatusTip({
  title,
  body,
  next,
  icon: Icon,
  tone = "muted",
  footer,
  className,
  label,
  side = "top",
  align = "start",
  children,
}: StatusTipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // A click on a computer pins the explanation open; hovering alone opens and closes it.
  const pinned = useRef(false);
  const lastInput = useRef<PointerKind>(null);

  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const close = useCallback(() => {
    clearTimer();
    pinned.current = false;
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    clearTimer();
    if (closeActive && closeActive !== close) closeActive();
    closeActive = close;
    setOpen(true);
  }, [close]);

  useEffect(
    () => () => {
      clearTimer();
      if (closeActive === close) closeActive = null;
    },
    [close],
  );

  const onOpenChange = (next: boolean) => {
    if (next) show();
    else close();
  };

  const hoverIn = () => {
    clearTimer();
    timer.current = window.setTimeout(show, 200);
  };
  const hoverOut = () => {
    clearTimer();
    if (pinned.current) return;
    timer.current = window.setTimeout(close, 140);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn("touch-manipulation text-left", className)}
          onPointerDown={(e) => {
            lastInput.current = e.pointerType as PointerKind;
          }}
          onKeyDown={() => {
            lastInput.current = "keyboard";
          }}
          onPointerEnter={(e) => e.pointerType === "mouse" && hoverIn()}
          onPointerLeave={(e) => e.pointerType === "mouse" && hoverOut()}
          onClick={(e) => {
            // With a mouse the explanation is usually already open from hovering, so the first
            // click pins it open (rather than toggling it shut) and a second click closes it.
            // Touch and keyboard toggle as normal.
            if (lastInput.current === "mouse") {
              e.preventDefault();
              if (pinned.current) {
                close();
              } else {
                pinned.current = true;
                show();
              }
            }
          }}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        // Keep clear of the phone's bottom tab bar as well as the screen edges.
        collisionPadding={{ top: 12, right: 12, bottom: 96, left: 12 }}
        className="w-[17.5rem] max-w-[calc(100vw-1.5rem)] space-y-2 p-3 text-left"
        // Only a keyboard user needs focus moved into the explanation; for a tap or a hover it
        // would just pull focus off the chip.
        onOpenAutoFocus={(e) => {
          if (lastInput.current !== "keyboard") e.preventDefault();
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && clearTimer()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hoverOut()}
      >
        <div className="flex items-start gap-2.5">
          {Icon && (
            <span
              aria-hidden
              className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", ICON_TONE[tone])}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-snug">{title}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
          </div>
        </div>
        {next && (
          <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs leading-snug">
            <span className="font-semibold">What to do: </span>
            {next}
          </p>
        )}
        {footer && (
          <div className="flex flex-col gap-2 pt-0.5">
            {typeof footer === "function" ? footer(close) : footer}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
