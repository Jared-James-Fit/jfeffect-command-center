import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExerciseQuickCreateForm } from "@/components/exercises/exercise-quick-create-form";

/**
 * Quick add from search surfaces (Quick Swap, inline editor, builder).
 * Only the name is required — see ExerciseQuickCreateForm.
 */
export function QuickAddExerciseDialog({
  open,
  onOpenChange,
  defaultName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the name field (e.g. current search query). */
  defaultName?: string;
  /** Called with the new exercise id after a successful insert. */
  onCreated?: (id: string, name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New exercise</DialogTitle>
        </DialogHeader>
        {open ? (
          <ExerciseQuickCreateForm
            defaultName={defaultName}
            onCancel={() => onOpenChange(false)}
            onCreated={(id, name) => {
              onCreated?.(id, name);
              onOpenChange(false);
            }}
            submitLabel="Add"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
