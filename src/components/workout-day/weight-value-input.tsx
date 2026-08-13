import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WEIGHT_CAP,
  WEIGHT_STEP,
  validateTypedWeight,
  type WUnit,
} from "@/lib/workout-weight-input";
import { formatLoadDisplay, type LoadType } from "@/lib/workout-load-type";

/**
 * Weight entry for the set logger — the WT cell IS the input.
 *
 * RELIABILITY RULES (do not reintroduce the old detached-sheet design):
 *  - normal numeric weight is typed DIRECTLY into the set-table cell. There is
 *    never a second numeric field visible at the same time.
 *  - exactly ONE draft state for the number (`typed`), seeded synchronously in
 *    the tap gesture. No effect ever writes to it, so cascade / autosave /
 *    refetch can't clobber what the user is typing.
 *  - exactly ONE commit path (`commitWeight`). Nothing persists until commit:
 *    no per-keystroke autosave, no per-keystroke cascade or completion.
 *  - keyboard Done (form submit) commits, blurs and closes in one step.
 *  - blurring/aborting without submitting restores the stored value.
 *
 * The small chevron on the right edge changes LOAD TYPE only
 * (Weight / Bodyweight / Assisted). Units stay on the card's KG/LB toggle and
 * input method is always typing — there is no +/− load "type".
 *
 * UNIT: read-only, from the workout card's KG/LB toggle. No local unit state,
 * no conversion here.
 */

type SheetMode = "options" | "confirm";

