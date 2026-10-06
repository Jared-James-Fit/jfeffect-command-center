import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseInline, type AgreementContent } from "@/lib/coaching-agreement/content";

/** Renders text with `**bold**` markup. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((run, i) =>
        run.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {run.text}
          </strong>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}

type Props = {
  content: AgreementContent;
  /** "review": collapsible cards for reading on a phone. "record": everything open, no controls (signed copy / print). */
  variant?: "review" | "record";
  showIntro?: boolean;
  showKeyTerms?: boolean;
  /** Reports how many distinct sections the reader has opened (review evidence). */
  onOpenedCount?: (opened: number, total: number) => void;
  className?: string;
};

export function AgreementReader({
  content,
  variant = "review",
  showIntro = true,
  showKeyTerms = true,
  onOpenedCount,
  className,
}: Props) {
  const record = variant === "record";
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const everOpened = useRef<Set<string>>(new Set());
  const total = content.sections.length;

  useEffect(() => {
    onOpenedCount?.(everOpened.current.size, total);
  }, [onOpenedCount, total]);

  const allOpen = useMemo(() => open.size === total, [open, total]);

  const mark = (ids: string[]) => {
    ids.forEach((id) => everOpened.current.add(id));
    onOpenedCount?.(everOpened.current.size, total);
  };

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        mark([id]);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allOpen) {
      setOpen(new Set());
    } else {
      const ids = content.sections.map((s) => s.id);
      setOpen(new Set(ids));
      mark(ids);
    }
  };

  return (
    <div className={cn("space-y-5", className)}>
      {showIntro && (
        <div className="space-y-3">
          {content.intro.map((clause, i) => (
            <p
              key={i}
              className={cn(
                "text-[15px] leading-relaxed text-muted-foreground",
                i === 0 &&
                  "rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-foreground",
              )}
            >
              {clause.label && (
                <span className="font-semibold text-foreground">{clause.label} </span>
              )}
              <Inline text={clause.text} />
            </p>
          ))}
        </div>
      )}

      {showKeyTerms && (
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h3 className="text-base font-bold tracking-tight">Key terms at a glance</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            A plain-English summary. The full terms below are what you agree to, and they control if
            anything differs.
          </p>
          <ul className="mt-3 space-y-3">
            {content.keyTerms.map((term) => (
              <li key={term.title} className="flex gap-3">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <p className="text-[15px] leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground">{term.title}. </span>
                  {term.text}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold tracking-tight">Full agreement</h3>
          {!record && (
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={toggleAll}>
              {allOpen ? (
                <>
                  <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                  Collapse all
                </>
              ) : (
                <>
                  <ChevronsUpDown className="mr-1.5 h-4 w-4" />
                  Expand all
                </>
              )}
            </Button>
          )}
        </div>

        {content.sections.map((section) => {
          const isOpen = record || open.has(section.id);
          const panelId = `agreement-section-${section.id}`;
          return (
            <section
              key={section.id}
              className="agreement-section-card break-inside-avoid rounded-2xl border border-border bg-card"
            >
              {record ? (
                <header className="flex items-start gap-3 p-4 pb-0">
                  <SectionHeading
                    number={section.number}
                    title={section.title}
                    inShort={section.inShort}
                  />
                </header>
              ) : (
                <button
                  type="button"
                  className="flex min-h-[56px] w-full items-start gap-3 rounded-2xl p-4 text-left active:bg-muted/50"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(section.id)}
                >
                  <SectionHeading
                    number={section.number}
                    title={section.title}
                    inShort={section.inShort}
                  />
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
              )}
              {isOpen && (
                <div
                  id={panelId}
                  className="space-y-3 border-t border-border/60 px-4 pb-4 pt-3 mt-3"
                >
                  {section.clauses.map((clause, i) => (
                    <p key={i} className="text-[15px] leading-relaxed text-muted-foreground">
                      {clause.label && (
                        <span className="font-semibold text-foreground">{clause.label} </span>
                      )}
                      <Inline text={clause.text} />
                    </p>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeading({
  number,
  title,
  inShort,
}: {
  number: number;
  title: string;
  inShort: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {number}
      </span>
      <div className="min-w-0">
        <h4 className="text-[15px] font-semibold leading-snug text-foreground">{title}</h4>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
          <span className="font-medium">In short:</span> {inShort}
        </p>
      </div>
    </div>
  );
}
