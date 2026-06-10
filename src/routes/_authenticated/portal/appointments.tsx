import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyPortalAppointments } from "@/lib/appointments.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Video, MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/appointments")({ component: PortalAppointments });

function PortalAppointments() {
  const fn = useServerFn(listMyPortalAppointments);
  const { data, isLoading } = useQuery({ queryKey: ["portal-appointments"], queryFn: () => fn() });

  return (
    <>
      <PageHeader title="Appointments" subtitle="Your upcoming calls and sessions." />
      <div className="p-6 md:p-8 space-y-6">
        <Section title="Upcoming" rows={data?.upcoming ?? []} isLoading={isLoading} />
        <Section title="Past" rows={data?.past ?? []} isLoading={isLoading} />
      </div>
    </>
  );
}

function Section({ title, rows, isLoading }: any) {
  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</h2>
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground border-border bg-card">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-border bg-card">
          <CalendarIcon className="mx-auto mb-2 h-5 w-5" /> No {title.toLowerCase()} appointments.
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((a: any) => {
            const when = new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <Card key={a.id} className="border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">{a.appointment_type}</Badge>
                      <Badge variant="outline">{a.status}</Badge>
                    </div>
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {when} · with {a.host_coach?.full_name ?? "your coach"}
                    </div>
                    {a.location && <div className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.location}</div>}
                    {a.attendee_notes && <div className="text-xs text-muted-foreground mt-2">{a.attendee_notes}</div>}
                  </div>
                  {a.meet_link && (
                    <a href={a.meet_link} target="_blank" rel="noreferrer">
                      <Button size="sm" className="bg-gradient-primary"><Video className="mr-2 h-3 w-3" /> Join Meet</Button>
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}