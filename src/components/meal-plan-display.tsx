import { cn } from "@/lib/utils";

type Props = { text?: string | null; className?: string };

// Parses pasted meal plan text into structured sections so each meal renders
// as ONE compact card with its ingredients and an inline "Approx" macro row,
// instead of being fragmented into multiple cards per blank line.
const MEAL_HEADING = /^\s*(meal\s*\d+|pre[- ]?workout|post[- ]?workout|intra[- ]?workout|snack\s*\d*|breakfast|lunch|dinner)\b/i;
const TOTAL_HEADING = /^\s*(daily\s*total|totals?)\b/i;
const HIGHDAY_HEADING = /^\s*high\s*day\s*(changes?|adjustments?)?\s*$/i;
const APPROX_LABEL = /^\s*approx[:.]?\s*$/i;
const APPROX_INLINE = /^\s*approx[:.]\s*(.+)$/i;
const MACRO_TOKEN = /^~?\s*\d+(?:\.\d+)?\s*[pcfPCF]\s*$/;
const MACRO_COMBINED = /^\s*~?\s*\d+\s*[pP]\s*[\/,]\s*~?\s*\d+\s*[cC]\s*[\/,]\s*~?\s*\d+\s*[fF]\b/;

type Section =
  | { kind: "meal"; title: string; items: string[]; approx?: string }
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

  for (const line of lines) {
    if (MEAL_HEADING.test(line)) {
      flushApprox();
      cur = { kind: "meal", title: line, items: [] };
      sections.push(cur);
      continue;
    }
    if (HIGHDAY_HEADING.test(line)) {
      flushApprox();
      cur = { kind: "highday", title: line, items: [] };
      sections.push(cur);
      continue;
    }
    if (TOTAL_HEADING.test(line)) {
      flushApprox();
      cur = { kind: "total", title: line };
      sections.push(cur);
      continue;
    }
    if (APPROX_LABEL.test(line)) {
      flushApprox();
      collectingApprox = true;
      continue;
    }
    const inline = line.match(APPROX_INLINE);
    if (inline) {
      flushApprox();
      const cleaned = normalizeMacroLine(inline[1]);
      if (cur?.kind === "meal") cur.approx = cleaned;
      else if (cur?.kind === "total") cur.macros = cleaned;
      continue;
    }
    if (MACRO_COMBINED.test(line)) {
      flushApprox();
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
    // Regular item line
    flushApprox();
    if (!cur) { cur = { kind: "other", items: [] }; sections.push(cur); }
    if (cur.kind === "total") {
      // total followed by an item line — convert section into a labeled item bucket
      const t = cur;
      cur = { kind: "other", items: [t.title, ...(t.macros ? [t.macros] : []), line] };
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

export function MealPlanDisplay({ text, className }: Props) {
  if (!text || !text.trim()) return null;
  const sections = parse(text);
  if (!sections.length) return null;

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {sections.map((s, i) => {
        if (s.kind === "meal") {
          return (
            <div key={i} className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
              <div className="text-[11px] font-black uppercase tracking-widest text-primary">{titleCase(s.title)}</div>
              {s.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {s.items.map((it, j) => (
                    <li key={j} className="text-[13px] text-foreground/90">{it}</li>
                  ))}
                </ul>
              )}
              {s.approx && (
                <div className="mt-2 inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Approx: {s.approx}
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