import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Clock, ExternalLink, MessageCircle, Download } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  computeCountdown, formatEventWhen, importanceBadgeClass, downloadICS,
  REMINDER_OFFSETS, type EventRow, type QuickLink, type Deadline, type Reminder,
} from "@/lib/events";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

export function ClientEventDetail({
  event, links, deadlines, reminders, hideActions,
}: {
  event: EventRow;
  links: QuickLink[];
  deadlines: Deadline[];
  reminders: Reminder[];
  hideActions?: boolean;
}) {
  const c = computeCountdown(event.event_date);
  const glow = event.importance === "High" || event.importance === "Critical";
  return (
    <div className="space-y-4">
      <Card className={cn(
        "p-5 animate-in fade-in slide-in-from-bottom-1 duration-200",
        glow && "ring-1 ring-primary/40 shadow-[0_0_28px_-12px_hsl(var(--primary)/0.55)]",
      )}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{event.event_type}</Badge>
              <Badge className={importanceBadgeClass(event.importance)}>{event.importance}</Badge>
              {event.status === "Completed" && <Badge variant="secondary">Completed</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{event.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" />{formatEventWhen(event)}</span>
              {event.end_time && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />until {event.end_time.slice(0,5)}</span>}
              {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{event.location}</span>}
            </div>
          </div>
          <div className={cn(
            "rounded-lg px-3 py-2 text-center",
            c.tone === "today" ? "bg-primary text-primary-foreground" :
            c.tone === "imminent" ? "bg-primary/15 text-primary" :
            c.tone === "soon" ? "bg-accent text-accent-foreground" :
            c.tone === "past" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground",
            (c.tone === "today" || c.tone === "imminent") && "motion-safe:animate-pulse",
          )}>
            <div className="text-xs uppercase tracking-widest opacity-80">Countdown</div>
            <div className="text-lg font-bold leading-tight">{c.label}</div>
          </div>
        </div>

        {!hideActions && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => downloadICS(event)}><Download className="mr-1 h-4 w-4" />Add to calendar</Button>
            <Button asChild variant="outline" size="sm"><Link to="/portal/messages"><MessageCircle className="mr-1 h-4 w-4" />Message coach</Link></Button>
          </div>
        )}
      </Card>

      {event.description && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">About this event</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{event.description}</p>
        </Card>
      )}

      {event.client_facing_notes && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes from your coach</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{event.client_facing_notes}</p>
        </Card>
      )}

      {links.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event Links</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                 className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-secondary">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{l.title}</div>
                  <div className="text-xs text-muted-foreground">{l.link_type}</div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        </Card>
      )}

      {deadlines.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key deadlines</div>
          <ul className="mt-3 space-y-2">
            {deadlines.map((d) => (
              <li key={d.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{d.title}</div>
                    {d.notes && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{d.notes}</p>}
                  </div>
                  {d.due_date && (
                    <Badge variant="outline" className="shrink-0">
                      {format(parseISO(d.due_date), "MMM d, yyyy")}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reminders.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reminders</div>
          <ul className="mt-3 space-y-2 text-sm">
            {reminders.map((r) => {
              const meta = REMINDER_OFFSETS.find((o) => o.key === r.offset_key);
              return (
                <li key={r.id} className="flex items-start gap-3">
                  <Badge variant="secondary" className="shrink-0">{meta?.label}</Badge>
                  <span className="text-muted-foreground">{r.message || "—"}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
