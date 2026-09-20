import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Loader2, Salad } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  sendMessengerCheckinRequest,
  type MessengerCheckinTaskType,
} from "@/lib/messenger-checkins.functions";

export function MessengerCheckinRequestDialog({
  open,
  onOpenChange,
  clientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}) {
  const send = useServerFn(sendMessengerCheckinRequest);
  const qc = useQueryClient();
  const [taskType, setTaskType] = useState<MessengerCheckinTaskType>("weekly_checkin");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      await send({
        data: {
          clientId,
          taskType,
          note: note.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: ["messages", clientId, "admin"] });
      toast.success(taskType === "weekly_checkin" ? "Check-in sent" : "Nutrition review sent");
      setNote("");
      setTaskType("weekly_checkin");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send check-in");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send a check-in</DialogTitle>
          <DialogDescription>
            The client answers it right inside Messages. No form page or external link.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTaskType("weekly_checkin")}
            className={cn(
              "rounded-2xl border p-4 text-left transition active:scale-[0.98]",
              taskType === "weekly_checkin"
                ? "border-primary bg-primary/10"
                : "border-border bg-card",
            )}
          >
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <div className="mt-3 text-sm font-bold">Weekly Check-In</div>
            <div className="mt-1 text-xs text-muted-foreground">Training, nutrition, recovery + new-week focus.</div>
          </button>

          <button
            type="button"
            onClick={() => setTaskType("nutrition_review")}
            className={cn(
              "rounded-2xl border p-4 text-left transition active:scale-[0.98]",
              taskType === "nutrition_review"
                ? "border-primary bg-primary/10"
                : "border-border bg-card",
            )}
          >
            <Salad className="h-5 w-5 text-primary" />
            <div className="mt-3 text-sm font-bold">Nutrition Review</div>
            <div className="mt-1 text-xs text-muted-foreground">Adherence, hunger, digestion, energy + changes.</div>
          </button>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Add a note (optional)</div>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything specific you want them to think about?"
            className="resize-none"
          />
        </div>

        <DialogFooter>
          <Button
            className="h-12 w-full font-bold"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send in Messages"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
