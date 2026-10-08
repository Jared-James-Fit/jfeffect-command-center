import { cn } from "@/lib/utils";
import {
  MOVEMENT_FAMILY_COLOR_NAME,
  MOVEMENT_FAMILY_LABEL,
  movementFamilyStyle,
  type MovementFamily,
} from "@/lib/exercise-family";

/**
 * The workout-position number on an exercise card, filled with the exercise's
 * family colour. `position` is always derived from the CURRENT order (index + 1),
 * never stored, so reordering or deleting renumbers every card automatically.
 */
export function ExerciseOrderBadge({
  position,
  family,
  size = "md",
  className,
}: {
  position: number;
  family: MovementFamily;
  size?: "sm" | "md";
  className?: string;
}) {
  const style = movementFamilyStyle(family);
  return (
    <span
      data-testid="exercise-order-badge"
      data-family={family}
      role="img"
      aria-label={`Exercise ${position}, ${MOVEMENT_FAMILY_LABEL[family]}`}
      title={`Exercise ${position} · ${MOVEMENT_FAMILY_LABEL[family]} (${MOVEMENT_FAMILY_COLOR_NAME[family]})`}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md border font-black tabular-nums leading-none shadow-sm",
        size === "md" ? "h-7 min-w-7 px-1.5 text-sm" : "h-5 min-w-5 px-1 text-[11px]",
        style.badge,
        className,
      )}
    >
      {position}
    </span>
  );
}

/** Small family dot for lists/filters where a full number badge doesn't fit. */
export function FamilyDot({ family, className }: { family: MovementFamily; className?: string }) {
  return (
    <span
      aria-label={`${MOVEMENT_FAMILY_LABEL[family]} family`}
      title={`${MOVEMENT_FAMILY_LABEL[family]} (${MOVEMENT_FAMILY_COLOR_NAME[family]})`}
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", movementFamilyStyle(family).dot, className)}
    />
  );
}
