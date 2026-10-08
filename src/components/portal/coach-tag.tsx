import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Coach" marker for the coach's own athlete account, so clients can tell who they're looking at in the
 * league and on profiles. The database decides who it is (community_is_coach); this only draws it.
 * Same icon as the community's coach badge, with the word, because the icon alone doesn't say it.
 */
export function CoachTag({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-black uppercase leading-none tracking-wider",
        onDark ? "bg-white/15 text-white" : "bg-primary/15 text-primary",
        className,
      )}
    >
      <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
      Coach
    </span>
  );
}
