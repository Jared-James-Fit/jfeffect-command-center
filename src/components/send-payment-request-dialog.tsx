import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useServerFn } from "@tanstack/react-start";
import { sendPaymentLinkBySms, postPaymentRequestInChat } from "@/lib/sms-links.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CreditCard, MessageSquare, Send, Users } from "lucide-react";

export function SendPaymentRequestDialog({
  open, onOpenChange, purchaseId, clientName, hasPhone, hasLink,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purchaseId: string;
  clientName?: string | null;
  hasPhone?: boolean;
  hasLink?: boolean;
}) {
  const [tab, setTab] = useState<"sms" | "dm" | "group">("sms");
  const [note, setNote] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const smsFn = useServerFn(sendPaymentLinkBySms);
  const postFn = useServerFn(postPaymentRequestInChat);

  const { data: groups } = useQuery({
    queryKey: ["payment-request-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_groups")
        .select("id, name, archived")
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && tab === "group",
  });

  const send = async () => {
    setBusy(true);
    const t = toast.loading(
      tab === "sms" ? "Sending SMS…"
      : tab === "dm" ? "Posting in DM…"
      : "Posting in group…"
    );
    try {
      if (tab === "sms") {
        await smsFn({ data: { purchaseId } });
      } else if (tab === "dm") {
        await postFn({ data: { purchaseId, target: "dm", note: note.trim() || undefined } });
      } else {
        if (!groupId) throw new Error("Pick a group");
        await postFn({ data: { purchaseId, target: "group", groupId, note: note.trim() || undefined } });
      }
      toast.success("Payment request sent", { id: t });
      onOpenChange(false);
      setNote("");
      setGroupId("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />Send payment request
          </DialogTitle>
          <DialogDescription>
            {clientName ? <>For <span className="font-semibold text-foreground">{clientName}</span>.</> : null} Choose how to deliver it.
          </DialogDescription>
        </DialogHeader>

        {!hasLink && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            This purchase has no Stripe payment link. Attach one first.
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sms"><MessageSquare className="mr-1 h-3 w-3" />SMS</TabsTrigger>
            <TabsTrigger value="dm"><Send className="mr-1 h-3 w-3" />DM</TabsTrigger>
            <TabsTrigger value="group"><Users className="mr-1 h-3 w-3" />Group</TabsTrigger>
          </TabsList>

          <TabsContent value="sms" className="space-y-2 pt-3 text-sm">
            <p className="text-muted-foreground">
              Texts the Stripe payment link directly to the client's phone using your Twilio number.
            </p>
            {!hasPhone && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                This client has no phone number on file.
              </div>
            )}
          </TabsContent>

          <TabsContent value="dm" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Posts a tappable payment card in this client's 1:1 message thread.
            </p>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Here's your payment link…" maxLength={500} />
            </div>
          </TabsContent>

          <TabsContent value="group" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">Post a payment card in a group chat.</p>
            <div className="space-y-1.5">
              <Label>Group</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger><SelectValue placeholder="Pick a group…" /></SelectTrigger>
                <SelectContent>
                  {(groups ?? []).map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quick payment link for the program…" maxLength={500} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={send}
            disabled={busy || !hasLink || (tab === "sms" && !hasPhone) || (tab === "group" && !groupId)}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}