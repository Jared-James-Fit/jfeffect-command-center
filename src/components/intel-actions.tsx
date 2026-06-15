import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, MoreVertical, UserCircle, Dumbbell, CheckCircle2, AlertTriangle, ClipboardCheck, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import {
import { todayLocalISO } from "@/lib/today";
  markAlertReviewed, markAllReviewed, setPainFlagStatus, createFollowup, setFollowupStatus,
  PAIN_STATUSES, PAIN_REGEX, type ClientIntel, type PainFlag, type Followup,
} from "@/lib/coach-intel";

function invalidate(qc: any, clientId: string) {
  qc.invalidateQueries({ queryKey: ["coach-intel"] });
  qc.invalidateQueries({ queryKey: ["client-intel", clientId] });
}

/** Common "Message + Profile + Program" link cluster. */
export function ClientQuickLinks({ c, compact = false }: { c: { client_id: string; full_name?: string }; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Link to="/admin/messages" search={{ client: c.client_id }}>
        <Button size="sm" variant="outline"><MessageSquare className="mr-1 h-3.5 w-3.5" />{compact ? "" : "Message"}</Button>
      </Link>
      <Link to="/admin/clients/$id" params={{ id: c.client_id }}>
        <Button size="sm" variant="ghost"><UserCircle className="h-4 w-4" /></Button>
      </Link>
      <Link to="/admin/client-programs/$clientId" params={{ clientId: c.client_id }}>
        <Button size="sm" variant="ghost"><Dumbbell className="h-4 w-4" /></Button>
      </Link>
    </div>
  );
}

export function highlightPainHtml(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(PAIN_REGEX.source, "ig");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={m.index} className="rounded bg-red-500/30 px-0.5 text-red-100">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Single-alert review button (small icon button). */
export function ReviewAlertButton({ clientId, alertKey, alertKind, label = "Mark reviewed" }: { clientId: string; alertKey: string; alertKind: string; label?: string }) {
  const qc = useQueryClient();
  return (
    <Button size="sm" variant="ghost" onClick={async () => {
      try { await markAlertReviewed(clientId, alertKey, alertKind); invalidate(qc, clientId); toast.success("Marked reviewed"); }
      catch (e: any) { toast.error(e.message ?? "Failed"); }
    }}>
      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{label}
    </Button>
  );
}

/** Pain flag status row with menu. */
export function PainFlagActions({ flag, clientId }: { flag: PainFlag; clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select value={flag.status} onValueChange={async (v) => {
        try { await setPainFlagStatus(flag.id, v as any); invalidate(qc, clientId); toast.success("Status updated"); }
        catch (e: any) { toast.error(e.message ?? "Failed"); }
      }}>
        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PAIN_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/admin/messages", search: { client: clientId } })}>
        <MessageSquare className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Follow-up
      </Button>
      <FollowupDialog open={open} onOpenChange={setOpen} clientId={clientId} defaultReason={`Pain flag: ${(flag.matched_keywords ?? []).join(", ")}`} defaultSource="pain" />
    </div>
  );
}

/** Open day/workout link if known. */
export function OpenWorkoutLink({ dayId, label = "Open workout" }: { dayId: string | null | undefined; label?: string }) {
  if (!dayId) return null;
  return (
    <Link to="/portal/workouts/$dayId" params={{ dayId }}>
      <Button size="sm" variant="outline"><PlayCircle className="mr-1 h-3.5 w-3.5" />{label}</Button>
    </Link>
  );
}

/* ===================== Follow-up dialog ===================== */

export function FollowupDialog({ open, onOpenChange, clientId, defaultReason = "", defaultSource = "manual" }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; defaultReason?: string; defaultSource?: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(defaultReason);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const submit = async () => {
    if (!reason.trim()) return toast.error("Add a reason");
    try {
      await createFollowup({ client_id: clientId, reason: reason.trim(), source: defaultSource, due_date: dueDate || null, notes: notes.trim() || null });
      invalidate(qc, clientId);
      qc.invalidateQueries({ queryKey: ["followups"] });
      toast.success("Follow-up created");
      onOpenChange(false);
      setReason(""); setDueDate(""); setNotes("");
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create follow-up</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Check on lower-back pain" />
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Render a single follow-up row with status controls. */
export function FollowupRow({ f }: { f: Followup }) {
  const qc = useQueryClient();
  const overdue = f.due_date && f.due_date < todayLocalISO() && f.status === "open";
  const update = async (status: "completed" | "dismissed" | "open") => {
    try { await setFollowupStatus(f.id, status); invalidate(qc, f.client_id); qc.invalidateQueries({ queryKey: ["followups"] }); toast.success("Updated"); }
    catch (e: any) { toast.error(e.message ?? "Failed"); }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 p-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{f.reason}</div>
        <div className="text-muted-foreground">
          {f.source && <Badge variant="outline" className="mr-1">{f.source}</Badge>}
          {f.due_date ? <span className={overdue ? "text-red-400 font-bold" : ""}>Due {f.due_date}{overdue && " (overdue)"}</span> : "No due date"}
        </div>
        {f.notes && <div className="mt-1 text-muted-foreground line-clamp-2">{f.notes}</div>}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => update("completed")}><CheckCircle2 className="h-4 w-4 text-green-500" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => update("dismissed")}>Dismiss</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => update("open")}>Reopen</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ===================== Bulk action on a client ===================== */

export function MarkAllClientReviewed({ c }: { c: ClientIntel }) {
  const qc = useQueryClient();
  const alerts = [
    ...c.missed_days.map((m) => ({ alert_key: m.alert_key, alert_kind: "missed" })),
    ...c.recent_prs.map((p) => ({ alert_key: p.alert_key, alert_kind: "pr" })),
    ...c.recent_notes.map((n) => ({ alert_key: n.alert_key, alert_kind: "note" })),
  ];
  if (alerts.length === 0) return null;
  return (
    <Button size="sm" variant="ghost" onClick={async () => {
      try { await markAllReviewed(c.client_id, alerts); invalidate(qc, c.client_id); toast.success(`${alerts.length} alerts reviewed`); }
      catch (e: any) { toast.error(e.message ?? "Failed"); }
    }}>
      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark all reviewed
    </Button>
  );
}
