import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExerciseQuickCreateForm } from "@/components/exercises/exercise-quick-create-form";
import { useIsCoarsePointer, useVisualViewportHeight } from "@/hooks/use-touch-viewport";

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
  const coarsePointer = useIsCoarsePointer();
  const viewportHeight = useVisualViewportHeight();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        // Size off the visual viewport so the form stays scrollable above the
        // Android soft keyboard (vh/dvh do not shrink when it opens).
        style={viewportHeight ? { maxHeight: Math.max(240, viewportHeight - 32) } : { maxHeight: "90dvh" }}
        // Never grab focus on touch — Android's focus/autofill race leaves the
        // keyboard open over a field that cannot receive keystrokes.
        onOpenAutoFocus={(e) => { if (coarsePointer) e.preventDefault(); }}
      >
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
