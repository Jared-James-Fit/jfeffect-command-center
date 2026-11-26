import { useSyncExternalStore } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StepUpConfirm } from "@/components/two-step/staff-mfa-gate";

/**
 * The one question an account view can ask, as a promise any screen can await: "confirm it's
 * you" before switching edits on in an account that isn't an active coaching client (a member,
 * an archived or deactivated account). Routine access asks nothing: opening is one tap,
 * view-only. One host shows it (PovStartHost: the account view's bar).
 */
type StepUpAsk = { resolve: (ok: boolean) => void };

let ask: StepUpAsk | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const setAsk = (a: StepUpAsk | null) => {
  ask = a;
  emit();
};

export function askStepUp(): Promise<boolean> {
  return new Promise((resolve) => {
    ask?.resolve(false);
    setAsk({ resolve });
  });
}

function useAsk(): StepUpAsk | null {
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
          <DialogDescription>Editing an account that isn't an active coaching client needs a fresh confirmation (good for 30 minutes).</DialogDescription>
        </DialogHeader>
        {a && <StepUpConfirm onConfirmed={() => close(true)} />}
      </DialogContent>
    </Dialog>
  );
}
