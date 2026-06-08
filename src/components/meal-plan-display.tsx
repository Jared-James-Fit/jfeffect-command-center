import { cn } from "@/lib/utils";

type Props = { text?: string | null; className?: string };

// Light parser: splits text into blocks separated by blank lines, then classifies
// each line as a heading (Meal N / Daily Total), an "Approx" macro line, a macro
// summary line (e.g. "50P / 115C / 22F"), or an ingredient.
const MEAL_HEADING = /^\s*(meal\s*\d+|pre[- ]?workout|post[- ]?workout|intra[- ]?workout|snack|breakfast|lunch|dinner)\b/i;
const TOTAL_HEADING = /^\s*(daily\s*total|total|high\s*day\s*changes?)\b/i;
const APPROX = /^\s*approx[:.]?/i;
const MACRO_ONLY = /^\s*~?\s*\d{1,4}\s*p\s*[\/,]\s*\d{1,4}\s*c\s*[\/,]\s*\d{1,4}\s*f\b/i;

function classify(line: string) {
  const t = line.trim();
  if (!t) return "blank" as const;
  if (TOTAL_HEADING.test(t)) return "total" as const;
  if (MEAL_HEADING.test(t)) return "meal" as const;
  if (APPROX.test(t) || MACRO_ONLY.test(t)) return "macro" as const;
  return "item" as const;
}

export function MealPlanDisplay({ text, className }: Props) {
  if (!text || !text.trim()) return null;
  // Normalize line endings, collapse 3+ newlines to 2
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const blocks = normalized.split(/\n\s*\n/);

  return (
    <div className={cn("space-y-4 text-sm leading-relaxed", className)}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim().length);
        if (!lines.length) return null;
        const firstKind = classify(lines[0]);
        const headingIsMeal = firstKind === "meal";
        const headingIsTotal = firstKind === "total";
        return (
          <div
            key={bi}
            className={cn(
              "rounded-md border bg-secondary/20 p-3",
              headingIsTotal && "border-primary/40 bg-primary/5",
              !headingIsMeal && !headingIsTotal && "border-border/60",
              headingIsMeal && "border-border",
            )}
          >
            {lines.map((line, li) => {
              const kind = li === 0 && (headingIsMeal || headingIsTotal) ? firstKind : classify(line);
              const text = line.trim();
              if (kind === "meal") {
                return (
                  <div key={li} className="text-xs font-black uppercase tracking-widest text-primary">
                    {text}
                  </div>
                );
              }
              if (kind === "total") {
                return (
                  <div key={li} className="text-xs font-black uppercase tracking-widest text-primary">
                    {text}
                  </div>
                );
              }
              if (kind === "macro") {
                return (
                  <div key={li} className="mt-1 text-xs font-semibold text-muted-foreground">
                    {text}
                  </div>
                );
              }
              return (
                <div key={li} className="mt-1 flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}