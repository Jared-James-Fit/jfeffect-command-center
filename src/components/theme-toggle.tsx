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
        dark
          ? "bg-[oklch(0.32_0.03_275)] shadow-[inset_0_1px_2px_oklch(0_0_0/0.45)]"
          : "bg-[oklch(0.92_0.004_80)] shadow-[inset_0_1px_2px_oklch(0_0_0/0.10)]",
        className,
      )}
    >
      {/* Faint glyph for the mode you'd switch to */}
      <Sun
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-[9px] h-3.5 w-3.5 text-amber-300/70 transition-opacity duration-300",
          dark ? "opacity-100" : "opacity-0",
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-[9px] h-3.5 w-3.5 text-[oklch(0.55_0.02_275)] transition-opacity duration-300",
          dark ? "opacity-0" : "opacity-100",
        )}
      />
      {/* Knob */}
      <span
        aria-hidden
        className={cn(
          "relative z-10 grid h-[1.625rem] w-[1.625rem] place-items-center rounded-full",
          "shadow-[0_2px_6px_oklch(0_0_0/0.22),0_0_0_0.5px_oklch(0_0_0/0.06)]",
          "transition-[transform,background-color] duration-[420ms] ease-[cubic-bezier(0.34,1.45,0.55,1)]",
          dark ? "translate-x-[1.25rem] bg-[oklch(0.20_0.02_275)]" : "translate-x-0 bg-white",
        )}
      >
        {dark ? (
          <Moon className="h-3.5 w-3.5 fill-[oklch(0.90_0.04_275)] text-[oklch(0.90_0.04_275)]" />
        ) : (
          <Sun className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
        )}
      </span>
    </button>
  );
}
