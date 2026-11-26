import { useEffect, useState, useSyncExternalStore } from "react";
import { Eye, PenLine, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { POV_REASONS, type PovMode } from "@/lib/pov/pov-rules";
import { StepUpConfirm } from "@/components/two-step/staff-mfa-gate";

/**
 * The questions an account view asks, as promises any screen can await: why you're opening the
 * account (and whether to switch edits on), and "confirm it's you" before edits in a member's
 * account. One host shows them (PovStartHost: the admin layout and the account view's bar).
 */
type ReasonAsk = {
  kind: "reason";
  name: string | null;
  /** Asking only to switch edits on (from the bar). */
  forEdit?: boolean;
  resolve: (v: { reason: string; mode: PovMode } | null) => void;
};
type StepUpAsk = { kind: "step-up"; resolve: (ok: boolean) => void };
type Ask = ReasonAsk | StepUpAsk;

let ask: Ask | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const setAsk = (a: Ask | null) => {
  ask = a;
  emit();
};

export function askPovReason(name: string | null, opts: { forEdit?: boolean } = {}): Promise<{ reason: string; mode: PovMode } | null> {
  return new Promise((resolve) => {
    ask?.kind === "reason" ? ask.resolve(null) : ask?.kind === "step-up" ? ask.resolve(false) : null;
    setAsk({ kind: "reason", name, forEdit: opts.forEdit, resolve });
  });
}

export function askStepUp(): Promise<boolean> {
  return new Promise((resolve) => {
    ask?.kind === "reason" ? ask.resolve(null) : ask?.kind === "step-up" ? ask.resolve(false) : null;
    setAsk({ kind: "step-up", resolve });
  });
}

function useAsk(): Ask | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ask,
    () => null,
  );
}

export function PovStartHost() {
  const a = useAsk();
  return (
    <>
      <ReasonDialog ask={a?.kind === "reason" ? a : null} />
      <StepUpDialog ask={a?.kind === "step-up" ? a : null} />
    </>
  );
}

function ReasonDialog({ ask: a }: { ask: ReasonAsk | null }) {
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    if (a) {
      setReason("");
      setEdit(!!a.forEdit);
    }
  }, [a]);
  const close = (v: { reason: string; mode: PovMode } | null) => {
    a?.resolve(v);
    setAsk(null);
  };
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && close(null)}>
      <DialogContent className="max-w-md" data-pov-reason>
        <DialogHeader>
          <DialogTitle>{a?.forEdit ? "Switch on edits" : `Open ${a?.name ?? "their"} account`}</DialogTitle>
          <DialogDescription>
            {a?.forEdit
              ? "Say what you need to change. Edits stay on for 15 minutes and every change is recorded."
              : "You'll see the app as they do, with your own sign-in. It opens view-only, and who opened it, when and why is recorded."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reason">
          {POV_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                "min-h-10 rounded-full border px-3 text-sm transition-colors",
                reason === r ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          placeholder="Or type the reason"
          aria-label="Reason"
          className="h-11"
        />
        {!a?.forEdit && (
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3">
            <span className="text-sm">
              <span className="font-medium">Allow edits</span>
              <span className="block text-xs text-muted-foreground">Logging a session or fixing their data. You can switch this on later.</span>
            </span>
            <Switch checked={edit} onCheckedChange={setEdit} aria-label="Allow edits" />
          </label>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" disabled={!ok} onClick={() => close({ reason: reason.trim(), mode: edit ? "edit" : "view" })}>
            {edit ? <PenLine className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
            {a?.forEdit ? "Switch on edits" : edit ? "Open with edits" : "Open view-only"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepUpDialog({ ask: a }: { ask: StepUpAsk | null }) {
  const close = (ok: boolean) => {
    a?.resolve(ok);
    setAsk(null);
  };
  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="max-w-md" data-pov-step-up>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" aria-hidden /> Confirm it's you
          </DialogTitle>
          <DialogDescription>Editing inside a member's account needs a fresh confirmation (good for 30 minutes).</DialogDescription>
        </DialogHeader>
        {a && <StepUpConfirm onConfirmed={() => close(true)} />}
      </DialogContent>
    </Dialog>
  );
}
