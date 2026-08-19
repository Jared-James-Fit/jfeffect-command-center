import { useState } from "react";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";

export default function DeferredExerciseHistorySheet({
  clientId,
  exerciseId,
  exerciseName,
  displayUnit,
  currentDayIndex,
  onClose,
}: {
  clientId: string;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  currentDayIndex?: number | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <ExerciseHistorySheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClose();
      }}
      clientId={clientId}
      exerciseId={exerciseId}
      exerciseName={exerciseName}
      displayUnit={displayUnit}
      currentDayIndex={currentDayIndex}
    />
  );
}
