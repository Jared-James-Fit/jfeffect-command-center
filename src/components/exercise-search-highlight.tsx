import { highlightSegments } from "@/lib/exercise-search";
import { cn } from "@/lib/utils";

/**
 * Renders an exercise name with every matched keyword marked, including
 * out-of-order and alias-expanded matches.
 */
export function HighlightedExerciseName({
  text,
  terms,
  className,
}: {
  text: string;
  terms: readonly string[];
  className?: string;
}) {
  const segments = highlightSegments(text, terms);
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.match ? (
          <mark
            key={i}
            className={cn("rounded-[2px] bg-primary/25 px-0.5 text-foreground")}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
