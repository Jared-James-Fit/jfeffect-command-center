import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createManualReview, type ManualReviewSource } from "@/lib/manual-check-in-reviews";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

export function ManualCheckInReviewComposer({
  open,
  onOpenChange,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClientId?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [clientId, setClientId] = useState<string>(defaultClientId ?? "");
  const [source, setSource] = useState<ManualReviewSource>("fillout");
  const [checkInDate, setCheckInDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("Weekly Check-In Review");
  const [message, setMessage] = useState("");
  const [actionItems, setActionItems] = useState("");
  const [priority, setPriority] = useState<string>("none");
  const [internalNotes, setInternalNotes] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [notify, setNotify] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => { if (defaultClientId) setClientId(defaultClientId); }, [defaultClientId]);

  const { data: clients = [] } = useQuery({
    queryKey: ["composer-client-list"],
    enabled: open && !defaultClientId,
    queryFn: async () => {
      const { data } = await (supabase.from("clients") as any)
        .select("id, full_name, email")
        .eq("archived", false)
        .order("full_name", { ascending: true });
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });

  async function submit() {
    if (!user) return;
    if (!clientId) { toast.error("Pick a client"); return; }
    if (!message.trim()) { toast.error("Write a review message"); return; }
    setSending(true);
    try {
      await createManualReview({
        clientId,
        coachUserId: user.id,
        source,
        checkInDate: checkInDate || null,
        title: title.trim() || "Check-In Review",
        message: message.trim(),
        actionItems: actionItems.trim() || null,
        priority: priority === "none" ? null : priority,
        internalNotes: internalNotes.trim() || null,
        externalLink: externalLink.trim() || null,
        notifyClient: notify,
      });
      toast.success("Review sent" + (notify ? " — client will be notified" : ""));
      qc.invalidateQueries({ queryKey: ["manual-check-in-reviews"] });
      qc.invalidateQueries({ queryKey: ["manual-reviews-for-client"] });
      // reset
      setMessage(""); setActionItems(""); setInternalNotes(""); setExternalLink("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not send review");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Check-In Review</DialogTitle>
          <DialogDescription>
            Send a check-in review to a client — works even when the check-in came from an external form (Fillout, etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!defaultClientId && (
            <div>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email ?? c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as ManualReviewSource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fillout">Fillout</SelectItem>
                  <SelectItem value="external">External Form</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="native">Native (In-App)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Check-In Date</Label>
              <Input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly Check-In Review" />
          </div>

          <div>
            <Label>Coach Feedback</Label>
            <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your review like a message…" />
          </div>

          <div>
            <Label>Action Items <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea rows={2} value={actionItems} onChange={(e) => setActionItems(e.target.value)} placeholder="e.g. hit 10k steps daily, add 1 extra back set" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>External Link <span className="text-xs text-muted-foreground">(admin-only)</span></Label>
              <Input value={externalLink} onChange={(e) => setExternalLink(e.target.value)} placeholder="Fillout response URL…" />
            </div>
          </div>

          <div>
            <Label>Internal Notes <span className="text-xs text-muted-foreground">(admin-only, not shown to client)</span></Label>
            <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div>
              <div className="text-sm font-bold">Notify Client</div>
              <div className="text-xs text-muted-foreground">Show this review in their portal on next login.</div>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={submit} disabled={sending || !message.trim() || !clientId} className="bg-gradient-primary font-bold">
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}