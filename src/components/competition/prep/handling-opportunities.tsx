/**
 * Service opportunities a coach agreed to in a meeting (someone to handle at a
 * meet), found in the meeting's checked analysis: one line each with the one
 * tap that prepares the invitation from what's already known. Shown in the
 * meeting's outcome and on the referring client's Competition tab; gone once
 * the invitation is prepared. Never contacts anyone.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { handlingOpportunitiesFn } from "@/lib/competition/handling.functions";
import type { HandlingOpportunity } from "@/lib/competition/opportunities";
import { HandlingInviteSheet } from "./handling-sheets";
import { dayWords } from "./prep-ui";

export function HandlingOpportunities({ clientId, sessionId }: { clientId?: string; sessionId?: string }) {
  const read = useServerFn(handlingOpportunitiesFn);
  const qc = useQueryClient();
  const key = ["handling-opportunities", clientId ?? null, sessionId ?? null];
  const q = useQuery({
    queryKey: key,
    queryFn: () => read({ data: { clientId, sessionId } }),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState<(HandlingOpportunity & { sessionId?: string }) | null>(null);
  const list = (q.data?.opportunities ?? []) as Array<HandlingOpportunity & { sessionId?: string }>;
  if (!list.length) return null;
  return (
    <>
      {list.map((o) => (
        <section key={o.key} className="rounded-2xl border border-border bg-card p-4" data-handling-opportunity>
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Service opportunity</p>
          <p className="mt-0.5 text-[15px] font-semibold">
            Handle {o.athleteName}
            {o.competition?.name ? ` at ${o.competition.name}` : ""}
            {o.competition?.date ? ` · ${dayWords(o.competition.date)}` : ""}
          </p>
          <p className="text-[13px] text-muted-foreground">
            From your meeting with {o.referrer.name}
            {o.waitingOn.length ? ` · waiting on: ${o.waitingOn[0]}` : ""}
          </p>
          <Button size="sm" className="mt-2" onClick={() => setOpen(o)} data-prepare-opportunity>
            Prepare the invitation
          </Button>
        </section>
      ))}
      {open ? (
        <HandlingInviteSheet
          open
          opportunity={open}
          onClose={() => {
            setOpen(null);
            void qc.invalidateQueries({ queryKey: ["handling-opportunities"] });
          }}
          onCreated={() => void qc.invalidateQueries({ queryKey: ["handling-opportunities"] })}
        />
      ) : null}
    </>
  );
}
