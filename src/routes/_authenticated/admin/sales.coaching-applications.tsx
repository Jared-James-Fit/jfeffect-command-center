import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listCoachingApplications, updateCoachingApplication } from "@/lib/coaching-applications.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, Phone, ChevronDown, ChevronUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/sales/coaching-applications")({
  component: ApplicationsInbox,
});

function ApplicationsInbox() {
  const fetchList = useServerFn(listCoachingApplications);
  const updateApp = useServerFn(updateCoachingApplication);
  const { data, refetch } = useQuery({ queryKey: ["coaching-applications"], queryFn: () => fetchList(), refetchInterval: 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);

  const apps = data?.applications ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Coaching Applications" subtitle="Inbox of submissions from /coaching/apply." />
      <Card className="divide-y divide-border">
        {apps.length === 0 && <div className="p-6 text-sm text-muted-foreground">No applications yet.</div>}
        {apps.map((a: any) => {
          const open = openId === a.id;
          return (
            <div key={a.id} className="p-4">
              <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex w-full items-center justify-between gap-3 text-left">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{a.full_name}</span>
                    <Badge variant="outline">{a.status}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{a.email}{a.phone ? ` · ${a.phone}` : ""}</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString()}
                  {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </div>
              </button>
              {open && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 text-sm">
                    <Detail label="Goals" value={a.goals} />
                    <Detail label="Training history" value={a.training_history} />
                    <Detail label="Schedule" value={a.schedule} />
                    <Detail label="Budget" value={a.budget_range} />
                    <Detail label="Timeline" value={a.timeline} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <a href={`mailto:${a.email}`}><Button size="sm" variant="outline"><Mail className="mr-1 h-3 w-3" />Email</Button></a>
                      {a.phone && <a href={`sms:${a.phone}`}><Button size="sm" variant="outline"><Phone className="mr-1 h-3 w-3" />SMS</Button></a>}
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
                          <SelectItem value="Contacted">Contacted</SelectItem>
                          <SelectItem value="Approved">Approved</SelectItem>
                          <SelectItem value="Rejected">Rejected</SelectItem>
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