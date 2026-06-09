import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendManualSms } from "@/lib/sms.functions";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";

function render(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export function SendSmsDialog({
  open, onOpenChange, clientId, clientName, firstName, phone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clientId: string; clientName?: string | null; firstName?: string | null; phone?: string | null;
}) {
  const send = useServerFn(sendManualSms);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["sms-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
      return data;
    },
    enabled: open,
  });

  useEffect(() => {
    if (open && settings && !body) {
      setBody(render(settings.manual_default_template ?? "", {
        first_name: firstName ?? clientName?.split(" ")[0] ?? "there",
        full_name: clientName ?? "",
        brand: settings.brand_name ?? "Jared James Coaching",
      }));
    }
    if (!open) setBody("");
  }, [open, settings, firstName, clientName, body]);

  const doSend = async () => {
    if (!body.trim()) return toast.error("Message is empty");
    if (!settings?.from_phone) return toast.error("Set a Twilio From phone number in SMS settings first");
    if (!settings?.enabled) return toast.error("SMS sending is disabled in settings");
    if (!phone) return toast.error("This client has no phone number on file");
    setBusy(true);
    try {
      await send({ data: { client_id: clientId, body: body.trim() } });
      toast.success(`SMS sent to ${clientName ?? "client"}`);
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed to send"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Send SMS</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {settings && (!settings.from_phone || !settings.enabled) && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <div className="font-semibold text-amber-700 dark:text-amber-400">SMS not ready to send</div>
              <div className="mt-1 text-muted-foreground">
                {!settings.from_phone && <div>• No Twilio From number configured.</div>}
                {!settings.enabled && <div>• SMS sending is currently disabled.</div>}
              </div>
              <Link to="/admin/settings/sms" className="mt-2 inline-block font-semibold underline" onClick={() => onOpenChange(false)}>
                Open SMS settings →
              </Link>
            </div>
          )}
          {!phone && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              No phone number on file for this client. Add one on their profile or in Call Access.
            </div>
          )}
          <div className="text-sm">
            To <span className="font-semibold">{clientName ?? "client"}</span>
            {phone && <Badge variant="outline" className="ml-2">{phone}</Badge>}
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Use plain language — clients may not know app jargon.</span>
              <span>{body.length}/1000</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doSend} disabled={busy || !body.trim()}>{busy ? "Sending…" : "Send SMS"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}