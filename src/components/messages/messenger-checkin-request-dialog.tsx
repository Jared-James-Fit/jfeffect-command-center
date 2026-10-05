import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Loader2, Salad, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendNutritionRequestFn } from "@/lib/nutrition-ai-plans.functions";
import { NUTRITION_PHASES, PHASE_GOAL } from "@/lib/nutrition-cardio";
import type { WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";
import { WorkoutMealsSelect } from "@/components/nutrition/WorkoutMealsSelect";
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
import { durationFor } from "@/components/messages/messenger-checkin-card";
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
  const sendNutrition = useServerFn(sendNutritionRequestFn);
  const qc = useQueryClient();
  const [taskType, setTaskType] = useState<MessengerCheckinTaskType | "nutrition_update">("weekly_checkin");
  const [phase, setPhase] = useState<string>("__auto");
  const [workoutMeals, setWorkoutMeals] = useState<WorkoutMealsMode>("auto");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      if (taskType === "nutrition_update") {
        await sendNutrition({ data: { clientId, note: note.trim() || null, phase: phase === "__auto" ? null : phase, workoutMeals } });
        qc.invalidateQueries({ queryKey: ["nutrition-requests", clientId] });
      } else {
        await send({
          data: {
            clientId,
            taskType,
            note: note.trim() || null,
          },
        });
      }
      await qc.invalidateQueries({ queryKey: ["messages", clientId, "admin"] });
      toast.success(
        taskType === "weekly_checkin" ? "Check-in sent" : taskType === "nutrition_update" ? "Nutrition update request sent" : "Nutrition review sent",
      );
      setNote("");
      setTaskType("weekly_checkin");
      setPhase("__auto");
      setWorkoutMeals("auto");
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
          <DialogTitle>Send a check-in or form</DialogTitle>
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
            <div className="text-xs text-muted-foreground">{durationFor("weekly_checkin")}</div>
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
            <div className="text-xs text-muted-foreground">{durationFor("nutrition_review")}</div>
            <div className="mt-1 text-xs text-muted-foreground">Adherence, hunger, digestion, energy + changes.</div>
          </button>
          <button
            type="button"
            onClick={() => setTaskType("nutrition_update")}
            className={cn(
              "col-span-2 rounded-2xl border p-4 text-left transition active:scale-[0.98]",
              taskType === "nutrition_update"
                ? "border-primary bg-primary/10"
                : "border-border bg-card",
            )}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <div className="text-sm font-bold">Nutrition Update</div>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">AI plan</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              About 3–4 minutes · AI builds new calorie, macro & cardio targets and a paste-ready meal plan for you.
            </div>
          </button>
        </div>

        {taskType === "nutrition_update" && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Phase / goal</div>
            <Select value={phase} onValueChange={setPhase}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto">Let the client's answer decide</SelectItem>
                {NUTRITION_PHASES.filter((p) => p !== "Custom").map((p) => (
                  <SelectItem key={p} value={p}>{p}<span className="text-muted-foreground"> · {PHASE_GOAL[p]}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">Pre / Post-Workout meals</div>
            <WorkoutMealsSelect value={workoutMeals} onChange={setWorkoutMeals} />
          </div>
        )}

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
