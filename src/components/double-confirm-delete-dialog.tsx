import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Two-step destructive confirmation:
 *  Step 1 — "Are you sure?" (Cancel / Continue)
 *  Step 2 — Must type "DELETE" before the destructive button enables.
 *
 * Use the same component for single-row and bulk delete by passing `count`.
 */
export function DoubleConfirmDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  count = 1,
  title = "Delete record?",
  message,
  strongWarning,
  confirmLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => Promise<void> | void;
  count?: number;
  title?: string;
  message?: string;
  /** Extra red-zone warning (e.g. "This agreement has a signed PDF attached."). */
  strongWarning?: string;
  confirmLabel?: string;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const finalLabel = confirmLabel ?? (count > 1 ? `Delete ${count} records` : "Delete record");

  useEffect(() => {
    if (open) {
      setStep(1);
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  async function handleConfirm() {
    if (typed.trim().toUpperCase() !== "DELETE") return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const defaultMessage =
    count > 1
      ? `You are about to delete ${count} records.`
      : "Are you sure you want to delete this record?";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-3 text-sm">
            <p>{message ?? defaultMessage}</p>
            {strongWarning && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs">
                <strong>Warning:</strong> {strongWarning}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => setStep(2)}>Continue</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              This action <strong>cannot be undone</strong>.
              Type <code className="rounded bg-muted px-1 py-0.5 font-mono">DELETE</code> to confirm.
            </p>
            {strongWarning && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs">
                <strong>Warning:</strong> {strongWarning}
              </div>
            )}
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type DELETE"
              className="font-mono"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>Back</Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
              >
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {finalLabel}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}