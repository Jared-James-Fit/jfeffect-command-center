import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listCoachingApplications, updateCoachingApplication } from "@/lib/coaching-applications.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, Phone, ChevronDown, ChevronUp, Flame, Sparkles, Snowflake, CalendarCheck2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/sales/coaching-applications")({
  component: CoachingApplicationsRedirect,
});

function CoachingApplicationsRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    nav({ to: "/admin/forms", search: { tab: "coaching-applications" } as any, replace: true });
  }, [nav]);
  return null;
}

export function ApplicationsInbox({ embedded = false }: { embedded?: boolean } = {}) {
  const fetchList = useServerFn(listCoachingApplications);
  const updateApp = useServerFn(updateCoachingApplication);
  const { data, refetch } = useQuery({ queryKey: ["coaching-applications"], queryFn: () => fetchList(), refetchInterval: 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);

  const apps = data?.applications ?? [];

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader title="Coaching Applications" subtitle="Inbox of submissions from /coaching/apply." />
      )}
      <Card className="divide-y divide-border">
        {apps.length === 0 && <div className="p-6 text-sm text-muted-foreground">No applications yet.</div>}
        {apps.map((a: any) => {
          const open = openId === a.id;
          const qual = a.qualification_label as string | undefined;
          const temp = a.lead_temperature as "hot" | "warm" | "cold" | undefined;
          const TempIcon = temp === "hot" ? Flame : temp === "cold" ? Snowflake : Sparkles;
          const tempColor =
            temp === "hot" ? "text-orange-400" :
            temp === "cold" ? "text-sky-400" : "text-amber-400";
          const callStatus = (a.call_status as string | null) || "not_booked";
          return (
            <div key={a.id} className="p-4">
              <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex w-full items-center justify-between gap-3 text-left">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{a.full_name}</span>
                    <Badge variant="outline">{a.status}</Badge>
                    {qual && <Badge className="text-[10px]">{qual}</Badge>}
                    {callStatus === "booked" && (
                      <Badge variant="outline" className="text-[10px] text-emerald-400">
                        <CalendarCheck2 className="mr-1 h-2.5 w-2.5" /> Booked
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.email}{a.phone ? ` · ${a.phone}` : ""}
                    {a.main_goal ? ` · ${a.main_goal}` : ""}
                    {a.timeline ? ` · start ${String(a.timeline).replace(/_/g, " ")}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {typeof a.lead_score === "number" && (
                    <span className={`inline-flex items-center gap-1 font-bold ${tempColor}`}>
                      <TempIcon className="h-3 w-3" /> {a.lead_score}
                    </span>
                  )}
                  {new Date(a.created_at).toLocaleDateString()}
                  {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </div>
              </button>
              {open && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 text-sm">
                    <Detail label="Main goal" value={a.main_goal} />
                    <Detail label="Desired result" value={a.target_outcome} />
                    <Detail label="Why now" value={a.why_now} />
                    <Detail label="Obstacle" value={[a.obstacle, a.obstacle_other].filter(Boolean).join(" — ")} />
                    <Detail label="Training" value={[a.training_location, a.days_per_week ? `${a.days_per_week} days/wk` : null].filter(Boolean).join(" · ")} />
                    <Detail label="Coaching interest" value={a.coaching_interest} />
                    <Detail label="Readiness" value={a.readiness} />
                    <Detail label="Tracking" value={a.tracking_willingness} />
                    <Detail label="Investment" value={a.investment_readiness} />
                    <Detail label="Preferred contact" value={[a.preferred_contact, a.best_time].filter(Boolean).join(" · ")} />
                    {a.scoring && <ScoreBreakdown scoring={a.scoring} />}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <a href={`mailto:${a.email}`}><Button size="sm" variant="outline"><Mail className="mr-1 h-3 w-3" />Email</Button></a>
                      {a.phone && <a href={`sms:${a.phone}`}><Button size="sm" variant="outline"><Phone className="mr-1 h-3 w-3" />SMS</Button></a>}
                      {a.booking_link_slug && (
                        <a href={`/book/${a.booking_link_slug}?name=${encodeURIComponent(a.first_name ?? "")}&email=${encodeURIComponent(a.email)}&phone=${encodeURIComponent(a.phone ?? "")}&application_id=${a.id}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline"><CalendarCheck2 className="mr-1 h-3 w-3" />Book for lead</Button>
                        </a>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</div>
                      <Select value={a.status} onValueChange={async (v) => {
                        try { await updateApp({ data: { id: a.id, status: v as any } }); toast.success("Updated"); refetch(); }
                        catch (e: any) { toast.error(e?.message ?? "Failed"); }
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="New">New</SelectItem>
                          <SelectItem value="Needs Review">Needs Review</SelectItem>
                          <SelectItem value="Contacted">Contacted</SelectItem>
                          <SelectItem value="Approved">Approved</SelectItem>
                          <SelectItem value="Rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Call status</div>
                      <Select value={callStatus} onValueChange={async (v) => {
                        try { await updateApp({ data: { id: a.id, call_status: v as any } }); toast.success("Updated"); refetch(); }
                        catch (e: any) { toast.error(e?.message ?? "Failed"); }
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_offered">Not offered</SelectItem>
                          <SelectItem value="booking_available">Booking available</SelectItem>
                          <SelectItem value="not_booked">Not booked</SelectItem>
                          <SelectItem value="booked">Booked</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="rescheduled">Rescheduled</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                          <SelectItem value="no_show">No show</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Admin notes</div>
                      <Textarea
                        rows={3} defaultValue={a.notes_admin ?? ""}
                        onBlur={async (e) => {
                          if (e.target.value === (a.notes_admin ?? "")) return;
                          try { await updateApp({ data: { id: a.id, notes_admin: e.target.value } }); toast.success("Notes saved"); refetch(); }
                          catch (er: any) { toast.error(er?.message ?? "Failed"); }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="whitespace-pre-line">{value}</div>
    </div>
  );
}

function ScoreBreakdown({ scoring }: { scoring: any }) {
  if (!scoring || !scoring.breakdown) return null;
  const entries = Object.entries(scoring.breakdown as Record<string, { score: number; max: number; reason: string }>);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Score breakdown ({scoring.total ?? 0}/100)
      </div>
      <ul className="space-y-1">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-baseline justify-between gap-2">
            <span className="capitalize">{k.replace(/_/g, " ")}</span>
            <span className="text-muted-foreground">
              <span className="font-mono font-bold text-foreground">{v.score}</span>/{v.max} · {v.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}