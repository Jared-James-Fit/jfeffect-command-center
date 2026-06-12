import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type UndoAction = {
  /** Short human label for tooltips / debugging, e.g. "Edited weight". */
  label: string;
  /** Inverse operation. May be async. Should restore prior UI + persisted state. */
  undo: () => void | Promise<void>;
  /** Optional grouping key — consecutive actions with the same key collapse. */
  coalesceKey?: string;
  /** Auto-coalesce within N ms when keys match. Default 600ms. */
  coalesceMs?: number;
};

type Ctx = {
  push: (action: UndoAction) => void;
  undo: () => Promise<void>;
  canUndo: boolean;
  size: number;
  clear: () => void;
};

const UndoCtx = createContext<Ctx | null>(null);

const MAX_STACK = 20;

export function WorkoutUndoProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<(UndoAction & { at: number })[]>([]);
  const [size, setSize] = useState(0);

  const push = useCallback((action: UndoAction) => {
    const stack = stackRef.current;
    const last = stack[stack.length - 1];
    const at = Date.now();
    if (
      last &&
      action.coalesceKey &&
      last.coalesceKey === action.coalesceKey &&
      at - last.at <= (action.coalesceMs ?? 600)
    ) {
      // Keep the older undo (which restores the earlier state).
      last.at = at;
      return;
    }
    stack.push({ ...action, at });
    if (stack.length > MAX_STACK) stack.splice(0, stack.length - MAX_STACK);
    setSize(stack.length);
  }, []);

  const undo = useCallback(async () => {
    const stack = stackRef.current;
    const top = stack.pop();
    setSize(stack.length);
    if (!top) {
      toast("Nothing to undo");
      return;
    }
    try {
      await top.undo();
      toast("Last action undone", { description: top.label });
    } catch (e: any) {
      toast.error("Undo failed", { description: e?.message ?? String(e) });
    }
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    setSize(0);
  }, []);

  return (
    <UndoCtx.Provider value={{ push, undo, canUndo: size > 0, size, clear }}>
      {children}
    </UndoCtx.Provider>
  );
}

export function useWorkoutUndo(): Ctx {
  const ctx = useContext(UndoCtx);
  if (!ctx) {
    // Safe no-op fallback so child components don't crash outside a provider.
    return {
      push: () => {},
      undo: async () => {},
      canUndo: false,
      size: 0,
      clear: () => {},
    };
  }
  return ctx;
}

export function UndoButton({
  className,
  size = "sm",
  variant = "outline",
}: {
  className?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary";
}) {
  const { undo, canUndo, size: stackSize } = useWorkoutUndo();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={!canUndo}
      onClick={() => void undo()}
      className={cn("gap-1.5", className)}
      aria-label="Undo last action"
      title={canUndo ? `Undo (${stackSize} action${stackSize === 1 ? "" : "s"})` : "Nothing to undo"}
    >
      <Undo2 className="h-4 w-4" />
      <span>Undo</span>
    </Button>
  );
}