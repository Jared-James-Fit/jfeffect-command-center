/**
 * Cleo Insights: last week in a few lines, then what's worth acting on, most important first, each
 * with its fact, a possible reason and a recommendation kept apart, the numbers behind it, and how
 * sure it is. Worked out by rules in code from the other tabs' numbers (lib/bi/insights.ts), never
 * by a model, so nothing is made up. Ask Cleo opens Cleo with a question about the analytics (Cleo
 * reads the same numbers through its business_analytics lookup); nothing is ever changed for you.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { CleoMark } from "@/components/summer/cleo-mark";
import { Button } from "@/components/ui/button";
import { IntelSection } from "@/components/admin/intel/intel-ui";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { openSummer } from "@/lib/cleo-open";
import { BI_TAB_LABEL } from "@/lib/bi/model";
import type { BiInsight } from "@/lib/bi/insights";
import type { InsightsView } from "@/lib/bi/bi.server";
import { cn } from "@/lib/utils";
import { useBiTab, type TabProps } from "./analytics-page";

const QUESTIONS = [
  "Why might conversions be down, and where do people drop off?",
  "Which marketing channels bring paying clients, not just traffic?",
  "Where do new members stop during onboarding?",
  "Which features should I prioritise, and which are underused?",
  "Which pages need work first, by speed and errors?",
  "Is any region or country growing faster than the rest?",
  "Who is at risk of leaving and what should I do this week?",
  "Was there any unusual traffic or revenue change?",
];

const LEVEL = ["", "Low", "Medium", "High"];

export function InsightCard({ insight: i, compact = false, onOpen }: { insight: BiInsight; compact?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-4",
        i.urgency === 3 && i.impact >= 2 && "border-amber-500/40",
      )}
      data-insight={i.id}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-muted px-1.5 py-0.5">{BI_TAB_LABEL[i.tab]}</span>
        <span>Impact {LEVEL[i.impact]}</span>
        <span aria-hidden>·</span>
        <span>Urgency {LEVEL[i.urgency]}</span>
        <span aria-hidden>·</span>
        <span>{i.confidence[0].toUpperCase() + i.confidence.slice(1)} confidence</span>
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug">{i.title}</h3>
      <dl className="mt-2 space-y-1.5 text-[13px] leading-snug">
        <div>
          <dt className="inline font-medium">Fact: </dt>
          <dd className="inline text-muted-foreground">{i.fact}</dd>
        </div>
        {!compact && i.hypothesis && (
          <div>
            <dt className="inline font-medium">Possible reason: </dt>
            <dd className="inline text-muted-foreground">{i.hypothesis}</dd>
          </div>
        )}
        {i.recommendation && (
          <div>
            <dt className="inline font-medium">Recommendation: </dt>
            <dd className="inline text-muted-foreground">{i.recommendation}</dd>
          </div>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
        {!compact && i.evidence.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
            Evidence <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
        {onOpen && (
          <button type="button" onClick={onOpen} className="min-h-8 text-[12px] font-medium text-muted-foreground hover:text-foreground">
            Open {BI_TAB_LABEL[i.tab]} ›
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-muted/50 p-2.5 text-[12px] text-muted-foreground">
          {i.evidence.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </article>
  );
}

export function InsightsTab({ range, goTo }: TabProps) {
  const q = useBiTab<InsightsView>("insights", range);
  const cleo = useCleoAccess();
  const [question, setQuestion] = useState("");
  const v = q.data;
  if (!v) return <div />;
  const ask = (text: string) =>
    openSummer({
      general: true,
      prompt: `${text.trim()}\n\n(Use the business analytics for ${range.from} to ${range.to}. Keep facts, possible reasons and recommendations apart, and don't change anything.)`,
    });
  return (
    <div className="space-y-4">
      {v.weekly && (
        <IntelSection title={`Last week · ${v.weekly.label}`} sub={v.weekly.headline}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-7" data-weekly-summary>
            {v.weekly.lines.map((l) => (
              <div key={l.label} className="min-w-0">
                <dt className="text-[12px] text-muted-foreground">{l.label}</dt>
                <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{l.value}</dd>
                {l.change && <dd className="text-[11px] text-muted-foreground">{l.change === "new" ? "new this week" : `${l.change} vs the week before`}</dd>}
              </div>
            ))}
          </dl>
        </IntelSection>
      )}

      {cleo && (
        <IntelSection title="Ask Cleo about the numbers" sub="Cleo reads the same analytics. It answers; it never changes anything.">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) ask(question);
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Why are fewer visitors signing up?"
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-[14px]"
              aria-label="Your question"
            />
            <Button type="submit" className="h-10 gap-1.5" disabled={!question.trim()}>
              <CleoMark className="h-4 w-4" /> Ask Cleo
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUESTIONS.map((t) => (
              <button key={t} type="button" onClick={() => ask(t)} className="min-h-9 rounded-full border px-3 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
                {t}
              </button>
            ))}
          </div>
        </IntelSection>
      )}

      <section aria-label="Insights" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">What to act on</h2>
          <span className="text-[12px] text-muted-foreground">Ranked by impact, urgency and confidence</span>
        </div>
        {v.insights.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {v.insights.map((i) => <InsightCard key={i.id} insight={i} onOpen={() => goTo(i.tab)} />)}
          </div>
        ) : (
          <p className="rounded-2xl border p-4 text-[13px] text-muted-foreground">
            Nothing stands out in this period. Each rule waits for enough data before it says anything, so a quiet list on a small
            sample is the honest answer.
          </p>
        )}
      </section>
    </div>
  );
}
