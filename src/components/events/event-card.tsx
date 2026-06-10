import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin } from "lucide-react";
import { computeCountdown, formatEventWhen, importanceBadgeClass, type EventRow } from "@/lib/events";
import { cn } from "@/lib/utils";

export function EventCard({
  ev, to, params, linksCount, assignedCount,
}: {
  ev: EventRow;
  to: string;
  params?: Record<string, string>;
  linksCount?: number;
  assignedCount?: number;
}) {
  const c = computeCountdown(ev.event_date);
  const pulse = c.tone === "today" || c.tone === "imminent";
  const glow  = ev.importance === "High" || ev.importance === "Critical";
  return (
    <Link to={to} params={params as any} className="block">
      <Card
        className={cn(
          "group p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none",
          glow && "ring-1 ring-primary/40 shadow-[0_0_28px_-12px_hsl(var(--primary)/0.55)]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold leading-tight truncate">{ev.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">{ev.event_type}</Badge>
              <Badge className={cn("text-[10px]", importanceBadgeClass(ev.importance))}>{ev.importance}</Badge>
              {ev.status !== "Active" && <Badge variant="secondary" className="text-[10px]">{ev.status}</Badge>}
            </div>
          </div>
          <div className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide",
            c.tone === "today" ? "bg-primary text-primary-foreground" :
            c.tone === "imminent" ? "bg-primary/15 text-primary" :
            c.tone === "soon" ? "bg-accent text-accent-foreground" :
            c.tone === "past" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground",
            pulse && "motion-safe:animate-pulse",
          )}>{c.label}</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatEventWhen(ev)}</span>
          {ev.location && <span className="inline-flex items-center gap-1 truncate"><MapPin className="h-3.5 w-3.5" />{ev.location}</span>}
          {typeof assignedCount === "number" && <span>{assignedCount} assigned</span>}
          {typeof linksCount === "number" && linksCount > 0 && <span>{linksCount} links</span>}
        </div>
      </Card>
    </Link>
  );
}
