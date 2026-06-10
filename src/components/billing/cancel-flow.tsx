import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cancelJfMembership, freezeJfMembership, switchToHoldPlan } from "@/lib/jf-billing.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Snowflake, Pause, XCircle, Heart } from "lucide-react";

const REASONS = ["Too expensive","Not using it enough","Missing features","Technical issue","Switching to coaching","Taking a break","Other"];
const LOSE = ["workout plan library","workout tracking","exercise library","recipe library","nutrition resources","resource library","events","announcements","progress tracking","member-only updates"];

export function CancelFlow({ open, onOpenChange, holdPriceDisplay = "$9/month", onDone }: {
  open: boolean; onOpenChange: (b: boolean) => void; holdPriceDisplay?: string; onDone?: () => void;
}) {
  const [step, setStep] = useState<"warn" | "options" | "reason" | "confirm">("warn");
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState<string>("");

  const cancelFn = useServerFn(cancelJfMembership);
  const freezeFn = useServerFn(freezeJfMembership);
  const holdFn = useServerFn(switchToHoldPlan);

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { reason, details } }),
    onSuccess: () => { toast.success("Membership will end at your current period."); onOpenChange(false); onDone?.(); },
    onError: (e: any) => toast.error(e.message),
  });
  const freeze = useMutation({
    mutationFn: () => freezeFn(),
    onSuccess: () => { toast.success("Membership frozen for 30 days."); onOpenChange(false); onDone?.(); },
    onError: (e: any) => toast.error(e.message),
  });
  const hold = useMutation({
    mutationFn: () => holdFn(),
    onSuccess: () => { toast.success("Switched to Hold Plan."); onOpenChange(false); onDone?.(); },
    onError: (e: any) => toast.error(e.message),
  });

  const close = () => { setStep("warn"); setReason(""); setDetails(""); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(b) => (b ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        {step === "warn" && (
          <>
            <DialogHeader><DialogTitle>Before you cancel</DialogTitle></DialogHeader>
            <div className="text-sm text-muted-foreground">You'll lose access to:</div>
            <ul className="grid grid-cols-2 gap-1 text-sm mt-2">
              {LOSE.map((x) => <li key={x} className="text-muted-foreground">• {x}</li>)}
            </ul>
            <DialogFooter className="mt-4 flex-col gap-2 sm:flex-row">
              <Button onClick={close}>Keep My Membership</Button>
              <Button variant="outline" onClick={() => setStep("options")}>Show me options</Button>
              <Button variant="ghost" onClick={() => setStep("reason")}>Continue to cancel</Button>
            </DialogFooter>
          </>
        )}
        {step === "options" && (
          <>
            <DialogHeader><DialogTitle>We've got options</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-start gap-3"><Heart className="h-5 w-5 text-emerald-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold">Keep My Membership</div>
                    <div className="text-xs text-muted-foreground">Keep full access to programs, recipes, resources, tracking, events, and member updates.</div>
                  </div>
                  <Button size="sm" onClick={close}>Keep</Button>
                </div>
              </Card>
              <Card className="border-sky-500/30 bg-sky-500/5 p-4">
                <div className="flex items-start gap-3"><Snowflake className="h-5 w-5 text-sky-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold">Freeze Membership for 30 Days</div>
                    <div className="text-xs text-muted-foreground">Pause billing and access for 30 days. Account & history saved. Resumes automatically.</div>
                  </div>
                  <Button size="sm" variant="outline" disabled={freeze.isPending} onClick={() => freeze.mutate()}>
                    {freeze.isPending ? "Freezing…" : "Freeze 30 Days"}
                  </Button>
                </div>
              </Card>
              <Card className="border-violet-500/30 bg-violet-500/5 p-4">
                <div className="flex items-start gap-3"><Pause className="h-5 w-5 text-violet-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold">Switch to Hold Plan</div>
                    <div className="text-xs text-muted-foreground">{holdPriceDisplay} to keep your profile, history, and progress. Reactivate anytime.</div>
                  </div>
                  <Button size="sm" variant="outline" disabled={hold.isPending} onClick={() => hold.mutate()}>
                    {hold.isPending ? "Switching…" : "Hold Plan"}
                  </Button>
                </div>
              </Card>
            </div>
            <DialogFooter className="mt-2">
              <Button variant="ghost" onClick={() => setStep("reason")}>Continue to cancel</Button>
            </DialogFooter>
          </>
        )}
        {step === "reason" && (
          <>
            <DialogHeader><DialogTitle>Mind sharing why?</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {REASONS.map((r) => (
                  <label key={r} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${reason === r ? "border-primary bg-primary/10" : "border-border"}`}>
                    <input type="radio" name="reason" className="sr-only" value={r} checked={reason === r} onChange={() => setReason(r)} />
                    {r}
                  </label>
                ))}
              </div>
              <div>
                <Label className="text-xs">Tell us more (optional)</Label>
                <Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close}>Keep My Membership</Button>
              <Button onClick={() => setStep("confirm")}>Continue</Button>
            </DialogFooter>
          </>
        )}
        {step === "confirm" && (
          <>
            <DialogHeader><DialogTitle>Confirm cancellation</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              Your membership will stay active until the end of your current billing period. After that, member access will be restricted, but your account history will stay saved.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={close}>Keep My Membership</Button>
              <Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {cancel.isPending ? "Cancelling…" : <><XCircle className="h-4 w-4 mr-1" />Confirm cancellation</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}