export function WeightValueInput({
  value,
  isBodyweight,
  loadType = isBodyweight ? "bodyweight" : "external",
  unit,
  onPick,
  disabled = false,
  focusMode = false,
  ariaLabel,
  referenceWeight = null,
}: {
  value: string;
  isBodyweight: boolean;
  /** external | bodyweight | assisted — assisted means the number is assistance. */
  loadType?: LoadType;
  unit: WUnit;
  /** `{ load: "", bodyweight: false, loadType: "external" }` clears. */
  onPick: (next: { load: string; bodyweight: boolean; loadType: LoadType }) => void;
  disabled?: boolean;
  focusMode?: boolean;
  ariaLabel: string;
  /** Prescribed / Last Time / previous best reference for the +/− start value. */
  referenceWeight?: number | null;
}) {
  /** Inline editing of the actual cell. */
  const [editing, setEditing] = useState(false);
  /** THE single numeric draft. Only user input and the open handler write it. */
  const [typed, setTyped] = useState("");
  const [draftType, setDraftType] = useState<LoadType>("external");
  const [error, setError] = useState<string | null>(null);
  /** Secondary sheet — options / bodyweight / +− / above-cap confirm only. */
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [confirmValue, setConfirmValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Set while committing so the resulting blur doesn't fire the cancel path. */
  const committingRef = useRef(false);

  const step = WEIGHT_STEP[unit];
  const cap = WEIGHT_CAP[unit];
  const numeric = value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const shown = formatLoadDisplay(value, loadType, unit, { compact: true });
  const isEmpty = loadType !== "bodyweight" && value === "";

  // Remembered values per load type — external weight and assistance never
  // borrow each other's number.
  const memoExternal = useRef<number | null>(null);
  const memoAssist = useRef<number | null>(null);
  useEffect(() => {
    if (numeric == null) return;
    if (loadType === "assisted") memoAssist.current = numeric;
    else if (loadType === "external") memoExternal.current = numeric;
  }, [numeric, loadType]);

  /**
   * Tap the cell → the same cell becomes editable. Seeded synchronously inside
   * the tap gesture so iOS/PWA raises the keyboard on the first tap, and the
   * draft starts blank for instant replacement of an existing value.
   */
  const startEditing = (type?: LoadType) => {
    if (disabled) return;
    committingRef.current = false;
    setTyped("");
    setError(null);
    setConfirmValue(null);
    setSheet(null);
    setDraftType(type ?? (loadType === "assisted" ? "assisted" : "external"));
    setEditing(true);
  };

  /** Abort without writing: the stored value survives. */
  const cancelEditing = () => {
    setEditing(false);
    setTyped("");
    setError(null);
  };

  /**
   * Deterministic blur behaviour (iOS can dismiss the keyboard without a
   * form submit): a VALID draft commits through the same canonical path,
   * a blank or invalid draft restores the stored value. The cell is never
   * left in a half-edited state, and a blank draft never destroys the
   * saved weight — clearing is an explicit action in the options menu.
   */
  const handleBlur = () => {
    if (committingRef.current) return;
    const draft = typed.trim();
    if (draft === "") { cancelEditing(); return; }
    const res = validateTypedWeight(draft, unit);
    if (!res.ok || res.aboveCap) { cancelEditing(); return; }
    commitWeight({ load: String(res.value), bodyweight: false, loadType: numericType });
  };

  const closeSheet = () => {
    setSheet(null);
    setConfirmValue(null);
  };

  /**
   * THE canonical commit. Every successful confirmation — keyboard Done,
   * +/− Done, Bodyweight, Clear, above-cap confirm — funnels through here.
   * Optimistic by construction: onPick updates local row state immediately and
   * the existing autosave/cascade/auto-complete run downstream of it.
   */
  const commitWeight = (next: { load: string; bodyweight: boolean; loadType: LoadType }) => {
    const n = next.load === "" ? null : Number(next.load);
    if (n != null && Number.isFinite(n)) {
      if (next.loadType === "assisted") memoAssist.current = n;
      else if (next.loadType === "external") memoExternal.current = n;
    }
    committingRef.current = true;
    inputRef.current?.blur();
    setEditing(false);
    setTyped("");
    setSheet(null);
    setConfirmValue(null);
    setError(null);
    onPick(next);
  };

  const numericType: LoadType = draftType === "assisted" ? "assisted" : "external";

  /** Keyboard Done / form submit. */
  const submitTyped = () => {
    if (typed.trim() === "") { cancelEditing(); return; }
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    if (res.aboveCap) {
      committingRef.current = true;
      inputRef.current?.blur();
      setEditing(false);
      setConfirmValue(res.value);
      setSheet("confirm");
      return;
    }
    commitWeight({ load: String(res.value), bodyweight: false, loadType: numericType });
  };

  const openOptions = () => {
    if (disabled) return;
    committingRef.current = true; // suppress the blur-cancel from leaving the input
    inputRef.current?.blur();
    setEditing(false);
    setDraftType(loadType === "assisted" ? "assisted" : "external");
    setSheet("options");
  };

  /** Load type actions — exactly one is active at a time. */
  const chooseWeight = () => {
    setSheet(null);
    if (loadType !== "external") {
      onPick({ load: "", bodyweight: false, loadType: "external" });
    }
    startEditing("external");
  };
  const chooseBodyweight = () => {
    setError(null);
    commitWeight({ load: "0", bodyweight: true, loadType: "bodyweight" });
  };
  const chooseAssisted = () => {
    setSheet(null);
    if (loadType !== "assisted") {
      onPick({ load: "", bodyweight: false, loadType: "assisted" });
    }
    startEditing("assisted");
  };

  const typeRow = (type: LoadType, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={cn(optionItem, "flex items-center gap-2")}>
      <span className="flex h-3.5 w-3.5 items-center justify-center text-primary">
        {loadType === type ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      {label}
    </button>
  );

  const optionsList = (
    // LOAD TYPE ONLY. Never units, never input method.
    <div className="space-y-1">
      {typeRow("external", "Weight", chooseWeight)}
      {typeRow("bodyweight", "Bodyweight", chooseBodyweight)}
      {typeRow("assisted", "Assisted", chooseAssisted)}
      {(loadType !== "external" || value !== "") && (
        <button
          type="button"
          onClick={() => commitWeight({ load: "", bodyweight: false, loadType: "external" })}
          className={cn(optionItem, "mt-1 border-t border-border/50 pt-1 text-muted-foreground hover:text-destructive")}
        >
          <span className="inline-flex items-center gap-1"><Eraser className="h-3 w-3" /> Clear weight</span>
        </button>
      )}
    </div>
  );

  const cancelBtn = (
    <button
      type="button"
      onClick={closeSheet}
      className="h-9 w-full rounded-md text-[11px] font-semibold text-muted-foreground hover:text-foreground"
    >
      Cancel
    </button>
  );

  const sheetBody = (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {sheet === "confirm" ? "Confirm weight" : "Load type"}
      </div>

      {sheet === "confirm" && confirmValue != null ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="text-[12px] font-medium text-foreground">
            This is above the normal weight cap ({cap} {unit}). Save anyway?
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => commitWeight({ load: String(confirmValue), bodyweight: false, loadType: numericType })}
              className="h-9 flex-1 rounded-md bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Save anyway
            </button>
            <button
              type="button"
              onClick={() => { setConfirmValue(null); setSheet(null); startEditing(numericType); }}
              className="h-9 flex-1 rounded-md border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              Edit weight
            </button>
          </div>
        </div>
      ) : (
        <>
          {optionsList}
          {cancelBtn}
        </>
      )}
    </div>
  );

  const cellHeight = focusMode ? "h-9" : "h-8";

  return (
    <>
      <div className="relative w-full">
        {editing ? (
          // The SAME cell, now editable. Identical box dimensions — the row
          // never grows or shifts while typing.
          <form
            onSubmit={(e) => { e.preventDefault(); submitTyped(); }}
            className="w-full"
          >
            <input
              ref={inputRef}
              autoFocus
              inputMode="decimal"
              type="text"
              enterKeyHint="done"
              value={typed}
              onChange={(e) => { setTyped(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
              onBlur={handleBlur}
              placeholder={draftType === "assisted" ? "assist" : ""}
              aria-label={`${ariaLabel} — ${draftType === "assisted" ? "assistance" : "weight"} in ${unit}`}
              className={cn(
                "w-full rounded-md border border-primary bg-background px-2 text-center text-sm font-semibold tabular-nums text-foreground outline-none ring-2 ring-primary/30",
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
            aria-label={ariaLabel}
            onClick={() => startEditing()}
            className={cn(
              "flex w-full items-center justify-center whitespace-nowrap rounded-md border pl-2 pr-5 text-sm font-medium transition-colors",
              cellHeight,
              focusMode && "text-base",
              loadType === "bodyweight" && "text-[10px] font-semibold uppercase tracking-tight",
              loadType === "assisted" && "border-amber-500/50 bg-amber-500/10",
              isEmpty
                ? "border-blue-500/40 bg-blue-500/10 text-muted-foreground"
                : "border-border/60 bg-muted/40 text-foreground",
              !disabled && "cursor-pointer hover:bg-muted/60",
            )}
          >
            {shown}
          </button>
        )}
        {/* Small secondary control — Bodyweight / Assisted / +− live here so
            they never interfere with tapping the main numeric area. */}
        {!disabled && (
          <button
            type="button"
            aria-label={`${ariaLabel} — change load type`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openOptions}
            className="absolute right-0 top-0 flex h-full w-5 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>
      {loadType === "assisted" && !editing && (
        <div className="mt-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-amber-600">
          Assisted
        </div>
      )}
      {error && editing && (
        <div className="mt-0.5 text-[10px] font-medium text-destructive">{error}</div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={ariaLabel}>
          <button
            type="button"
            aria-label="Close load options"
            tabIndex={-1}
            className="absolute inset-0 bg-black/50"
            onClick={closeSheet}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-background p-2.5 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:bottom-auto sm:top-1/2 sm:w-[15rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
            style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
            {sheetBody}
          </div>
        </div>
      )}
    </>
  );
}

const optionItem =
  "h-9 w-full rounded-md px-2 text-left text-[12px] font-semibold text-foreground hover:bg-muted/60";
