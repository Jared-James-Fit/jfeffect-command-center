import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAppointments, listMyPortalAppointments } from "@/lib/appointments.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Video, ArrowRight } from "lucide-react";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tom = new Date(now); tom.setDate(tom.getDate() + 1);
  const isTom = d.toDateString() === tom.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  if (isTom) return `Tomorrow · ${time}`;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function UpcomingAppointmentsCard({ mode, limit = 5 }: { mode: "admin" | "portal"; limit?: number }) {
  const adminFn = useServerFn(listAppointments);
  const portalFn = useServerFn(listMyPortalAppointments);
  const { data, isLoading } = useQuery({
    queryKey: ["upcoming-appts-card", mode],
    queryFn: async () => {
      if (mode === "admin") {
        const rows: any[] = await adminFn({ data: { range: "upcoming" } as any });
        return rows.slice(0, limit);
      }
      const { upcoming } = await portalFn();
      return (upcoming ?? []).slice(0, limit);
    },
  });
  const rows = data ?? [];

  return (
    <Card className="border-border bg-card p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
          <CalendarIcon className="h-4 w-4 text-primary" /> Upcoming Appointments
        </h2>
        <Link to={mode === "admin" ? "/admin/calendar" : "/portal/appointments"} search={mode === "admin" ? ({ tab: "upcoming" } as any) : undefined}>
          <Button size="sm" variant="ghost" className="h-7 text-xs">View all <ArrowRight className="ml-1 h-3 w-3" /></Button>
        </Link>
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No upcoming appointments.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a: any) => {
            const who = mode === "admin" ? (a.client?.full_name || a.external_name || "—") : (a.host_coach?.full_name ?? "Your coach");
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className="text-[10px]">{a.appointment_type}</Badge>
                    <span className="text-[11px] text-muted-foreground">{fmtWhen(a.starts_at)}</span>
                  </div>
                  <div className="text-sm font-semibold truncate">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{mode === "admin" ? `With ${who}` : `With ${who}`}</div>
                </div>
                {a.meet_link && (
                  <a href={a.meet_link} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="h-7 text-xs"><Video className="mr-1 h-3 w-3" /> Join</Button>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}