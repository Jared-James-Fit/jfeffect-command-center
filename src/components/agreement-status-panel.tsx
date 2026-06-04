import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileSignature, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AGREEMENT_STATUSES } from "@/lib/offers";

export function AgreementStatusPanel({ client }: { client: any }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    setF({
      agreement_signed: !!client.agreement_signed,
      agreement_signed_date: client.agreement_signed_date ?? "",
      agreement_version: client.agreement_version ?? "",
      agreement_status: client.agreement_status ?? "Not Sent",
      agreement_link: client.agreement_link ?? "",
      agreement_signature_platform_link: client.agreement_signature_platform_link ?? "",
    });
  }, [client]);

  const save = async () => {
    const patch: any = { ...f };
    if (patch.agreement_signed && !patch.agreement_status) patch.agreement_status = "Signed";
    Object.keys(patch).forEach((k) => { if (patch[k] === "") patch[k] = null; });
    const { error } = await supabase.from("clients").update(patch).eq("id", client.id);
    if (error) return toast.error(error.message);
    toast.success("Agreement status saved");
    qc.invalidateQueries({ queryKey: ["client", client.id] });
  };

  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <FileSignature className="h-4 w-4" /> Coaching Agreement Status
        </h3>
        <Badge variant="outline" className={f.agreement_signed ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}>
          {f.agreement_signed ? "Signed" : "Not on file"}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={!!f.agreement_signed} onCheckedChange={(v) => setF({ ...f, agreement_signed: v, agreement_status: v ? "Signed" : f.agreement_status })} />
        <Label>Coaching Agreement signed</Label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>Signed date</Label><Input type="date" value={f.agreement_signed_date ?? ""} onChange={(e) => setF({ ...f, agreement_signed_date: e.target.value })} /></div>
        <div><Label>Agreement version</Label><Input value={f.agreement_version ?? ""} onChange={(e) => setF({ ...f, agreement_version: e.target.value })} placeholder="e.g. v3 - 2026" /></div>
        <div>
          <Label>Status</Label>
          <Select value={f.agreement_status} onValueChange={(v) => setF({ ...f, agreement_status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{AGREEMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Signed document link</Label><Input value={f.agreement_link ?? ""} onChange={(e) => setF({ ...f, agreement_link: e.target.value })} placeholder="https://…" /></div>
        <div className="md:col-span-2"><Label>Signature platform link (SignNow, etc.)</Label><Input value={f.agreement_signature_platform_link ?? ""} onChange={(e) => setF({ ...f, agreement_signature_platform_link: e.target.value })} /></div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={save}>Save agreement</Button>
        {f.agreement_link && <a href={f.agreement_link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Open <ExternalLink className="ml-1.5 h-3 w-3" /></Button></a>}
      </div>
    </Card>
  );
}