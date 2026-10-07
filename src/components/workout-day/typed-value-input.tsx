import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { validateSetField } from "@/lib/set-input-cascade";

/**
 * Reps / RPE / RIR entry for the set logger — the cell IS the input, same
 * model as WeightValueInput:
 *  - tap → the same cell becomes a text box with the number keyboard;
 *  - the old value shows as the placeholder, so typing simply replaces it;
 *  - keyboard Done commits; leaving the cell commits a VALID draft and
 *    restores the stored value otherwise (a blank draft never wipes a value);
 *  - Done on an empty box clears the field (RPE is optional).
 * One draft, one commit path: no per-keystroke saves or cascades.
 */
export function TypedValueInput({
  value,
  displayValue,
  kind,
  onCommit,
  ariaLabel,
  disabled = false,
  focusMode = false,
  empty = "—",
}: {
  /** Stored value as typed in this field's terms (RIR for RIR rows). */
  value: string;
  /** Optional closed-cell display override. */
  displayValue?: string;
  kind: "reps" | "rpe" | "rir";
  /** Called once per commit with the validated value ("" = clear). */
  onCommit: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  focusMode?: boolean;
  empty?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committingRef = useRef(false);
  const hasValue = value !== "";
  const cellHeight = focusMode ? "h-9" : "h-8";

  const start = () => {
    if (disabled) return;
    committingRef.current = false;
    setTyped("");
    setError(null);
    setEditing(true);
  };
  const close = () => {
    setEditing(false);
    setTyped("");
    setError(null);
  };
  const commit = (next: string) => {
    committingRef.current = true;
    inputRef.current?.blur();
    close();
    if (next !== value) onCommit(next);
  };
  const submit = () => {
    const res = validateSetField(kind, typed);
    if (!res.ok) { setError(res.error); return; }
    commit(res.value);
  };
  const onBlur = () => {
    if (committingRef.current) return;
    if (typed.trim() === "") { close(); return; }
    const res = validateSetField(kind, typed);
    if (!res.ok) { close(); return; }
    commit(res.value);
  };

  return (
    <div className="relative w-full">
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="w-full">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            inputMode={kind === "reps" ? "numeric" : "decimal"}
            enterKeyHint="done"
            value={typed}
            placeholder={hasValue ? (displayValue ?? value) : ""}
            onChange={(e) => {
              const cleaned = kind === "reps"
                ? e.target.value.replace(/[^0-9]/g, "").slice(0, 3)
                : e.target.value.replace(/[^0-9.,]/g, "").slice(0, 4);
              setTyped(cleaned);
              setError(null);
            }}
            onBlur={onBlur}
            aria-label={ariaLabel}
            aria-invalid={!!error}
            className={cn(
              "w-full rounded-md border border-primary bg-background px-2 text-center text-sm font-semibold tabular-nums text-foreground outline-none ring-2 ring-primary/30 placeholder:text-muted-foreground/50",
              cellHeight,
              focusMode && "text-base",
              error && "border-destructive ring-destructive/30",
            )}
          />
        </form>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={start}
          aria-label={ariaLabel}
          className={cn(
            "flex w-full items-center justify-center whitespace-nowrap rounded-md border px-2 text-sm font-medium tabular-nums transition-colors",
            cellHeight,
            focusMode && "text-base",
            hasValue
              ? "border-border/60 bg-muted/40 text-foreground"
              : "border-blue-500/40 bg-blue-500/10 text-muted-foreground",
            !disabled && "cursor-text hover:bg-muted/60",
          )}
        >
          {hasValue ? (displayValue ?? value) : empty}
        </button>
      )}
      {error && editing && (
        <div role="alert" className="absolute left-0 right-0 top-full z-10 mt-0.5 text-center text-[10px] font-medium text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
