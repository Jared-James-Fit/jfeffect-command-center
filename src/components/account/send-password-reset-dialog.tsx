import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { adminSendPasswordReset } from "@/lib/account-recovery.functions";
import { maskEmail, maskPhone } from "@/lib/account-recovery.constants";

type Props = {
  targetUserId: string | null | undefined;
  email?: string | null;
  phone?: string | null;
  triggerLabel?: string;
};

type LastStatus = {
  outcome: string;
  emailSent: boolean;
  smsSent: boolean;
  emailMasked: string;
  phoneMasked: string;
  at: string;
} | null;

export function SendPasswordResetDialog({
  targetUserId,
  email,
  phone,
  triggerLabel = "Send Password Reset",
}: Props) {
  const send = useServerFn(adminSendPasswordReset);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LastStatus>(null);

  const eMask = maskEmail(email);
  const pMask = maskPhone(phone);
  const hasEmail = !!email;
  const hasPhone = !!phone;

  const submit = async () => {
    if (!targetUserId) return;
    setBusy(true);
    try {
      const res = await send({ data: { target_user_id: targetUserId, channel } });
      setLast({
        outcome: res.outcome,
        emailSent: res.emailSent,
        smsSent: res.smsSent,
        emailMasked: res.emailMasked,
        phoneMasked: res.phoneMasked,
        at: new Date().toISOString(),
      });
      const label =
        res.outcome === "failed"
          ? "Delivery failed"
          : res.outcome === "partial"
          ? "Partially delivered"
          : res.outcome === "rate_limited"
          ? "Rate limited"
          : res.outcome === "email_sent"
          ? "Email sent"
          : "SMS sent";
      toast.success(`Password reset: ${label}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send reset");
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (() => {
    if (!last) return null;
    const variant = last.outcome === "failed" ? "destructive" : "secondary";
    const label =
      last.outcome === "email_sent"
        ? "Email Sent"
        : last.outcome === "sms_sent"
        ? "SMS Sent"
        : last.outcome === "partial"
        ? "Partially Delivered"
        : last.outcome === "rate_limited"
        ? "Rate Limited"
        : "Delivery Failed";
    return <Badge variant={variant as any}>{label}</Badge>;
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <KeyRound className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Send Password Reset
          </DialogTitle>
          <DialogDescription>
            Sends a secure, single-use recovery link. You will never see the user's
            password, the token, or be able to log in as them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-mono">{hasEmail ? eMask : "—"}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Mobile</span><span className="font-mono">{hasPhone ? pMask : "—"}</span></div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Send via</Label>
            <RadioGroup
              value={channel}
              onValueChange={(v) => setChannel(v as any)}
              className="mt-2 space-y-2"
            >
              <label className="flex items-center gap-2 rounded-md border border-border bg-card/50 p-3 text-sm has-[:disabled]:opacity-50">
                <RadioGroupItem value="email" disabled={!hasEmail} />
                Email only ({hasEmail ? eMask : "no email on file"})
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border bg-card/50 p-3 text-sm has-[:disabled]:opacity-50">
                <RadioGroupItem value="sms" disabled={!hasPhone} />
                SMS only ({hasPhone ? pMask : "no phone on file"})
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border bg-card/50 p-3 text-sm has-[:disabled]:opacity-50">
                <RadioGroupItem value="both" disabled={!hasEmail || !hasPhone} />
                Both
              </label>
            </RadioGroup>
          </div>

          {last && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last delivery</span>
                {statusBadge}
              </div>
              <div className="mt-2 grid gap-1">
                <div>Email: <span className="font-mono">{last.emailMasked || "—"}</span> {last.emailSent ? "✓" : "—"}</div>
                <div>SMS: <span className="font-mono">{last.phoneMasked || "—"}</span> {last.smsSent ? "✓" : "—"}</div>
                <div className="text-muted-foreground">{new Date(last.at).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={busy || !targetUserId || (channel === "email" && !hasEmail) || (channel === "sms" && !hasPhone) || (channel === "both" && (!hasEmail || !hasPhone))}
            className="bg-gradient-primary"
          >
            {busy ? "Sending…" : "Send Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}