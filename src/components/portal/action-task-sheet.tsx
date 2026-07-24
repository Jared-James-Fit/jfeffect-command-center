import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { completeTaskOccurrence, type ActionCentreItem } from "@/lib/action-centre.functions";

type TaskTarget = { label: string; to: string; params?: Record<string, string>; search?: Record<string, unknown> } | null;

/** Route each task_type to its natural destination inside the portal. */
function targetForTask(item: ActionCentreItem): TaskTarget {
  const meta = (item.metadata ?? {}) as Record<string, any>;
  switch (item.task_type) {
    case "weekly_checkin":
    case "nutrition_review":
    case "custom_form": {
      const formId = meta.form_id as string | undefined;
      return formId
        ? { label: "Open form", to: "/portal/check-ins/$formId", params: { formId } }
        : { label: "Open check-ins", to: "/portal/check-ins" };
    }
    case "progress_photos":
      return { label: "Upload photos", to: "/portal/progress" };
    case "monthly_assessment":
      return { label: "Open assessment", to: "/portal/progress-metrics" };
    case "bodyweight":
      return { label: "Log bodyweight", to: "/portal" };
    case "technique_review":
      return { label: "View coach feedback", to: "/portal/lift-videos" as any };
    default:
      return null;
  }
}

const TONE_TO_CHIP: Record<ActionCentreItem["chip"]["tone"], string> = {
  success: "bg-emerald-500/15 text-emerald-500",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-primary/15 text-primary",
  muted: "bg-muted text-muted-foreground",
};

export function ActionTaskSheet({
  item,
  open,
  onOpenChange,
  onCompleted,
}: {
  item: ActionCentreItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCompleted?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const complete = useServerFn(completeTaskOccurrence);
  const [pending, setPending] = useState(false);

  const mutation = useMutation({
    mutationFn: (occurrenceId: string) => complete({ data: { occurrenceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action-centre"] });
    },
  });

  if (!item) return null;
  const target = targetForTask(item);

  const handleOpen = () => {
    if (!target) return;
    onOpenChange(false);
    navigate({ to: target.to as any, params: target.params as any, search: target.search as any });
  };

  const handleMarkDone = async () => {
    setPending(true);
    try {
      await mutation.mutateAsync(item.id);
      onCompleted?.(item.id);
      toast.success("Marked as done");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not mark done");
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2">
            <span className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
              TONE_TO_CHIP[item.chip.tone],
            )}>
              {item.chip.label}
            </span>
            {item.is_coach_requested && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                Coach requested
              </span>
            )}
          </div>
          <SheetTitle className="text-xl">{item.title}</SheetTitle>
          {item.subtitle ? <SheetDescription>{item.subtitle}</SheetDescription> : null}
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2">
          {target && (
            <Button
              onClick={handleOpen}
              className="h-12 w-full justify-between text-base"
              disabled={pending}
            >
              <span>{target.label}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleMarkDone}
            disabled={pending}
            className="h-12 w-full justify-center text-base"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Mark as done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}