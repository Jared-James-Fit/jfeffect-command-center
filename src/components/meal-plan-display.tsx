import { Dumbbell, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutMealInfo } from "@/components/nutrition/WorkoutMealInfo";
import {
  MEAL_TIMING_HINT,
  MEAL_TIMING_LABEL,
  detectMealTiming,
  stripTimingText,
  type MealTiming,
} from "@/lib/nutrition-targets/meal-timing";

type Props = {
  text?: string | null;
  className?: string;
};

// Parses pasted meal plan text into structured sections so each meal renders
// as ONE compact card with its ingredients and an inline "Approx" macro row,
// instead of being fragmented into multiple cards per blank line.
export const MEAL_HEADING = /^\s*(meal\s*\d+|pre[- ]?workout|post[- ]?workout|intra[- ]?workout|snack\s*\d*|breakfast|lunch|dinner)\b/i;
export const TOTAL_HEADING = /^\s*(daily\s*total|totals?)\b/i;
const HIGHDAY_HEADING = /^\s*high\s*day\s*(changes?|adjustments?)?\s*$/i;
const APPROX_LABEL = /^\s*approx[:.]?\s*$/i;
const APPROX_INLINE = /^\s*approx[:.]\s*(.+)$/i;
const APPROX_NATURAL_LABEL = /^\s*approximate\s*macros[:.]?\s*$/i;
const NATURAL_MACRO = /^\s*~?\s*\d+(?:\.\d+)?\s*g?\s*(protein|carbohydrates?|carbs?|fat|fibre|fiber)s?\s*$/i;
const MACRO_TOKEN = /^~?\s*\d+(?:\.\d+)?\s*[pcfPCF]\s*$/;
const MACRO_COMBINED = /^\s*~?\s*\d+\s*[pP]\s*[\/,]\s*~?\s*\d+\s*[cC]\s*[\/,]\s*~?\s*\d+\s*[fF]\b/;

export type MealPlanSection =
  | { kind: "meal"; title: string; subtitle?: string; timing?: MealTiming; items: string[]; approx?: string; approxMacros?: { title: string; items: string[] } }
  | { kind: "total"; title: string; macros?: string }
  | { kind: "highday"; title: string; items: string[] }
  | { kind: "other"; items: string[] };

