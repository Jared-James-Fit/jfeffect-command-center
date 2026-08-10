import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { adjustPtSessionCredit, deletePtSession } from "@/lib/pt-session-manage.functions";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { fmtTimeRange } from "@/lib/pt-sessions";

type Session = {
  id: string;
  client_id: string;
  title: string;
  status: string;
  session_date: string;
  start_time: string;
  end_time: string;
};

function sessionSummary(s: Session): string {
  const date = new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
  return `${s.title} · ${date} · ${fmtTimeRange(s.start_time, s.end_time)}`;
}

// ---------------------------------------------------------------------------
// No-show — asks whether to deduct a credit.
// ---------------------------------------------------------------------------
export function NoShowPtDialog({
  open, onOpenChange, session, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"deduct" | "keep" | null>(null);

  const mark = async (deduct: boolean) => {
    if (!session) return;
    setBusy(deduct ? "deduct" : "keep");
    try {
      await setPtSessionStatus({ data: { sessionId: session.id, status: "Missed", deductOnMissed: deduct } });
      toast.success(deduct ? "No-show recorded — 1 credit deducted" : "No-show recorded — credit released back to available");
      invalidatePtSessionCaches(qc, session.client_id);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban className="h-4 w-4 text-warning" /> Mark No-show</DialogTitle>
        </DialogHeader>
        {session && <p className="text-sm text-muted-foreground">{sessionSummary(session)}</p>}
        <p className="text-sm font-semibold">Deduct a session credit for this no-show?</p>
        <div className="grid gap-2">
          <Button variant="destructive" disabled={busy !== null} onClick={() => mark(true)}>
            {busy === "deduct" ? "Saving…" : "Deduct 1 credit"}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => mark(false)}>
            {busy === "keep" ? "Saving…" : "Do not deduct — release credit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete — guarded. Completed / deducted sessions are protected server-side.
// ---------------------------------------------------------------------------
export function DeletePtSessionDialog({
  open, onOpenChange, session, impactLabel, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session | null;
  impactLabel?: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const completed = session?.status === "Completed";

  const run = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await deletePtSession({ data: { sessionId: session.id } });
      toast.success(
        session.status === "Scheduled"
          ? "Session deleted — reserved credit released back to the client"
          : "Session deleted",
      );
      invalidatePtSessionCaches(qc, session.client_id);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" /> Delete Session</DialogTitle>
        </DialogHeader>
        {session && <p className="text-sm text-muted-foreground">{sessionSummary(session)}</p>}
        {completed ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              This session is <strong>completed</strong> and has credit history. It can’t be deleted
              directly — undo the completion first so the credit is restored, then delete.
            </span>
          </div>
        ) : (
          <p className="text-sm">
            Delete this {session?.status === "Scheduled" ? "scheduled session and release the reserved credit back to the client" : "session"}?
            {impactLabel ? <span className="block mt-1 text-xs text-muted-foreground">Credit impact now: {impactLabel}. Ledger history is kept.</span> : null}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep Session</Button>
          {!completed && (
            <Button variant="destructive" disabled={busy} onClick={run}>
              {busy ? "Deleting…" : "Delete Session"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancel — confirms and explains the credit release.
// ---------------------------------------------------------------------------
export function CancelPtSessionDialog({
  open, onOpenChange, session, hasReservation, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session | null;
  hasReservation?: boolean;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await setPtSessionStatus({ data: { sessionId: session.id, status: "Cancelled" } });
      toast.success(hasReservation ? "Session cancelled — reserved credit released" : "Session cancelled");
      invalidatePtSessionCaches(qc, session.client_id);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
          <AlertDialogDescription>
            {session ? sessionSummary(session) : ""}
            {hasReservation
              ? " The reserved credit is released back to the client’s available balance."
              : " No credit was reserved, so the balance does not change."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Session</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); run(); }} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel Session"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Adjust Credit — admin-only manual balance change with required reason/note.
// ---------------------------------------------------------------------------
const ADJUST_REASONS = [
  "Cancelled session release",
  "Bonus session",
  "No-show deduction",
  "Correction",
  "Package upgrade credit",
  "Other",
];

export function AdjustPtCreditDialog({
  open, onOpenChange, clientId, session, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  session?: Session | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>("add");
  const [amount, setAmount] = useState(1);
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState(ADJUST_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("add"); setAmount(1); setDirection("add"); setValue("");
    setReason(ADJUST_REASONS[0]); setNote("");
  }, [open]);

  const sessionTypes = session
    ? [
        { value: "add", label: "Add credit" },
        { value: "deduct", label: "Deduct credit" },
        { value: "release_reserved", label: "Release reserved credit" },
        { value: "reserve", label: "Reserve credit" },
        { value: "correct", label: "Correct mistake" },
      ]
    : [
        { value: "add", label: "Add credit" },
        { value: "deduct", label: "Deduct credit" },
        { value: "correct", label: "Correct mistake" },
      ];

  const fixedOne = type === "release_reserved" || type === "reserve";
  const showValue = !fixedOne;

  const save = async () => {
    if (note.trim().length < 2) return toast.error("Add a short note for the audit trail");
    if (!fixedOne && (!amount || amount < 1)) return toast.error("Enter at least 1 session");
    const valueMinor = value.trim() ? Math.round(Number(value) * 100) : null;
    if (value.trim() && (Number.isNaN(valueMinor) || (valueMinor ?? 0) < 0)) {
      return toast.error("Enter a valid dollar value");
    }
    setBusy(true);
    try {
      await adjustPtSessionCredit({
        data: {
          clientId,
          sessionId: session?.id ?? null,
          type: type as any,
          amount: fixedOne ? 1 : amount,
          delta: type === "correct" ? (direction === "add" ? amount : -amount) : undefined,
          unitValueMinor: showValue ? valueMinor : null,
          reason,
          note: note.trim(),
        },
      });
      toast.success("Credit adjustment saved");
      invalidatePtSessionCaches(qc, clientId);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Adjustment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Adjust Credit</DialogTitle></DialogHeader>
        {session && <p className="text-xs text-muted-foreground">{sessionSummary(session)}</p>}
        <div className="space-y-3">
          <div>
            <Label>Adjustment type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sessionTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {type === "correct" && (
            <div>
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add back to balance</SelectItem>
                  <SelectItem value="remove">Remove from balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {!fixedOne && (
            <div>
              <Label>Sessions</Label>
              <Input
                type="number" min={1} max={50} value={amount}
                onChange={(e) => setAmount(Math.max(1, Math.min(50, parseInt(e.target.value || "1", 10) || 1)))}
              />
            </div>
          )}
          {fixedOne && (
            <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
              {type === "release_reserved"
                ? "Frees the 1 credit this session is holding back to available."
                : "Holds 1 available credit for this session."}
            </p>
          )}
          {showValue && (
            <div>
              <Label>Dollar value per session (optional)</Label>
              <Input type="number" min={0} step="0.01" placeholder="e.g. 85.00" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ADJUST_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (required)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is the balance changing?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Apply Adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}