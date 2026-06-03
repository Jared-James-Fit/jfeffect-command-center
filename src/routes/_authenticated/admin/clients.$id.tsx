import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  component: ClientDetail,
});

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Archived", "High Priority"];
const PAY_STATUSES = ["Not Sent", "Sent", "Paid", "Failed", "Overdue", "Cancelled", "Refunded"];

function ClientDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<any>(null);

  const { data } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  if (!form) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const save = async () => {
    const { id: _id, created_at, updated_at, ...patch } = form;
    const { error } = await supabase.from("clients").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["client", id] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const archive = async () => {
    const { error } = await supabase.from("clients").update({ archived: !form.archived, status: !form.archived ? "Archived" : "Active" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(form.archived ? "Restored" : "Archived");
    navigate({ to: "/admin/clients" });
  };

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const links = [
    ["Program Sheet", form.program_sheet_link],
    ["Drive Folder", form.drive_folder_link],
    ["Check-In Form", form.checkin_form_link],
    ["Agreement", form.agreement_link],
    ["Calendar", form.calendar_link],
    ["Stripe", form.stripe_link],
  ] as const;

  return (
    <>
      <PageHeader
        title={form.full_name}
        subtitle={form.coaching_type ?? "Coaching client"}
        actions={
          <>
            <Link to="/admin/clients"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
            <Button variant="outline" size="sm" onClick={archive}><Trash2 className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</Button>
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save</Button>
          </>
        }
      />
      <div className="grid gap-6 p-6 md:grid-cols-3 md:p-8">
        <Card className="border-border bg-card p-6 md:col-span-2 space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Full name</Label><Input value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></div>
            <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
            <div><Label>Instagram</Label><Input value={form.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} /></div>
            <div><Label>Start date</Label><Input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></div>
            <div><Label>Renewal date</Label><Input type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", e.target.value || null)} /></div>
            <div><Label>Coaching package</Label><Input value={form.coaching_package ?? ""} onChange={(e) => set("coaching_package", e.target.value)} /></div>
            <div><Label>Program phase</Label><Input value={form.program_phase ?? ""} onChange={(e) => set("program_phase", e.target.value)} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment status</Label>
              <Select value={form.payment_status ?? "Not Sent"} onValueChange={(v) => set("payment_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="border-border bg-card p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Linked Resources</h3>
          <div className="space-y-3">
            <div><Label>Program sheet</Label><Input value={form.program_sheet_link ?? ""} onChange={(e) => set("program_sheet_link", e.target.value)} placeholder="https://sheets.google.com/…" /></div>
            <div><Label>Drive folder</Label><Input value={form.drive_folder_link ?? ""} onChange={(e) => set("drive_folder_link", e.target.value)} /></div>
            <div><Label>Check-in form</Label><Input value={form.checkin_form_link ?? ""} onChange={(e) => set("checkin_form_link", e.target.value)} /></div>
            <div><Label>Agreement</Label><Input value={form.agreement_link ?? ""} onChange={(e) => set("agreement_link", e.target.value)} /></div>
            <div><Label>Calendar / booking link</Label><Input value={form.calendar_link ?? ""} onChange={(e) => set("calendar_link", e.target.value)} /></div>
            <div><Label>Stripe payment link</Label><Input value={form.stripe_link ?? ""} onChange={(e) => set("stripe_link", e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {links.filter(([, v]) => v).map(([n, v]) => (
              <a key={n} href={v as string} target="_blank" rel="noreferrer">
                <Badge variant="outline" className="cursor-pointer hover:border-primary">{n} <ExternalLink className="ml-1 h-3 w-3" /></Badge>
              </a>
            ))}
          </div>
        </Card>

        <Card className="border-border bg-card p-6 md:col-span-2 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Coaching Notes</h3>
          <div><Label>Goals</Label><Textarea rows={2} value={form.goals ?? ""} onChange={(e) => set("goals", e.target.value)} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Injuries / limitations</Label><Textarea rows={3} value={form.injuries ?? ""} onChange={(e) => set("injuries", e.target.value)} /></div>
            <div><Label>Training notes</Label><Textarea rows={3} value={form.training_notes ?? ""} onChange={(e) => set("training_notes", e.target.value)} /></div>
            <div><Label>Nutrition notes</Label><Textarea rows={3} value={form.nutrition_notes ?? ""} onChange={(e) => set("nutrition_notes", e.target.value)} /></div>
            <div><Label>Lifestyle notes</Label><Textarea rows={3} value={form.lifestyle_notes ?? ""} onChange={(e) => set("lifestyle_notes", e.target.value)} /></div>
          </div>
        </Card>

        <Card className="border-primary/30 bg-primary/5 p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-primary">Private Coach Notes</h3>
          <p className="text-xs text-muted-foreground">Only visible to admin.</p>
          <Textarea rows={10} value={form.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} placeholder="Internal notes the client never sees…" />
        </Card>
      </div>
    </>
  );
}