function normalizeMacro(s: string) {
  return s.replace(/\s+/g, "").replace(/,/g, "/").toUpperCase();
}
function normalizeMacroLine(s: string) {
  return s.replace(/\s*[\/,]\s*/g, " / ").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Coach paste text → ordered sections (meals, totals, high-day changes, notes). */
export function parseMealPlanText(text: string): MealPlanSection[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: MealPlanSection[] = [];
  let cur: MealPlanSection | null = null;
  let approxBuf: string[] = [];
  let collectingApprox = false;
  let collectingApproxBlock = false;

  const flushApprox = () => {
    if (cur && approxBuf.length && (cur.kind === "meal" || cur.kind === "total")) {
      const joined = approxBuf.join(" / ");
      if (cur.kind === "meal") {
        cur.approx = cur.approx ? `${cur.approx} / ${joined}` : joined;
      } else {
        cur.macros = cur.macros ? `${cur.macros} / ${joined}` : joined;
      }
    }
    approxBuf = [];
    collectingApprox = false;
  };

  const flushApproxBlock = () => {
    collectingApproxBlock = false;
  };

  for (const line of lines) {
    if (MEAL_HEADING.test(line)) {
      flushApprox();
      flushApproxBlock();
      // Split parenthesized subtitle: "Meal 3 (Pre/Post Workout Meal)" → title="Meal 3", subtitle="Pre/Post Workout Meal"
      const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      const timing = detectMealTiming(line);
      let title = m ? m[1].trim() : line;
      let subtitle = m ? m[2].trim() : undefined;
      if (timing) {
        // The tag becomes a badge; keep any other words as the subtitle.
        subtitle = subtitle ? stripTimingText(subtitle) || undefined : undefined;
        const cleaned = stripTimingText(title).replace(/[:–—-]\s*$/, "").trim();
        if (cleaned) title = cleaned;
      }
      cur = { kind: "meal", title, subtitle, timing, items: [] };
      sections.push(cur);
      continue;
    }
    if (HIGHDAY_HEADING.test(line)) {
      flushApprox();
      flushApproxBlock();
      cur = { kind: "highday", title: line, items: [] };
      sections.push(cur);
      continue;
    }
    if (TOTAL_HEADING.test(line)) {
      flushApprox();
      flushApproxBlock();
      cur = { kind: "total", title: line };
      sections.push(cur);
      continue;
    }
    if (APPROX_LABEL.test(line)) {
      flushApprox();
      flushApproxBlock();
      // Only start collecting if we have a meal/total to attach to — prevents stray Approx cards
      if (cur?.kind === "meal" || cur?.kind === "total") collectingApprox = true;
      continue;
    }
    if (APPROX_NATURAL_LABEL.test(line)) {
      flushApprox();
      if (cur?.kind === "meal") {
        cur.approxMacros = { title: line.trim(), items: [] };
        collectingApproxBlock = true;
      }
      continue;
    }
    const inline = line.match(APPROX_INLINE);
    if (inline) {
      flushApprox();
      flushApproxBlock();
      const cleaned = normalizeMacroLine(inline[1]);
      if (cur?.kind === "meal") cur.approx = cleaned;
      else if (cur?.kind === "total") cur.macros = cleaned;
      continue;
    }
    if (collectingApproxBlock && cur?.kind === "meal" && NATURAL_MACRO.test(line)) {
      cur.approxMacros!.items.push(line);
      continue;
    }
    if (MACRO_COMBINED.test(line)) {
      flushApprox();
      flushApproxBlock();
      const cleaned = normalizeMacroLine(line);
      if (cur?.kind === "meal") cur.approx = cur.approx ? `${cur.approx} / ${cleaned}` : cleaned;
      else if (cur?.kind === "total") cur.macros = cur.macros ? `${cur.macros} / ${cleaned}` : cleaned;
      else {
        if (!cur || cur.kind !== "other") { cur = { kind: "other", items: [] }; sections.push(cur); }
        cur.items.push(cleaned);
      }
      continue;
    }
    if (MACRO_TOKEN.test(line)) {
      if (collectingApprox || cur?.kind === "meal" || cur?.kind === "total") {
        approxBuf.push(normalizeMacro(line));
        continue;
      }
    }
    // Regular item line — exit any approx block first
    if (collectingApproxBlock) flushApproxBlock();
    flushApprox();
    if (!cur) { cur = { kind: "other", items: [] }; sections.push(cur); }
    if (cur.kind === "total") {
      const prev = cur as Extract<MealPlanSection, { kind: "total" }>;
      const replaced: MealPlanSection = { kind: "other", items: [prev.title, ...(prev.macros ? [prev.macros] : []), line] };
      cur = replaced;
      sections[sections.length - 1] = cur;
    } else if (cur.kind === "meal" || cur.kind === "highday" || cur.kind === "other") {
      cur.items.push(line);
    }
  }
  flushApprox();
  return sections;
}

function titleCase(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function formatMacroValue(line: string) {
  // Normalize spacing around grams and units for a cleaner read.
  return line.replace(/\s+/g, " ").trim();
}

export function MealPlanDisplay({ text, className }: Props) {
  if (!text || !text.trim()) return null;
  const sections = parseMealPlanText(text);
  if (!sections.length) return null;

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {sections.map((s, i) => {
        if (s.kind === "meal") {
          return (
            <div
              key={i}
              className={cn(
                "rounded-md border bg-secondary/20 px-3 py-2.5",
                s.timing === "pre" ? "border-amber-500/50" : s.timing === "post" ? "border-emerald-500/50" : s.timing ? "border-sky-500/50" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="text-[11px] font-black uppercase tracking-widest text-primary">{titleCase(s.title)}</div>
                {s.timing && <MealTimingBadge timing={s.timing} />}
                {s.subtitle && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">— {s.subtitle}</div>
                )}
              </div>
              {s.timing && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{MEAL_TIMING_HINT[s.timing]}</span>
                  <WorkoutMealInfo />
                </div>
              )}
              {s.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {s.items.map((it, j) => (
                    <li key={j} className="text-[13px] text-foreground/90">{it}</li>
                  ))}
                </ul>
              )}
              {s.approx && (
                <div className="mt-2 inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold tracking-wider text-primary">
                  APPROX · {s.approx.replace(/\s*\/\s*/g, " · ")}
                </div>
              )}
              {s.approxMacros && s.approxMacros.items.length > 0 && (
                <div className="mt-4 rounded-md border border-border/60 bg-secondary/30 px-3 py-2.5">
                  <div className="text-[11px] font-black uppercase tracking-widest text-primary">{titleCase(s.approxMacros.title)}</div>
                  <ul className="mt-2 space-y-1">
                    {s.approxMacros.items.map((it, j) => (
                      <li key={j} className="flex items-center justify-between text-[13px] text-foreground/90">
                        <span className="capitalize">{formatMacroValue(it)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }
        if (s.kind === "total") {
          return (
            <div key={i} className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5">
              <div className="text-[11px] font-black uppercase tracking-widest text-primary">{titleCase(s.title)}</div>
              {s.macros && <div className="mt-1 text-sm font-bold">{s.macros}</div>}
            </div>
          );
        }
        if (s.kind === "highday") {
          return (
            <div key={i} className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
              <div className="text-[11px] font-black uppercase tracking-widest text-warning">{titleCase(s.title)}</div>
              {s.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {s.items.map((it, j) => {
                    const isSubHead = MEAL_HEADING.test(it);
                    return (
                      <li
                        key={j}
                        className={cn(
                          "text-[13px]",
                          isSubHead && "mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground",
                        )}
                      >
                        {isSubHead ? titleCase(it) : it}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        }
        return (
          <div key={i} className="rounded-md border border-border/60 bg-secondary/10 px-3 py-2 text-[13px]">
            {s.items.map((it, j) => (
              <div key={j}>{it}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Pre / Post-Workout tag shown on a meal. */
export function MealTimingBadge({ timing, className }: { timing: Exclude<MealTiming, null>; className?: string }) {
  const Icon = timing === "post" ? Dumbbell : Zap;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
        timing === "pre" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        timing === "post" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        timing === "pre_post" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {MEAL_TIMING_LABEL[timing]}
    </span>
  );
}
