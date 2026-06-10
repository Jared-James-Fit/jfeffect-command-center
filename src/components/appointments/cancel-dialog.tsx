import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cancelAppointment } from "@/lib/appointments.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail } from "lucide-react";
import { toast } from "sonner";

export function CancelAppointmentDialog({
  open, onOpenChange, appointment, onCancelled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  appointment: { id: string; title?: string; starts_at?: string; google_event_id?: string | null; client?: any; external_email?: string | null } | null;
  onCancelled?: () => void;
}) {
  const fn = useServerFn(cancelAppointment);
  const [reason, setReason] = useState("");
  const willEmail = !!(appointment?.google_event_id && (appointment?.external_email || appointment?.client?.email));

  const mut = useMutation({
    mutationFn: async () => {
      if (!appointment) return;
      return fn({ data: { id: appointment.id, reason: reason || undefined } });
    },
    onSuccess: () => {
      toast.success(willEmail ? "Cancelled — attendee will be notified by Google" : "Cancelled");
      setReason("");
      onCancelled?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cancel appointment</DialogTitle></DialogHeader>
        {appointment && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {appointment.title || "(appointment)"}
              {appointment.starts_at && <> · {new Date(appointment.starts_at).toLocaleString()}</>}
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Shared with the attendee in the Google cancellation email."
                rows={3}
              />
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground flex items-start gap-2">
              <Mail className="h-3.5 w-3.5 mt-0.5" />
              {willEmail
                ? "The attendee will be notified by email from Google Calendar."
                : "No Google Calendar invite was attached, so no email is sent. Any pending SMS reminders will be cancelled."}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}