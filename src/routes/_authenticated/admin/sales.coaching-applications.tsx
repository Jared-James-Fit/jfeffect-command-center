import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listCoachingApplications, updateCoachingApplication, exportCoachingApplicationsCsv } from "@/lib/coaching-applications.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, Phone, ChevronDown, ChevronUp, CalendarCheck2, MessageSquare, Instagram, UserRound, Star, FlaskConical } from "lucide-react";
import { displaySource } from "@/lib/application-attribution";
import { toLeadScore5, leadScoreReason, LEAD_SCORE_DISCLAIMER } from "@/lib/lead-score-display";

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
  const exportCsv = useServerFn(exportCoachingApplicationsCsv);
  const { data, refetch } = useQuery({ queryKey: ["coaching-applications"], queryFn: () => fetchList(), refetchInterval: 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);

  const apps = data?.applications ?? [];

  const downloadCsv = async () => {
    try {
      const { csv, count } = await exportCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coaching-applications-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${count} applications`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader title="Coaching Applications" subtitle="Inbox of submissions from /coaching/apply." />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {apps.length} application{apps.length === 1 ? "" : "s"}
        </div>
        <Button size="sm" variant="outline" onClick={downloadCsv} disabled={apps.length === 0}>
          Export CSV
        </Button>
      </div>
      <Card className="divide-y divide-border">
        {apps.length === 0 && <div className="p-6 text-sm text-muted-foreground">No applications yet.</div>}
        {apps.map((a: any) => {
          const open = openId === a.id;
          const callStatus = (a.call_status as string | null) || "not_booked";
          const score5 = toLeadScore5(a.lead_score);
          const source = displaySource(a);
          const service = a.coaching_interest || a.main_goal || null;
          const igHandle = a.instagram ? String(a.instagram).replace(/^@/, "") : null;
          const submitted = new Date(a.created_at).toLocaleString(undefined, {
            dateStyle: "medium", timeStyle: "short",
          });
          return (
            <div key={a.id} className="p-4">
              <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex w-full items-start justify-between gap-3 text-left">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{a.full_name}</span>
                    <Badge variant="outline">{a.status}</Badge>
                    {a.is_test && (
                      <Badge variant="secondary" className="text-[10px]">
                        <FlaskConical className="mr-1 h-2.5 w-2.5" /> Test
                      </Badge>
                    )}
                    {callStatus === "booked" && (
                      <Badge variant="outline" className="text-[10px] text-emerald-400">
                        <CalendarCheck2 className="mr-1 h-2.5 w-2.5" /> Booked
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {a.email}{a.phone ? ` · ${a.phone}` : ""}{igHandle ? ` · @${igHandle}` : ""}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Source: <span className="text-foreground/80">{source}</span> · {submitted}
                    {service ? ` · ${humanize(service)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {score5 !== null && (
                    <span className="inline-flex items-center gap-1 font-bold text-amber-400" title={LEAD_SCORE_DISCLAIMER}>
                      <Star className="h-3 w-3" /> {score5}/5
                    </span>
                  )}
                  {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </div>
              </button>
              {open && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-4 text-sm">
                    <Section title="Submission">
                      <Field label="Source" value={source} />
                      <Field label="Form" value={a.form_name || "Unknown"} />
                      <Field label="Page" value={a.page_path || a.page_url || "Unknown"} />
                      <Field label="Referrer" value={a.referrer || "Unknown"} />
                      <Field label="Campaign" value={[a.utm_source, a.utm_medium, a.utm_campaign].filter(Boolean).join(" / ") || "Unknown"} />
                      <Field label="Submitted" value={submitted} />
                    </Section>
                    <ApplicationSections app={a} />
                    <LeadScoreCard score={a.lead_score} scoring={a.scoring} />
                    {a.scoring && <ScoreBreakdown scoring={a.scoring} />}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <a href={`mailto:${a.email}`}><Button size="sm" variant="outline"><Mail className="mr-1 h-3 w-3" />Email</Button></a>
                      {a.phone && <a href={`tel:${a.phone}`}><Button size="sm" variant="outline"><Phone className="mr-1 h-3 w-3" />Call</Button></a>}
                      {a.phone && <a href={`sms:${a.phone}`}><Button size="sm" variant="outline"><MessageSquare className="mr-1 h-3 w-3" />Message</Button></a>}
                      {igHandle && (
                        <a href={`https://instagram.com/${encodeURIComponent(igHandle)}`} target="_blank" rel="noreferrer noopener">
                          <Button size="sm" variant="outline"><Instagram className="mr-1 h-3 w-3" />Instagram</Button>
                        </a>
                      )}
                      {a.client_id && (
                        <a href={`/admin/clients/${a.client_id}`}>
                          <Button size="sm" variant="outline"><UserRound className="mr-1 h-3 w-3" />CRM record</Button>
                        </a>
                      )}
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
                    <Button
                      size="sm" variant={a.is_test ? "secondary" : "ghost"}
                      onClick={async () => {
                        try {
                          await updateApp({ data: { id: a.id, is_test: !a.is_test } as any });
                          toast.success(a.is_test ? "Unmarked as test" : "Marked as test — excluded from lead metrics");
                          refetch();
                        } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                      }}
                    >
                      <FlaskConical className="mr-1 h-3 w-3" />
                      {a.is_test ? "Unmark test" : "Mark as test"}
                    </Button>
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

function humanize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(humanize).filter(Boolean).join(", ");
  const s = String(v).trim();
  if (!s) return "";
  // Special-case common enum values for clarity.
  const map: Record<string, string> = {
    help_me_choose: "Help me choose",
    explain_options: "Explain pricing options",
    fully_ready: "Fully ready",
    ready_soon: "Ready soon",
    not_ready: "Not ready yet",
    full_gym: "Full gym",
    home_gym: "Home gym",
    commercial_gym: "Commercial gym",
    garage_gym: "Garage gym",
    limited_equipment: "Limited equipment",
  };
  if (map[s]) return map[s];
  // "4_days_week" → "4 days/week"
  const daysMatch = s.match(/^(\d+)[_\s-]*days?[_\s-]*(week|wk)$/i);
  if (daysMatch) return `${daysMatch[1]} days/week`;
  // Generic: snake/kebab → Sentence case
  const cleaned = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function Field({ label, value }: { label: string; value?: unknown }) {
  const display = humanize(value);
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      {display ? (
        <div className="whitespace-pre-line text-foreground">{display}</div>
      ) : (
        <div className="italic text-muted-foreground/70">— Not answered</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function ApplicationSections({ app: a }: { app: any }) {
  const obstacle = [a.obstacle, a.obstacle_other].filter(Boolean).map(humanize).join(" — ");
  const training = [
    a.training_location ? humanize(a.training_location) : null,
    a.days_per_week ? `${a.days_per_week} days/week` : null,
  ].filter(Boolean).join("\n");
  const contact = [
    a.preferred_contact ? humanize(a.preferred_contact) : null,
    a.best_time ? humanize(a.best_time) : null,
  ].filter(Boolean).join("\n");
  return (
    <>
      <Section title="Goals">
        <Field label="Main goal" value={a.main_goal} />
        <Field label="Desired result" value={a.target_outcome} />
        <Field label="Why now" value={a.why_now} />
        <Field label="Biggest obstacle" value={obstacle} />
        <Field label="90-day win" value={a.win_90_days} />
      </Section>
      <Section title="Training">
        <Field label="Current training" value={training} />
        <Field label="Gym access" value={a.gym_access} />
        <Field label="Training history" value={a.training_history} />
        <Field label="Current bodyweight" value={a.current_weight} />
        <Field label="Injuries" value={a.injuries} />
        <Field label="Tried before" value={a.tried_before} />
      </Section>
      <Section title="Coaching">
        <Field label="Coaching interest" value={a.coaching_interest} />
        <Field label="Readiness" value={a.readiness} />
        <Field label="Tracking" value={a.tracking_willingness} />
        <Field label="Investment" value={a.investment_readiness} />
        <Field label="Monthly investment" value={a.monthly_investment} />
        <Field label="Timeline to start" value={a.timeline} />
      </Section>
      <Section title="Contact">
        <Field label="Preferred contact" value={contact} />
        <Field label="Email" value={a.email} />
        <Field label="Phone" value={a.phone} />
        <Field label="Instagram" value={a.instagram} />
        <Field label="Timezone" value={a.location_timezone} />
      </Section>
    </>
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
function LeadScoreCard({ score, scoring }: { score: unknown; scoring: unknown }) {
  const score5 = toLeadScore5(score);
  if (score5 === null) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Lead Score</span>
        <span className="inline-flex items-center gap-1 font-bold text-amber-400">
          <Star className="h-3 w-3" /> {score5}/5
        </span>
      </div>
      <div className="text-foreground/80">{leadScoreReason(scoring)}</div>
      <div className="mt-1 italic text-muted-foreground">{LEAD_SCORE_DISCLAIMER}</div>
    </div>
  );
}
