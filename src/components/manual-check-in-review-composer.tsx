import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createManualReview, type ManualReviewSource } from "@/lib/manual-check-in-reviews";
import { toast } from "sonner";
import { Send, ChevronDown, ChevronRight } from "lucide-react";
import { runJob } from "@/lib/progress-jobs";
import { todayLocalISO } from "@/lib/today";

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
  const source: ManualReviewSource = "manual";
  const [checkInDate, setCheckInDate] = useState<string>(todayLocalISO());
  const [title, setTitle] = useState("Weekly Check-In Response");
  const [message, setMessage] = useState("");
  const [actionItems, setActionItems] = useState("");
  const priority: string = "none";
  const [internalNotes, setInternalNotes] = useState("");
  const externalLink = "";
  const [notify, setNotify] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    
    runJob({
      title: "Submitting review",
      description: `Sending check-in review to client`,
      steps: ["Submitting check-in", "Saving answers", "Updating status", "Notifying coach", "Completed"],
    }, async (job) => {
      job.completeStep(0); // Submitting check-in
      
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
      
      job.completeStep(1); // Saving answers
      job.completeStep(2); // Updating status
      job.completeStep(3); // Notifying coach (implied in the createManualReview or separate notification)
      
      qc.invalidateQueries({ queryKey: ["manual-check-in-reviews"] });
      qc.invalidateQueries({ queryKey: ["manual-reviews-for-client"] });
      
      // reset
      setMessage(""); setActionItems(""); setInternalNotes("");
      
      job.completeStep(4); // Completed
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Check-In Response</DialogTitle>
          <DialogDescription>
            Two boxes — what you want to say, and their focus for the week. They'll get a notification and can chat back like a text message.
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

          <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Sending today · <span className="font-bold text-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          </div>

          <div>
            <Label className="text-sm font-bold">📝 Message for me to send</Label>
            <p className="mb-1 text-xs text-muted-foreground">What you want to tell them about this week's check-in. Type it like a text.</p>
            <Textarea
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hey! Great work this week — here's what stood out…"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-sm font-bold">🎯 Focus for this week</Label>
            <p className="mb-1 text-xs text-muted-foreground">The 1–3 things you want them to lock in. Short bullets are perfect.</p>
            <Textarea
              rows={3}
              value={actionItems}
              onChange={(e) => setActionItems(e.target.value)}
              placeholder="• Hit 10k steps daily&#10;• Add 1 extra back set&#10;• Sleep 7+ hours"
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Advanced (optional)
          </button>

          {advancedOpen && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Check-In Date</Label>
                  <Input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Internal notes (only you see)</Label>
                <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
              </div>
              <div className="flex items-center justify-between rounded-md bg-card px-3 py-2">
                <div className="text-xs">
                  <div className="font-bold">Notify client</div>
                  <div className="text-muted-foreground">Pops up next time they open the app.</div>
                </div>
                <Switch checked={notify} onCheckedChange={setNotify} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>Cancel</ActionButton>
          <ActionButton onClick={submit} disabled={!message.trim() || !clientId} className="bg-gradient-primary font-bold">
            <Send className="mr-2 h-4 w-4" />
            Send to Client
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
