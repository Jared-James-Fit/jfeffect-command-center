import { cn } from "@/lib/utils";
import { CleoMark } from "./cleo-mark";

/**
 * Cleo's face: its signature mark (the plate C, cleo-mark.tsx) inverted in a
 * filled circle, like a contact's photo. Cleo is the app's one AI identity, so
 * it gets a face of its own instead of a sparkle, a gradient or a glow (no
 * feature in the app wears those).
 */
export function CleoAvatar({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const mark = size === "lg" ? 34 : size === "sm" ? 19 : 21;
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 select-none items-center justify-center rounded-full bg-foreground text-background", box, className)}
      data-cleo-avatar
    >
      <CleoMark size={mark} />
    </span>
  );
}

/** How Cleo is introduced wherever someone talks to it. */
export const CLEO_ROLE_LINE = "AI assistant";
