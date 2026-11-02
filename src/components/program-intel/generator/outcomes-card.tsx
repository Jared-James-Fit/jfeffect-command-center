/**
 * What came of a program Generate Next Program wrote, against the strategy
 * it was built from. Measured results are facts; whether a decision caused
 * them is the coach's call: Confirm stores it in the athlete's memory (the
 * next strategy reads it), Dismiss records that it didn't hold.
 */
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProgramOutcome } from "@/lib/program-intel/outcomes";
import { KindChip } from "../sections";
import { useRecordOutcome } from "../use-program-intel";
import { SectionTitle } from "./overview";

const VERDICT: Record<string, string> = { supported: "text-emerald-600", contradicted: "text-destructive", unclear: "text-muted-foreground" };

export function OutcomesCard({ clientId, outcomes, recordedKeys }: { clientId: string; outcomes: ProgramOutcome[]; recordedKeys: Set<string> }) {
  const record = useRecordOutcome(clientId);
  const shown = outcomes.filter((o) => o.items.some((i) => !recordedKeys.has(`outcome:${o.jobId}:${i.key}`)));
  if (!shown.length) return null;
  return (
    <Card className="space-y-2 p-3.5" data-testid="gen-outcomes">
      <SectionTitle hint="confirm what held">Results of programs generated before</SectionTitle>
      {shown.map((o) => (
        <details key={o.jobId} open={o.finished} className="rounded-xl bg-secondary/30 p-2.5">
          <summary className="cursor-pointer select-none text-[13px] font-bold">
            {o.label} · {o.trainedShare}% of workouts trained{o.finished ? "" : " (still running)"}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {o.items
              .filter((i) => !recordedKeys.has(`outcome:${o.jobId}:${i.key}`))
              .map((i) => (
                <li key={i.key} className="text-[12px]">
                  <div className="flex items-start gap-1.5">
                    <KindChip kind={i.kind} />
                    <span className="font-semibold">{i.title}</span>
                    {i.verdict ? <span className={cn("ml-auto shrink-0 text-[10px] font-black uppercase", VERDICT[i.verdict])}>{i.verdict}</span> : null}
                  </div>
                  {i.detail ? <div className="text-[11px] text-muted-foreground">{i.detail}</div> : null}
                  {o.finished && (
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={record.isPending} onClick={() => record.mutate({ key: `outcome:${o.jobId}:${i.key}`, statement: `${i.title}${i.detail ? `. ${i.detail}` : ""}`, evidence: i.evidence, confidence: i.kind, status: "approved", blockId: o.blockIds[0] ?? null }, { onSuccess: () => toast.success("Kept in the athlete's memory"), onError: (e: any) => toast.error(e?.message ?? "Couldn't save") })}>
                        <Check className="mr-1 h-3 w-3" /> Confirm
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={record.isPending} onClick={() => record.mutate({ key: `outcome:${o.jobId}:${i.key}`, statement: i.title, evidence: i.evidence, confidence: "hypothesis", status: "rejected", blockId: o.blockIds[0] ?? null })}>
                        <X className="mr-1 h-3 w-3" /> Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </details>
      ))}
    </Card>
  );
}
