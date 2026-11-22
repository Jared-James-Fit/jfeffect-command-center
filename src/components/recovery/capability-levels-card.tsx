/**
 * The owner's view of what Cleo may do for whom (Settings → AI & Cleo): the
 * three levels, which capabilities each holds, who has them, and the way into
 * recovery automation. Nobody else sees it (the database refuses the overview
 * to anyone without owner controls, two-step sign-in included). Nothing here
 * sells or grants anything: the paid tier isn't offered yet.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CAPABILITY_FEATURES, LEVEL_COPY, LEVEL_ORDER } from "@/lib/cleo-capabilities";
import { getCapabilityOverviewFn } from "@/lib/recovery-automation/queue.functions";
import { RecoveryQueueSheet, useRecoveryQueue } from "@/components/recovery/recovery-queue";

export function CapabilityLevelsCard() {
  const get = useServerFn(getCapabilityOverviewFn);
  const q = useQuery({ queryKey: ["cleo-capability-overview"], queryFn: () => get(), retry: false, staleTime: 60_000 });
  const queue = useRecoveryQueue(!!q.data);
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  const activeGrants = q.data.grants.filter((g) => !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > Date.now()));
  return (
    <Card className="space-y-4 p-4" data-capability-levels>
      <div>
        <h2 className="text-base font-semibold">What Cleo does, by level</h2>
        <p className="text-[13px] text-muted-foreground">Decided by the database for every request and background job. The owner level is yours alone and can't be bought or granted.</p>
      </div>
      <div className="space-y-3">
        {LEVEL_ORDER.map((level) => {
          const copy = LEVEL_COPY[level];
          const who = level === "automation" ? (activeGrants.length ? `${new Set(activeGrants.map((g) => g.user_id)).size} with a grant` : copy.who) : level === "assist" ? `${copy.who} (${q.data.coaches.length})` : copy.who;
          return (
            <div key={level} className="rounded-xl border border-border p-3" data-capability-level={level}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold">{copy.name}</p>
                <p className="text-[12px] text-muted-foreground">{who}</p>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{copy.line}</p>
              <ul className="mt-2 space-y-0.5 text-[13px]">
                {CAPABILITY_FEATURES.filter((f) => f.level === level).map((f) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span>
                    <span className="text-muted-foreground">: {f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-[13px] text-muted-foreground">Recovery replies and follow-ups: choose what's drafted, what waits for you and what goes by itself.</p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!queue.data?.enabled}>
          Recovery settings
        </Button>
      </div>
      <RecoveryQueueSheet open={open} onOpenChange={setOpen} queue={queue.data} initialTab="settings" />
    </Card>
  );
}
