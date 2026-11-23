/**
 * Actionable intelligence: what the records say, one card per underlying
 * issue (insights.ts), the ones to look at first on top. Each says what kind
 * of statement it is: measured (a fact, with its records), an interpretation
 * (a hypothesis to check), something the records can't tell, or something
 * you confirmed. A card's suggestion goes into your instructions in one tap.
 */
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, CircleHelp, Eye, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Insight, InsightKind, InsightTone } from "@/lib/program-intel/insights";

export const KIND_WORD: Record<InsightKind, string> = { fact: "Measured", hypothesis: "Interpretation", missing: "Not on file", approved: "You confirmed" };
const KIND_CLASS: Record<InsightKind, string> = {
  fact: "bg-secondary text-foreground",
  hypothesis: "border border-dashed border-muted-foreground/50 text-muted-foreground",
  missing: "bg-muted text-muted-foreground",
  approved: "bg-success/12 text-success",
};
const TONE_ICON: Record<InsightTone, React.ReactNode> = {
  risk: <AlertTriangle className="h-4 w-4 text-warning" />,
  watch: <Eye className="h-4 w-4 text-muted-foreground" />,
  win: <TrendingUp className="h-4 w-4 text-success" />,
  gap: <CircleHelp className="h-4 w-4 text-muted-foreground" />,
};

export function KindTag({ kind }: { kind: InsightKind }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold", KIND_CLASS[kind])} data-kind={kind}>{KIND_WORD[kind]}</span>;
}

function InsightCard({ i, onAdd, added }: { i: Insight; onAdd?: (line: string) => void; added: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("rounded-xl border p-3", i.tone === "risk" ? "border-warning/40" : "border-border")} data-insight={i.id} data-priority={i.priority}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{TONE_ICON[i.tone]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">{i.title}</div>
          {i.detail ? <p className={cn("mt-0.5 text-[13px] leading-relaxed text-muted-foreground", !open && "line-clamp-2")}>{i.detail}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <KindTag kind={i.kind} />
            <span className="truncate text-[11px] text-muted-foreground">{i.sources.join(" · ")}</span>
          </div>
          {open && i.evidence.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground" data-insight-evidence>
              {i.evidence.map((e, n) => <li key={n} className="list-inside list-disc">{e}</li>)}
            </ul>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {(i.evidence.length > 0 || (i.detail?.length ?? 0) > 120) && (
              <Button size="sm" variant="ghost" className="-ml-2 h-8 px-2 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {open ? "Less" : i.evidence.length ? `Evidence (${i.evidence.length})` : "More"}
                <ChevronDown className={cn("ml-0.5 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
              </Button>
            )}
            {i.suggestion && onAdd && (
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={added} onClick={() => onAdd(i.suggestion!)} data-insight-add>
                {added ? <><Check className="mr-1 h-3.5 w-3.5" /> In your instructions</> : <><Plus className="mr-1 h-3.5 w-3.5" /> Add to instructions</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export function InsightList({ insights, onAdd, notes, extra }: { insights: Insight[]; onAdd?: (line: string) => void; notes: string; extra?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? insights : insights.slice(0, 5);
  const counts = { risk: insights.filter((i) => i.tone === "risk").length, watch: insights.filter((i) => i.tone === "watch").length, win: insights.filter((i) => i.tone === "win").length };
  return (
    <Card className="space-y-3 p-4" data-workflow-section="insights" data-testid="gen-insights">
      <div>
        <h2 className="text-base font-semibold">What stands out</h2>
        <span className="block text-xs text-muted-foreground">
          {[counts.risk ? `${counts.risk} to look at` : null, counts.watch ? `${counts.watch} to watch` : null, counts.win ? `${counts.win} working` : null].filter(Boolean).join(" · ") || "Nothing stands out"}
        </span>
      </div>
      {insights.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing in the records needs your attention.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => <InsightCard key={i.id} i={i} onAdd={onAdd} added={!!i.suggestion && notes.includes(i.suggestion)} />)}
        </ul>
      )}
      {insights.length > 5 && (
        <Button variant="ghost" className="h-9 w-full text-sm" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${insights.length}`}
        </Button>
      )}
      {extra}
    </Card>
  );
}
