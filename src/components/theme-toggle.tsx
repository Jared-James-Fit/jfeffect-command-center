import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * iOS-style appearance switch. The knob carries the current mode's glyph and
 * springs across the track; the track shows the other mode's glyph faintly so
 * the action is obvious before tapping.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  // Pulses after the "What's new" popup closes, pointing at the real switch.
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    const on = () => {
      setHighlight(true);
      window.setTimeout(() => setHighlight(false), 3400);
    };
    window.addEventListener("jf-theme-toggle-highlight", on);
    return () => window.removeEventListener("jf-theme-toggle-highlight", on);
  }, []);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={toggle}
      className={cn(
        "relative inline-flex h-8 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full p-[3px] outline-none",
        "transition-colors duration-300 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:scale-[0.97] [-webkit-tap-highlight-color:transparent]",
        highlight && "jf-toggle-highlight",
        // A neutral track in both modes (the design system's greys, no tint, no inset shadow),
        // so it weighs the same as the bar's other buttons.
        "bg-secondary",
        className,
      )}
    >
      {/* Faint glyph for the mode you'd switch to */}
      <Sun
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-[9px] h-3.5 w-3.5 text-muted-foreground transition-opacity duration-300",
          dark ? "opacity-100" : "opacity-0",
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-[9px] h-3.5 w-3.5 text-muted-foreground transition-opacity duration-300",
          dark ? "opacity-0" : "opacity-100",
        )}
      />
      {/* Knob */}
      <span
        aria-hidden
        className={cn(
          "relative z-10 grid h-[1.625rem] w-[1.625rem] place-items-center rounded-full",
          "shadow-[0_1px_2px_oklch(0_0_0/0.18)]",
          "transition-[transform,background-color] duration-[420ms] ease-[cubic-bezier(0.34,1.45,0.55,1)]",
          dark ? "translate-x-[1.25rem] bg-background" : "translate-x-0 bg-background",
        )}
      >
        {dark ? (
          <Moon className="h-3.5 w-3.5 fill-foreground text-foreground" />
        ) : (
          <Sun className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
        )}
      </span>
    </button>
  );
}
