import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getCrmContact, updateCrmContact, addCrmNote, convertCrmContact, listCoachOptions,
} from "@/lib/crm.functions";

export const Route = createFileRoute("/_authenticated/admin/crm/contacts/$id")({
  component: ContactProfile,
});

const STAGES = ["lead","applicant","call_booked","qualified","follow_up","won","paused","lost","disqualified"];

function ContactProfile() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchContact = useServerFn(getCrmContact);
  const fetchCoaches = useServerFn(listCoachOptions);
  const update = useServerFn(updateCrmContact);
  const addNote = useServerFn(addCrmNote);
  const convert = useServerFn(convertCrmContact);

  const { data, isLoading } = useQuery({
    queryKey: ["crm","contact", id],
    queryFn: () => fetchContact({ data: { id } }),
  });
  const { data: coachData } = useQuery({ queryKey: ["crm","coaches"], queryFn: () => fetchCoaches() });

  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const c = data.contact;
  const isActive = c.lifecycle_stage === "active_client";

  async function patch(p: any) {
    try {
      await update({ data: { id, ...p } });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["crm"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function doConvert() {
    try {
      await convert({ data: { id } });
      toast.success("Converted to active client");
      qc.invalidateQueries({ queryKey: ["crm"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.full_name || c.email}
        subtitle={c.email + (c.phone ? ` · ${c.phone}` : "")}
        actions={
          <div className="flex flex-wrap gap-2">
            {isActive ? (
              <Link to="/admin/clients/$id" params={{ id }}>
                <Button size="sm" variant="outline">Open coaching profile</Button>
              </Link>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm">Convert to active client</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Convert to active client?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <div><strong>Contact:</strong> {c.full_name || c.email}</div>
                      <div><strong>Current stage:</strong> {c.lifecycle_stage ?? "—"}</div>
                      <div><strong>Has login:</strong> {c.user_id ? "Yes" : "No"}</div>
                      <div><strong>Assigned coach:</strong> {c.coaches?.full_name ?? "—"}</div>
                      <div className="rounded bg-amber-500/10 p-2 text-xs text-amber-600">
                        This moves the contact into active-client reporting. Application and activity history are preserved. No program is auto-assigned.
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={doConvert}>Convert</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="applications">Applications ({data.applications.length})</TabsTrigger>
          <TabsTrigger value="appointments">Appointments ({data.appointments.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity ({data.activities.length})</TabsTrigger>
          <TabsTrigger value="coaching">Coaching</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="space-y-3 p-4 lg:col-span-2">
              <SectionTitle>Contact</SectionTitle>
              <Field label="Email" value={c.email} />
              <Field label="Phone" value={c.phone} />
              <Field label="Instagram" value={c.instagram} />
              <Field label="Source" value={c.source} />
              <Field label="Recommended offer" value={c.recommended_offer} />
              <Field label="Score" value={c.lead_score != null ? String(c.lead_score) : null} />
            </Card>
            <Card className="space-y-3 p-4">
              <SectionTitle>Pipeline</SectionTitle>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lifecycle stage</label>
                <Select value={c.lifecycle_stage ?? "_unset"} onValueChange={(v) => patch({ lifecycle_stage: v === "_unset" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}
                    {isActive && <SelectItem value="active_client" disabled>active client</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Temperature</label>
                <Select value={c.lead_temperature ?? "_unset"} onValueChange={(v) => patch({ lead_temperature: v === "_unset" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hot">Hot</SelectItem>
                    <SelectItem value="warm">Warm</SelectItem>
                    <SelectItem value="cold">Cold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Assigned coach</label>
                <Select value={c.assigned_coach_id ?? "_unset"} onValueChange={(v) => patch({ assigned_coach_id: v === "_unset" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_unset">Unassigned</SelectItem>
                    {(coachData?.coaches ?? []).map((co: any) => <SelectItem key={co.id} value={co.id}>{co.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Next follow-up</label>
                <div className="flex gap-2">
                  <Input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => patch({ next_follow_up_at: followUp ? new Date(followUp).toISOString() : null })}>Save</Button>
                </div>
                {c.next_follow_up_at && <div className="text-xs text-muted-foreground">Current: {format(new Date(c.next_follow_up_at), "PP p")}</div>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => patch({ lifecycle_stage: "qualified" })}>Mark qualified</Button>
                <Button size="sm" variant="outline" onClick={() => patch({ call_booked: true, lifecycle_stage: "call_booked" })}>Call booked</Button>
                <Button size="sm" variant="outline" onClick={() => patch({ lifecycle_stage: "lost" })}>Mark lost</Button>
              </div>
            </Card>
          </div>

          <Card className="space-y-2 p-4">
            <SectionTitle>Add note</SectionTitle>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" />
            <div className="flex justify-end">
              <Button size="sm" disabled={!note.trim()} onClick={async () => {
                try { await addNote({ data: { id, note } }); toast.success("Note added"); setNote(""); qc.invalidateQueries({ queryKey: ["crm","contact", id] }); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}>Save note</Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="applications">
          <Card className="divide-y divide-border">
            {data.applications.length === 0 && <Empty>No applications.</Empty>}
            {data.applications.map((a: any) => (
              <div key={a.id} className="p-4 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline">{a.application_status ?? a.status}</Badge>
                  <Badge variant="outline" className="capitalize">{a.lead_temperature ?? "—"}</Badge>
                  <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), "PP p")}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Score {a.lead_score ?? "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground">Recommended: {a.recommended_offer ?? "—"}</div>
                {a.summary && <div className="mt-1 text-xs">{a.summary}</div>}
                {a.main_goal && <Detail label="Goal" value={a.main_goal} />}
                {a.why_now && <Detail label="Why now" value={a.why_now} />}
                {a.target_outcome && <Detail label="Target outcome" value={a.target_outcome} />}
                {a.timeline && <Detail label="Timeline" value={a.timeline} />}
                {a.monthly_investment && <Detail label="Budget" value={a.monthly_investment} />}
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="appointments">
          <Card className="divide-y divide-border">
            {data.appointments.length === 0 && <Empty>No appointments yet.</Empty>}
            {data.appointments.map((ap: any) => (
              <div key={ap.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div className="font-medium">{ap.title ?? ap.appointment_type ?? "Appointment"}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(ap.starts_at), "PP p")} — {ap.status}</div>
                  {ap.google_event_id && <div className="text-[10px] text-muted-foreground">GCal event: {ap.google_event_id}</div>}
                </div>
                {ap.meet_link && <a href={ap.meet_link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Meet</Button></a>}
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="divide-y divide-border">
            {data.activities.length === 0 && <Empty>No activity yet.</Empty>}
            {data.activities.map((act: any) => (
              <div key={act.id} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{act.title ?? act.activity_type}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(act.created_at), "PP p")}</div>
                </div>
                {act.details && <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(act.details, null, 2)}</pre>}
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="coaching">
          <Card className="space-y-3 p-4 text-sm">
            <Field label="Lifecycle" value={c.lifecycle_stage} />
            <Field label="Has login" value={c.user_id ? "Yes" : "No"} />
            <Field label="Status" value={c.status} />
            <Field label="Assigned coach" value={c.coaches?.full_name ?? null} />
            <Field label="Converted at" value={c.converted_to_client_at ? format(new Date(c.converted_to_client_at), "PP") : null} />
            {isActive && (
              <Link to="/admin/clients/$id" params={{ id }}>
                <Button variant="outline" size="sm">Open coaching profile →</Button>
              </Link>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionTitle({ children }: any) { return <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</div>; }
function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span>{value ?? "—"}</span>
    </div>
  );
}
function Detail({ label, value }: any) {
  return (
    <div className="mt-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label} </span>
      <span className="text-xs">{value}</span>
    </div>
  );
}
function Empty({ children }: any) { return <div className="p-6 text-center text-sm text-muted-foreground">{children}</div>; }