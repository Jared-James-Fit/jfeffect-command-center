import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  listCoachingAppRecipients, upsertCoachingAppRecipient,
  deleteCoachingAppRecipient, sendCoachingAppRecipientTestSms,
} from "@/lib/coaching-app-recipients.functions";
import { toast } from "sonner";
import { Plus, Send, Pencil, Trash2, CheckCircle2, Pause } from "lucide-react";

export const Route = createFileRoute(
  "/_authenticated/admin/settings_/notifications/coaching-applications",
)({ component: CoachingAppNotificationsSettings });

type RecipientRow = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  receive_application_sms: boolean;
  receive_booking_sms: boolean;
  receive_application_email: boolean;
  receive_booking_email: boolean;
  priority_only: boolean;
  paused: boolean;
  phone_verified_at: string | null;
  email_verified_at: string | null;
};

const BLANK: Partial<RecipientRow> = {
  name: "", role: "", phone: "", email: "",
  receive_application_sms: true, receive_booking_sms: true,
  receive_application_email: false, receive_booking_email: false,
  priority_only: false, paused: false,
};

function CoachingAppNotificationsSettings() {
  const listFn = useServerFn(listCoachingAppRecipients);
  const upsertFn = useServerFn(upsertCoachingAppRecipient);
  const delFn = useServerFn(deleteCoachingAppRecipient);
  const testFn = useServerFn(sendCoachingAppRecipientTestSms);

  const { data, refetch, isPending } = useQuery({
    queryKey: ["coaching-app-recipients"],
    queryFn: () => listFn(),
  });
  const [editing, setEditing] = useState<Partial<RecipientRow> | null>(null);

  const recipients = (data?.recipients ?? []) as RecipientRow[];

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error("Name required"); return; }
    try {
      await upsertFn({ data: editing as any });
      toast.success("Saved");
      setEditing(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  }
  async function remove(id: string) {
    if (!confirm("Remove this recipient?")) return;
    try {
      await delFn({ data: { id } });
      toast.success("Removed");
      refetch();
    } catch (e: any) { toast.error(e?.message ?? "Failed to remove"); }
  }
  async function sendTest(id: string) {
    try {
      const r = await testFn({ data: { id } });
      toast.success(`Test SMS sent (${r.sid?.slice(0, 8)}…)`);
      refetch();
    } catch (e: any) { toast.error(e?.message ?? "Test send failed"); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Coaching Application Notifications"
        subtitle="Who gets SMS and email when a new application is submitted or a coaching call is booked."
      />

      <Card className="p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {isPending ? "Loading…" : `${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}
          </div>
          <Button size="sm" onClick={() => setEditing({ ...BLANK })}>
            <Plus className="mr-1 h-3 w-3" /> Add recipient
          </Button>
        </div>

        <div className="divide-y divide-border">
          {recipients.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {r.role && <Badge variant="outline" className="text-[10px]">{r.role}</Badge>}
                  {r.paused && <Badge variant="secondary" className="text-[10px]"><Pause className="mr-1 h-2.5 w-2.5" /> Paused</Badge>}
                  {r.priority_only && <Badge className="text-[10px]">Priority only</Badge>}
                  {r.phone_verified_at && <Badge variant="outline" className="text-[10px] text-emerald-400"><CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Phone verified</Badge>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.phone || "no phone"}{r.email ? ` · ${r.email}` : ""}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {r.receive_application_sms && <span>App SMS</span>}
                  {r.receive_booking_sms && <span>Booking SMS</span>}
                  {r.receive_application_email && <span>App Email</span>}
                  {r.receive_booking_email && <span>Booking Email</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => sendTest(r.id)} disabled={!r.phone}>
                  <Send className="mr-1 h-3 w-3" /> Test SMS
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  <Pencil className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {!isPending && recipients.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No recipients yet. Add one to start receiving alerts.
            </div>
          )}
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit recipient" : "Add recipient"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Field label="Name">
                <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Role">
                <Input value={editing.role ?? ""} placeholder="e.g. Owner, Team Member"
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
              </Field>
              <Field label="Phone (E.164)">
                <Input type="tel" placeholder="+13435714378" value={editing.phone ?? ""}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={editing.email ?? ""}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </Field>

              <div className="pt-1">
                <Toggle label="New application SMS"
                  v={!!editing.receive_application_sms}
                  on={(v) => setEditing({ ...editing, receive_application_sms: v })} />
                <Toggle label="Call booked SMS"
                  v={!!editing.receive_booking_sms}
                  on={(v) => setEditing({ ...editing, receive_booking_sms: v })} />
                <Toggle label="New application Email"
                  v={!!editing.receive_application_email}
                  on={(v) => setEditing({ ...editing, receive_application_email: v })} />
                <Toggle label="Call booked Email"
                  v={!!editing.receive_booking_email}
                  on={(v) => setEditing({ ...editing, receive_booking_email: v })} />
                <Toggle label="Priority leads only (Priority Lead score)"
                  v={!!editing.priority_only}
                  on={(v) => setEditing({ ...editing, priority_only: v })} />
                <Toggle label="Paused"
                  v={!!editing.paused}
                  on={(v) => setEditing({ ...editing, paused: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2 text-sm">
      <span>{label}</span>
      <Switch checked={v} onCheckedChange={on} />
    </label>
  );
}
