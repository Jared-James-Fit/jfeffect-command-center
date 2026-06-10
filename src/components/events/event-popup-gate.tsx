import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  computeCountdown, formatEventWhen, importanceBadgeClass, REMINDER_OFFSETS,
  type EventRow, type ReminderOffsetKey,
} from "@/lib/events";

/** Show a one-shot popup for High/Critical events when distance hits a milestone. */
export function EventPopupGate() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["event-popup-candidates"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { events: [] as EventRow[], acks: new Set<string>() };
      const { data: events } = await (supabase.from("events") as any)
        .select("*")
        .eq("status", "Active")
        .in("importance", ["High", "Critical"])
        .gte("event_date", today)
        .order("event_date").limit(20);
      const { data: acks } = await (supabase.from("event_popup_acks") as any)
        .select("event_id, offset_key").eq("user_id", u.user.id);
      const set = new Set((acks ?? []).map((a: any) => `${a.event_id}:${a.offset_key}`));
      return { events: (events ?? []) as EventRow[], acks: set };
    },
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const next = (() => {
    if (!data) return null;
    for (const ev of data.events) {
      const c = computeCountdown(ev.event_date);
      const match = matchMilestone(c.daysRemaining);
      if (!match) continue;
      const key = `${ev.id}:${match}`;
      if (data.acks.has(key) || dismissed.has(key)) continue;
      return { ev, offset: match, countdown: c };
    }
    return null;
  })();

  async function acknowledge() {
    if (!next) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setDismissed((s) => new Set(s).add(`${next.ev.id}:${next.offset}`));
    await (supabase.from("event_popup_acks") as any).insert({
      event_id: next.ev.id, user_id: u.user.id, offset_key: next.offset,
    });
    qc.invalidateQueries({ queryKey: ["event-popup-candidates"] });
  }

  if (!next) return null;

  const offsetLabel = REMINDER_OFFSETS.find((o) => o.key === next.offset)?.label ?? next.countdown.label;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) acknowledge(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Upcoming Event
            <Badge className={importanceBadgeClass(next.ev.importance)}>{next.ev.importance}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-xl font-bold">{next.ev.name}</div>
          <div className="text-sm text-muted-foreground">{formatEventWhen(next.ev)}</div>
          <div className="rounded-md bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">{offsetLabel}</div>
          {next.ev.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{next.ev.description}</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button asChild variant="outline"><Link to="/portal/events/$id" params={{ id: next.ev.id }} onClick={acknowledge}>View details</Link></Button>
          <Button onClick={acknowledge}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function matchMilestone(days: number): ReminderOffsetKey | null {
  if (days === 0) return "day_of";
  if (days === 1) return "d1";
  if (days <= 3 && days > 1) return "d3";
  if (days <= 7 && days > 3) return "w1";
  if (days <= 14 && days > 7) return "w2";
  if (days <= 28 && days > 14) return "w4";
  if (days <= 56 && days > 28) return "w8";
  if (days <= 84 && days > 56) return "w12";
  return null;
}
