import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, FileText, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { assignAgreement } from "@/lib/agreements.functions";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";

export function AgreementsPanel({ clientId, purchaseRecordId }: { clientId: string; purchaseRecordId?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [payor, setPayor] = useState(false);
  const [minor, setMinor] = useState(false);
  const [loading, setLoading] = useState(false);
  const assign = useServerFn(assignAgreement);

  const { data: agreements = [] } = useQuery({
    queryKey: ["client-agreements", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*").eq("client_id", clientId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_templates")
        .select("id, name").eq("archived", false).order("name");
      if (error) throw error;
      return data;
    },
  });

  async function handleAssign() {
    if (!templateId) return;
    setLoading(true);
    try {
      await assign({ data: {
        client_id: clientId, template_id: templateId,
        payor_required: payor, minor_required: minor, send_now: sendNow,
        purchase_record_id: purchaseRecordId,
      }});
      toast.success(sendNow ? "Agreement sent" : "Agreement created");
      qc.invalidateQueries({ queryKey: ["client-agreements", clientId] });
      setOpen(false); setTemplateId("");
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Agreements</h3>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3 w-3 mr-1" /> Assign agreement</Button>
      </div>
      {agreements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agreements assigned.</p>
      ) : (
        <ul className="divide-y">
          {agreements.map((a: any) => (
            <li key={a.id} className="py-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{a.template_name}</p>
                <p className="text-xs text-muted-foreground">
                  v{a.template_version}{a.sent_at ? ` · Sent ${new Date(a.sent_at).toLocaleDateString()}` : ""}
                  {a.completed_at ? ` · Signed ${new Date(a.completed_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <AgreementStatusBadge status={a.status} />
              <Link to="/admin/agreements/instance/$id" params={{ id: a.id }}>
                <Button size="icon" variant="ghost"><ExternalLink className="h-4 w-4" /></Button>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign agreement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Someone else is paying (payor)</Label>
              <Switch checked={payor} onCheckedChange={setPayor} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Client is a minor (parent/guardian)</Label>
              <Switch checked={minor} onCheckedChange={setMinor} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Send to client immediately</Label>
              <Switch checked={sendNow} onCheckedChange={setSendNow} />
            </div>
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground">No templates available. <Link to="/admin/agreements" className="underline">Create one</Link>.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={loading || !templateId}>
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {sendNow ? "Assign & send" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}