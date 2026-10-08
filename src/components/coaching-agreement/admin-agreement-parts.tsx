import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminRequestAgreement,
  adminSetAgreementExemption,
} from "@/lib/coaching-agreement.functions";
import {
  ROSTER_STATUS_LABEL,
  type ExemptKind,
  type RosterStatus,
} from "@/lib/coaching-agreement/rules";

export const ADMIN_AGREEMENT_QUERY_ROOT = "admin-coaching-agreement";

const STATUS_STYLE: Record<RosterStatus, string> = {
  signed: "border-emerald-500/50 text-emerald-600",
  never_signed: "border-red-500/50 text-red-600",
  admin_request: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  new_version: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  exempt: "border-border text-muted-foreground",
  no_account: "border-border text-muted-foreground",
};

export function AgreementStatusChip({ status }: { status: RosterStatus }) {
  return (
    <Badge variant="outline" className={`shrink-0 whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {ROSTER_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "Send / send another": emails and pushes the client, and makes the popup return if they'd already signed. */
export function SendAgreementDialog({
  clientId,
  clientName,
  alreadySigned,
  open,
  onOpenChange,
}: {
  clientId: string;
  clientName: string;
  alreadySigned: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const request = useServerFn(adminRequestAgreement);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => request({ data: { clientId, note: note.trim() || undefined } }),
    onSuccess: (result) => {
      const channels = [
        result.emailed ? "email" : null,
        result.pushed > 0 ? "push notification" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      toast.success(
        channels
          ? `Sent to ${clientName} by ${channels}`
          : `${clientName} will be asked to sign next time they open the app`,
      );
      queryClient.invalidateQueries({ queryKey: [ADMIN_AGREEMENT_QUERY_ROOT] });
      setNote("");
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't send the agreement"),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent showBackButton={false} className="max-w-md">
        <DialogHeader className="pl-0">
          <DialogTitle>
            {alreadySigned ? "Send another agreement" : "Send the agreement"}
          </DialogTitle>
          <DialogDescription>
            {alreadySigned
              ? `${clientName} will be asked to review and sign again. Their earlier signed copy stays on file.`
              : `${clientName} gets an email and a notification, and sees the agreement on their dashboard and each time they open the app until it's signed.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="agreement-note">Note to the client (optional)</Label>
          <Textarea
            id="agreement-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. I added in-person training to your plan, so please sign the updated agreement."
            className="min-h-[96px] text-base"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send to client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Escape hatch for the mandatory popup: signed on paper, or no signature needed. */
export function ExemptDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setExemption = useServerFn(adminSetAgreementExemption);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ExemptKind>("offline_signed");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => setExemption({ data: { clientId, kind, note: note.trim() || undefined } }),
    onSuccess: () => {
      toast.success(`${clientName} will no longer be asked to sign`);
      queryClient.invalidateQueries({ queryKey: [ADMIN_AGREEMENT_QUERY_ROOT] });
      setNote("");
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  const options: { value: ExemptKind; title: string; text: string }[] = [
    {
      value: "offline_signed",
      title: "Signed on paper or elsewhere",
      text: "You have their signed agreement on file outside the app.",
    },
    {
      value: "not_required",
      title: "Not required",
      text: "Staff, a test account, or someone who doesn't need to sign.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent showBackButton={false} className="max-w-md">
        <DialogHeader className="pl-0">
          <DialogTitle>Stop asking {clientName} to sign</DialogTitle>
          <DialogDescription>
            This removes the popup and dashboard reminder for this client. You can undo it any time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2" role="radiogroup" aria-label="Reason">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={kind === o.value}
              onClick={() => setKind(o.value)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                kind === o.value ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.text}</span>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="exempt-note">Note (optional)</Label>
          <Textarea
            id="exempt-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. Signed the printed agreement at the gym on Oct 3."
            className="min-h-[80px] text-base"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}
