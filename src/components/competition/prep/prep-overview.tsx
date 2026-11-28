/**
 * The competition's overview, in the order a coach needs it: how far out,
 * how ready (by what matters, not a percentage), what's outstanding, what's
 * next, and Cleo's one recommendation with the tap that acts on it. The
 * handling service (when there is one) is one line under it; everything else
 * is a section away.
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { HANDLING_WORD, PAYMENT_WORD } from "@/lib/competition/handling";
import { HandlingSheet } from "./handling-sheets";
import { PrepReferences } from "./prep-references";
import { ReadinessWord, countdown, dayWords } from "./prep-ui";

export type PrepSection = "overview" | "gameplan" | "timeline" | "checklist";

export function PrepOverview({
  prep,
  onSection,
  onChanged,
  onReviewChanges,
  extra,
}: {
  prep: any;
  onSection: (s: PrepSection) => void;
  onChanged: () => void;
  onReviewChanges: () => void;
  /** Cleo's assessments and anything else the coach must see (rendered under the recommendation) */
  extra?: React.ReactNode;
}) {
  const [handlingOpen, setHandlingOpen] = useState(false);
  const comp = prep.competition;
  const r = prep.recommendation;
  const h = prep.handling;
  const top = (prep.readiness.outstanding as any[]).slice(0, 3);
  const act = (): (() => void) | null => {
    switch (r.action) {
      case "review_suggestion":
      case "approve_plan":
      case "fix_plan":
        return () => onSection("gameplan");
      case "review_changes":
        return onReviewChanges;
      case "send_invite":
        return () => setHandlingOpen(true);
      case "checklist":
        return () => onSection("checklist");
      case "schedule":
        return () => onSection("timeline");
      default:
        return null;
    }
  };
  const go = act();
  return (
    <div className="space-y-3" data-prep-overview>
      <section className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-card">
        <div className="min-w-0 p-3">
          <p className="text-[12px] text-muted-foreground">Countdown</p>
          <p className="text-[22px] font-semibold leading-tight" data-countdown>
            {countdown(prep.today, String(comp.meet_date))}
          </p>
          <p className="text-[12.5px] text-muted-foreground">{dayWords(String(comp.meet_date))}</p>
        </div>
        <button type="button" onClick={() => onSection("checklist")} className="min-w-0 p-3 text-left hover:bg-muted/30">
          <p className="text-[12px] text-muted-foreground">Checklist readiness</p>
          <ReadinessWord verdict={prep.readiness.verdict} className="text-[22px] leading-tight" />
          <p className="text-[12.5px] text-muted-foreground">{prep.readiness.line}</p>
        </button>
      </section>

      <section className="flex items-start gap-2 rounded-xl border border-border bg-card p-3" data-prep-recommendation>
        <CleoAvatar size="sm" />
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Next recommendation</p>
          <p className="text-[14px] leading-snug">{r.text}</p>
          {r.why ? <p className="text-[12.5px] text-muted-foreground">{r.why}</p> : null}
        </div>
        {go ? (
          <Button size="sm" variant="outline" onClick={go}>
            {r.action === "approve_plan" || r.action === "fix_plan" || r.action === "review_suggestion" ? "Review plan" : r.action === "checklist" ? "Checklist" : r.action === "schedule" ? "Timeline" : "Review"}
          </Button>
        ) : null}
      </section>

      {extra}
      <PrepReferences key={comp.id} competitionId={comp.id} />

      {prep.changes.length ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-info-changes>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold">{prep.client.first} changed their meet details</h3>
            <Button size="sm" variant="outline" onClick={onReviewChanges}>
              Review
            </Button>
          </div>
          <ul className="mt-1 space-y-0.5 text-[13.5px]">
            {(prep.changes as any[]).slice(0, 4).map((c, i) => (
              <li key={i}>· {c.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card" data-prep-priorities>
        <header className="flex items-baseline justify-between px-4 pt-3">
          <h3 className="text-[15px] font-semibold">Outstanding</h3>
          {prep.next ? (
            <span className="text-[12.5px] text-muted-foreground" data-next-action>
              Next: {prep.next.label} · {prep.next.when}
            </span>
          ) : null}
        </header>
        {top.length ? (
          <ul className="mt-1 divide-y divide-border">
            {top.map((i) => (
              <li key={i.key}>
                <button type="button" onClick={() => onSection("checklist")} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="text-[14px]">{i.label}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {i.priority === "critical" ? "Must-have" : "Important"} · {i.due < prep.today ? <span className="text-destructive">overdue</span> : `by ${dayWords(i.due)}`}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-3 pt-1 text-[13.5px] text-muted-foreground">Nothing outstanding.</p>
        )}
        <div className="h-1" />
      </section>

      {h ? (
        <button
          type="button"
          onClick={() => setHandlingOpen(true)}
          className="flex w-full items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/30"
          data-handling-strip
        >
          <span className="min-w-0 text-[14px]">
            <span className="font-medium">Competition handling</span>
            <span className="text-muted-foreground">
              {" "}
              · {HANDLING_WORD[h.status as keyof typeof HANDLING_WORD]} · {PAYMENT_WORD[h.payment as keyof typeof PAYMENT_WORD] ?? "No price set"}
              {h.existingCoach?.name ? ` · coach: ${h.existingCoach.name}` : ""}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}
      {h ? <HandlingSheet open={handlingOpen} onClose={() => setHandlingOpen(false)} prep={prep} onChanged={onChanged} /> : null}
    </div>
  );
}
