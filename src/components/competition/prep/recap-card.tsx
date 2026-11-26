/**
 * After the meet (Nov 26 2026): the results against their targets and the
 * plan, worked out in code from what was recorded (`buildRecap`), a short
 * message for the coach to edit and send himself, and what could come next
 * (coaching, a free membership, handling at their next meet) said as
 * suggestions: nothing is sent, sold or started by this card. Saving it
 * completes the handling; the athlete's account and everything on it stay.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { handlingRecapFn } from "@/lib/competition/handling.functions";
import { SectionCard } from "./prep-ui";

const LIFT_WORD = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;
const OFFER: Record<string, string> = {
  coaching: "Offer coaching: they already know how you work",
  membership: "Offer the free app so their meet history and training stay in one place",
  handling: "Offer handling at their next meet",
};

export function RecapCard({ prep, onChanged }: { prep: any; onChanged: () => void }) {
  const read = useServerFn(handlingRecapFn);
  const comp = prep.competition;
  const q = useQuery({
    queryKey: ["handling-recap", comp.id, !!comp.results],
    queryFn: () => read({ data: { competitionId: comp.id, save: false } }),
    enabled: !!comp.results,
    staleTime: 60_000,
    retry: false,
  });
  const recap = q.data?.recap;
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (recap) setMessage(prep.handling?.recap?.message ?? recap.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap?.message]);
  const save = useMutation({
    mutationFn: () => read({ data: { competitionId: comp.id, save: true, message } }),
    onSuccess: () => {
      onChanged();
      toast.success("Saved. Handling is complete; their account stays as it is.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save it"),
  });
  if (!comp.results || !recap) return null;
  const done = prep.handling?.status === "completed";
  return (
    <SectionCard title="Meet recap" sub={recap.total ? `Total ${recap.total} kg${recap.targetTotal ? ` · target ${recap.targetTotal} kg` : ""}` : undefined} data-meet-recap>
      <table className="w-full text-[14px]">
        <tbody>
          {(recap.lines as any[]).map((l) => (
            <tr key={l.lift} className="border-b border-border last:border-0">
              <td className="py-1.5 font-medium">{LIFT_WORD[l.lift as keyof typeof LIFT_WORD]}</td>
              <td className="py-1.5 tabular-nums">{l.best ?? "–"} kg</td>
              <td className="py-1.5 text-right text-[12.5px] text-muted-foreground">
                {l.made != null && l.taken ? `${l.made}/${l.taken} made` : ""}
                {l.vsTarget != null ? ` · ${l.vsTarget >= 0 ? "+" : ""}${l.vsTarget} vs target` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {recap.highlights.length ? (
        <ul className="mt-2 space-y-0.5 text-[13.5px]">
          {recap.highlights.map((h: string, i: number) => (
            <li key={i}>· {h}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 space-y-1.5">
        <p className="text-[12.5px] text-muted-foreground">A message for {prep.client.first} (edit it and send it yourself)</p>
        <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} data-recap-message />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message);
                toast.success("Copied");
              } catch {
                toast.error("Couldn't copy it");
              }
            }}
          >
            <Copy className="h-4 w-4" /> Copy
          </Button>
          {prep.handling && !done ? (
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()} data-recap-complete>
              Save and complete handling
            </Button>
          ) : null}
        </div>
      </div>
      {recap.offers.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-[12.5px] text-muted-foreground">What could come next (nothing starts unless they choose it)</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px]">
            {(recap.offers as string[]).map((o) => (
              <li key={o}>· {OFFER[o] ?? o}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}
