import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy, ChevronDown, Info } from "lucide-react";
import { getPlanEventsFn } from "@/lib/competition/competition.functions";
import { defaultPlanEvent, eventCountdown, planMilestones, type PlanMilestone } from "@/lib/plan-event-timeline";
import { todayLocalISO } from "@/lib/today";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const planEventsKey = (clientId: string) => ["plan-events", clientId] as const;

export function PlanEventTimeline({ clientId, selectedEventId, onPick, renderMilestone }: {
  clientId: string;
  selectedEventId?: string;
  onPick?: (milestone: PlanMilestone) => void;
  renderMilestone?: (milestone: PlanMilestone) => ReactNode;
}) {
  const read = useServerFn(getPlanEventsFn);
  const q = useQuery({ queryKey: planEventsKey(clientId), queryFn: () => read({ data: { clientId } }), enabled: !!clientId, staleTime: 30_000 });
  const [chosenEvent, setChosenEvent] = useState("");
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const today = todayLocalISO();
  const events = q.data ?? [];
  const event = events.find((e) => e.id === (selectedEventId || chosenEvent)) ?? defaultPlanEvent(events, today);
  const milestones = event ? planMilestones(event) : [];
  const selected = milestones.find((m) => m.daysOut === chosenDays) ?? milestones.find((m) => m.date >= today) ?? milestones[milestones.length - 1];
  if (q.isError) return <div className="text-xs text-muted-foreground">Event timeline unavailable. <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></div>;
  if (!event) return null;

  return (
    <details className="group min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-xs" data-plan-event-timeline>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{event.name}</span>
        <span className="shrink-0 text-muted-foreground">{eventCountdown(event, today)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border pt-2">
        <div className="flex items-center gap-2">
          <label className="min-w-0 flex-1 text-muted-foreground">Event
            <select aria-label="Event" value={event.id} disabled={!!selectedEventId} onChange={(e) => { setChosenEvent(e.target.value); setChosenDays(null); }} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground">
              {events.map((e) => <option value={e.id} key={e.id}>{e.name} · {e.meet_date}</option>)}
            </select>
          </label>
          <Popover>
            <PopoverTrigger asChild><button type="button" title="About event milestones" aria-label="About event milestones" className="mt-4 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground"><Info className="h-4 w-4"/></button></PopoverTrigger>
            <PopoverContent align="end" className="text-xs">Milestones count back from the saved event date. Moving an event updates these markers, not the athlete's published plans.</PopoverContent>
          </Popover>
        </div>
        <label className="block text-muted-foreground">Milestone
          <select value={selected?.daysOut ?? ""} onChange={(e) => setChosenDays(Number(e.target.value))} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground">
            {milestones.map((m) => <option key={m.daysOut} value={m.daysOut}>{m.label} · {m.date}</option>)}
          </select>
        </label>
        {selected && <>
          {renderMilestone?.(selected)}
          {onPick && <button type="button" className="w-full rounded-md border border-border px-2 py-2 font-medium hover:bg-muted" onClick={() => onPick(selected)}>Reference this date</button>}
        </>}
      </div>
    </details>
  );
}
