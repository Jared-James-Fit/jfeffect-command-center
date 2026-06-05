import { Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";

export const POWERLIFTER_BADGE_LABELS = [
  "Powerlifter",
  "Powerlifting Athlete",
  "Strength Athlete",
] as const;

export type PowerlifterBadgeLabel = (typeof POWERLIFTER_BADGE_LABELS)[number];

export function PowerlifterBadge({
  label = "Powerlifter",
  className,
  size = "sm",
}: {
  label?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  const sizing =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px]"
      : size === "md"
      ? "px-3 py-1 text-sm"
      : "px-2 py-0.5 text-xs";
  const icon = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 font-semibold uppercase tracking-wider text-primary",
        sizing,
        className,
      )}
      title="Powerlifter"
    >
      <Dumbbell className={icon} />
      {label ?? "Powerlifter"}
    </span>
  );
}