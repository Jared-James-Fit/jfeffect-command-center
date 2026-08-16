import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  text?: string | null;
  className?: string;
  /**
   * Client-facing scanability option: keep Meal 1 expanded and collapse the
   * later meals. Purely presentational — the coach-authored text is unchanged.
   */
  collapsibleMeals?: boolean;
};

// Parses pasted meal plan text into structured sections so each meal renders
// as ONE compact card with its ingredients and an inline "Approx" macro row,
// instead of being fragmented into multiple cards per blank line.
const MEAL_HEADING = /^\s*(meal\s*\d+|pre[- ]?workout|post[- ]?workout|intra[- ]?workout|snack\s*\d*|breakfast|lunch|dinner)\b/i;
const TOTAL_HEADING = /^\s*(daily\s*total|totals?)\b/i;
const HIGHDAY_HEADING = /^\s*high\s*day\s*(changes?|adjustments?)?\s*$/i;
const APPROX_LABEL = /^\s*approx[:.]?\s*$/i;
const APPROX_INLINE = /^\s*approx[:.]\s*(.+)$/i;
const APPROX_NATURAL_LABEL = /^\s*approximate\s*macros[:.]?\s*$/i;
const NATURAL_MACRO = /^\s*~?\s*\d+(?:\.\d+)?\s*g?\s*(protein|carbohydrates?|carbs?|fat|fibre|fiber)s?\s*$/i;
const MACRO_TOKEN = /^~?\s*\d+(?:\.\d+)?\s*[pcfPCF]\s*$/;
const MACRO_COMBINED = /^\s*~?\s*\d+\s*[pP]\s*[\/,]\s*~?\s*\d+\s*[cC]\s*[\/,]\s*~?\s*\d+\s*[fF]\b/;

type Section =
  | { kind: "meal"; title: string; subtitle?: string; items: string[]; approx?: string; approxMacros?: { title: string; items: string[] } }
  | { kind: "total"; title: string; macros?: string }
  | { kind: "highday"; title: string; items: string[] }
  | { kind: "other"; items: string[] };

function normalizeMacro(s: string) {
  return s.replace(/\s+/g, "").replace(/,/g, "/").toUpperCase();
}
function normalizeMacroLine(s: string) {
  return s.replace(/\s*[\/,]\s*/g, " / ").replace(/\s+/g, " ").trim().toUpperCase();
}

function parse(text: string): Section[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: Section[] = [];
  let cur: Section | null = null;
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
      cur = m
        ? { kind: "meal", title: m[1].trim(), subtitle: m[2].trim(), items: [] }
        : { kind: "meal", title: line, items: [] };
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
      const prev = cur as Extract<Section, { kind: "total" }>;
      const replaced: Section = { kind: "other", items: [prev.title, ...(prev.macros ? [prev.macros] : []), line] };
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

export function MealPlanDisplay({ text, className, collapsibleMeals = false }: Props) {
  if (!text || !text.trim()) return null;
  const sections = parse(text);
  if (!sections.length) return null;

  let mealIndex = -1;

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {sections.map((s, i) => {
        if (s.kind === "meal") {
          mealIndex += 1;
          const body = (
            <div key={i} className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <div className="text-[11px] font-black uppercase tracking-widest text-primary">{titleCase(s.title)}</div>
                {s.subtitle && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">— {s.subtitle}</div>
                )}
              </div>
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
          if (!collapsibleMeals) return body;
          return (
            <CollapsibleMeal
              key={i}
              title={titleCase(s.title)}
              subtitle={s.subtitle}
              defaultOpen={mealIndex === 0}
            >
              {body}
            </CollapsibleMeal>
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

function CollapsibleMeal({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded
          className="mb-1 flex w-full items-center justify-between text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
        >
          <span>Hide {title}</span>
          <ChevronDown className="h-3.5 w-3.5 rotate-180" />
        </button>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      className="flex w-full items-center justify-between rounded-md border border-border bg-secondary/20 px-3 py-2.5 text-left transition hover:border-primary/40"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-widest text-primary">{title}</span>
        {subtitle && (
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
