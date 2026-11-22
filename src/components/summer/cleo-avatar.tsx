import { cn } from "@/lib/utils";

/**
 * Cleo's mark: a "C" in a neutral circle, like any contact without a photo.
 * Cleo is the app's one AI identity, so it gets a face of its own instead of
 * a sparkle, a gradient or a glow (no feature in the app wears those).
 */
export function CleoAvatar({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 text-[22px]" : size === "sm" ? "h-8 w-8 text-[14px]" : "h-9 w-9 text-[15px]";
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 select-none items-center justify-center rounded-full bg-foreground font-semibold text-background", box, className)}
    >
      C
    </span>
  );
}

/** How Cleo is introduced wherever someone talks to it. */
export const CLEO_ROLE_LINE = "AI assistant";
