import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Edit, BellRing, CheckCircle2, StickyNote, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { GoalsSummaryCard } from "@/components/client-goals/GoalsSummaryCard";
import { GoalsSetupFlow } from "@/components/client-goals/GoalsSetupFlow";
import { markGoalsReviewedFn, requestGoalsUpdateFn } from "@/lib/client-goals/goals.functions";
import { useAuth } from "@/lib/auth";
import { FIELD_LABELS } from "@/lib/client-goals/schema";

export function GoalsSetupPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqMsg, setReqMsg] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const markReviewed = useServerFn(markGoalsReviewedFn);
  const requestUpdate = useServerFn(requestGoalsUpdateFn);

  const reviewMut = useMutation({
    mutationFn: () => markReviewed({ data: { clientId } }),
    onSuccess: () => {
      toast.success("Marked as reviewed");
      qc.invalidateQueries({ queryKey: ["client-goals-setup", clientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark reviewed"),
  });

  const requestMut = useMutation({
    mutationFn: () => requestUpdate({ data: { clientId, message: reqMsg || null } }),
    onSuccess: () => {
      toast.success("Update requested — client will see a banner in their portal");
      setReqOpen(false); setReqMsg("");
      qc.invalidateQueries({ queryKey: ["client-goals-setup", clientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not request update"),
  });

  // Private coach notes (RLS hides from client).
  const notes = useQuery({
    queryKey: ["client-goals-notes", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_goals_setup_notes")
        .select("id, body, created_at, author_id")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; body: string; created_at: string; author_id: string }>;
    },
  });

  const addNoteMut = useMutation({
    mutationFn: async () => {
      if (!noteBody.trim()) throw new Error("Note is empty");
      const { error } = await (supabase as any).from("client_goals_setup_notes").insert({
        client_id: clientId,
        author_id: user?.id,
        body: noteBody.trim().slice(0, 2000),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["client-goals-notes", clientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save note"),
  });

  const delNoteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("client_goals_setup_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-goals-notes", clientId] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not delete note"),
  });

  // Recent audit / change history (limit 10).
  const audit = useQuery({
    queryKey: ["client-goals-audit", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_goals_setup_audit")
        .select("id, changed_fields, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Array<{ id: number; changed_fields: string[]; created_at: string }>;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing(true)} size="sm">
          <Edit className="mr-1 h-4 w-4" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReqOpen(true)}>
          <BellRing className="mr-1 h-4 w-4" /> Request client update
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={() => reviewMut.mutate()}
          disabled={reviewMut.isPending}
        >
          {reviewMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
          Mark reviewed
        </Button>
      </div>

      <GoalsSummaryCard clientId={clientId} />

      {/* Private coach notes */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold">Private coach notes</div>
          <Badge variant="outline" className="text-[10px]">Hidden from client</Badge>
        </div>
        <div className="mt-3 space-y-2">
          <Textarea
            rows={3}
            placeholder="Write a private note about this client's goals…"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            maxLength={2000}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => addNoteMut.mutate()} disabled={addNoteMut.isPending || !noteBody.trim()}>
              {addNoteMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Add note
            </Button>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {(notes.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          ) : (
            (notes.data ?? []).map((n) => (
              <div key={n.id} className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 p-2">
                <div className="flex-1 whitespace-pre-wrap text-sm">{n.body}</div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</div>
                  {n.author_id === user?.id && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delNoteMut.mutate(n.id)} aria-label="Delete note">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Recent changes */}
      <Card className="p-4">
        <div className="text-sm font-semibold">Recent changes</div>
        <div className="mt-2 space-y-1.5">
          {(audit.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
          ) : (
            (audit.data ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap gap-1">
                  {a.changed_fields.map((f, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">
                      {FIELD_LABELS[f] ?? f}
                    </Badge>
                  ))}
                </div>
                <div className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Edit sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Edit Goals & Setup</SheetTitle>
            <SheetDescription>Update the client's answers on their behalf.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <GoalsSetupFlow clientId={clientId} onComplete={() => setEditing(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Request update dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a Goals & Setup update</DialogTitle>
            <DialogDescription>
              The client will see a banner in their portal asking them to review and update their answers.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Optional message for the client…"
            value={reqMsg}
            onChange={(e) => setReqMsg(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReqOpen(false)}>Cancel</Button>
            <Button onClick={() => requestMut.mutate()} disabled={requestMut.isPending}>
              {requestMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}