/**
 * Cleo's recommendation on a weekly check-in, private to the coach (Nov 23
 * 2026): one coordinated read across nutrition, cardio and training
 * (coaching-recommendation/consolidate.ts), each part with what was seen, what
 * to do, why and how sure. Review opens the right tab; Edit keeps the coach's
 * own words with it (Cleo reads them next time); Apply to draft puts a cardio
 * change on the cardio draft (as Cleo's proposal) or a nutrition change in
 * Adjust plan, both reviewed before anything reaches the client; Dismiss puts
 * it away. Holding the plan is a recommendation of its own. Never sent to the
 * client.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CleoMark } from "@/components/summer/cleo-mark";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { applyRecommendationItemFn, decideRecommendationFn, getCheckinRecommendationFn } from "@/lib/cardio/cardio.functions";
import { DOMAIN_LABEL } from "@/lib/coaching-recommendation/consolidate";
import { cn } from "@/lib/utils";

const STATUS: Record<string, string> = { applied: "Applied to a draft", edited: "Edited", dismissed: "Dismissed", superseded: "A newer check-in replaced this" };

export function CleoRecommendationCard({ checkinId }: { checkinId: string }) {
  const read = useServerFn(getCheckinRecommendationFn);
  const decide = useServerFn(decideRecommendationFn);
  const apply = useServerFn(applyRecommendationItemFn);
  const cleo = useCleoAccess();
  const qc = useQueryClient();
  const key = ["checkin-recommendation", checkinId];
  const q = useQuery({ queryKey: key, queryFn: () => read({ data: { checkinId } }), staleTime: 60_000, retry: 1 });
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rec = q.data;
  if (q.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading training, nutrition and cardio…
      </div>
    );
  }
  if (!rec) return null;
  const closed = rec.status !== "open" && rec.status !== "edited";

  const setStatus = async (status: "edited" | "dismissed" | "open", note?: string | null) => {
    setBusy(status);
    try {
      await decide({ data: { id: rec.id, status, note } });
      await qc.invalidateQueries({ queryKey: key });
      if (status === "dismissed") toast("Dismissed", { action: { label: "Undo", onClick: () => void setStatus("open") } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  const applyItem = async (index: number) => {
    setBusy(`apply-${index}`);
    try {
      const r: any = await apply({ data: { id: rec.id, index } });
      await qc.invalidateQueries({ queryKey: key });
      if (r.kind === "cardio") {
        qc.invalidateQueries({ queryKey: ["cardio-workspace", r.clientId] });
        toast.success(r.drafted ? "On their cardio draft. Review it on the Cardio tab, then publish." : "Cleo answered without a change: open the Cardio tab to see why.");
      } else {
        qc.invalidateQueries({ queryKey: ["nutrition-plan-edit"] });
        toast.success("Sent to Adjust plan. You'll review exactly what changes before it reaches their plan.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't apply that");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-2 rounded-xl border border-border bg-card p-3 text-[12px]" data-cleo-recommendation>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-background">{cleo ? <CleoMark size={13} /> : null}</span>
        <p className="min-w-0 flex-1 text-[13px] font-semibold">{cleo ? "Cleo recommendation" : "Recommendation"}</p>
        {rec.status !== "open" && <span className="text-[11px] text-muted-foreground">{STATUS[rec.status] ?? rec.status}</span>}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Only you see this. Nothing changes until you do.</p>
      <ul className="mt-2 space-y-2.5">
        {rec.items.map((item, i) => (
          <li key={i} className={cn(i > 0 && "border-t border-border pt-2.5")} data-rec-item={item.domain}>
            <p className="text-[12px] font-semibold">
              {DOMAIN_LABEL[item.domain]}: {item.title}
            </p>
            <dl className="mt-1 space-y-0.5 leading-snug">
              <div><dt className="inline font-medium">Observation: </dt><dd className="inline text-muted-foreground">{item.observation}</dd></div>
              <div><dt className="inline font-medium">Recommendation: </dt><dd className="inline text-muted-foreground">{item.recommendation}</dd></div>
              <div><dt className="inline font-medium">Reason: </dt><dd className="inline text-muted-foreground">{item.reason}</dd></div>
              <div><dt className="inline font-medium">Confidence: </dt><dd className="inline text-muted-foreground">{item.confidence[0].toUpperCase() + item.confidence.slice(1)}</dd></div>
            </dl>
            {!closed && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.action.kind === "review" || item.action.kind === "cardio_draft" || item.action.kind === "nutrition_change" ? (
                  <Button asChild variant="outline" className="h-8 px-2.5 text-[12px]">
                    <Link
                      to="/admin/clients/$id"
                      params={{ id: rec.client_id }}
                      search={{ tab: item.action.kind === "review" ? item.action.tab : item.action.kind === "cardio_draft" ? "cardio" : "nutrition" } as any}
                    >
                      Review
                    </Link>
                  </Button>
                ) : null}
                {(item.action.kind === "cardio_draft" || item.action.kind === "nutrition_change") && (
                  <Button variant="outline" className="h-8 px-2.5 text-[12px]" disabled={!!busy} onClick={() => void applyItem(i)} data-rec-apply>
                    {busy === `apply-${i}` ? "Applying…" : "Apply to draft"}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {rec.coach_note && !editing && <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[12px]">Your note: {rec.coach_note}</p>}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Your own call (Cleo reads it next time, and Apply uses it)" />
          <div className="flex gap-2">
            <Button className="h-8 text-[12px]" disabled={!!busy} onClick={async () => { await setStatus("edited", words); setEditing(false); }}>
              Save
            </Button>
            <Button variant="ghost" className="h-8 text-[12px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        !closed && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
            <Button variant="ghost" className="h-8 px-2.5 text-[12px]" onClick={() => { setWords(rec.coach_note ?? ""); setEditing(true); }} data-rec-edit>
              Edit recommendation
            </Button>
            <Button variant="ghost" className="h-8 px-2.5 text-[12px] text-muted-foreground" disabled={!!busy} onClick={() => void setStatus("dismissed")} data-rec-dismiss>
              Dismiss
            </Button>
          </div>
        )
      )}
    </section>
  );
}
