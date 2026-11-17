/**
 * The program editor's Sheet view (desktop): a week (or one field across every
 * week) as plain cells, edited like Google Sheets. It reads and writes the same
 * payload as the card editor through `setWeeksData`, so a change is one undo
 * step, autosaves like any other edit and shows in the cards the moment you
 * switch back. What a cell means is program-sheet.ts (pure, tested).
 *
 * Keys: type to replace a cell · Enter / Shift+Enter down / up · Tab /
 * Shift+Tab across · arrows move (inside a cell you're typing in, ← → move the
 * caret until its edge) · Shift+arrows or drag select · Cmd/Ctrl+Enter fills
 * the selection with what you typed · Cmd/Ctrl+D fills down · Delete clears the
 * selection · Esc puts a cell back · Cmd/Ctrl+C / V copy and paste cells
 * to and from Google Sheets or Excel · Cmd/Ctrl+Z undo (outside a cell you're
 * typing in).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, Copy, Eraser, HelpCircle, MoreHorizontal, Plus, Repeat, Timer, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  SHEET_COLUMNS, applyCell, formatCell, isMultiCellPaste, isTimeRow, leadingNumber, newRowForExercise,
  parseTsv, patchSlot, progression, progressionText, rowAtSlot, toTsv, weekSlots,
  type SheetField,
} from "@/lib/program-sheet";

export type SheetPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  excludeId?: string | null;
  onPick: (exercise: any) => void;
  onCustomName?: (name: string) => void;
};

type Mode = "week" | "weeks";
type Pos = [number, number];
type Line =
  | { kind: "day"; key: string; dayIndex: number; label: string; sets: number; count: number }
  | { kind: "row"; key: string; r: number; dayIndex: number; pos: number; name: string; label: string | null };
type Loc = { weekIdx: number; dayIndex: number; pos: number; field: SheetField };

const MODE_KEY = "pb.sheet.mode:v1";
const FIELD_KEY = "pb.sheet.field:v1";

function readLocal<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: string) {
  try { window.localStorage.setItem(key, v); } catch { /* private window */ }
}

const STEP_DEFAULT: Partial<Record<SheetField, number>> = { rpe: 0.5, rir: -0.5, load: 2.5, sets: 0, reps: 0 };

export function ProgramSheet({
  weeksData,
  setWeeksData,
  activeIdx,
  exercises,
  loadHint,
  renderPicker,
}: {
  weeksData: any[];
  setWeeksData: (wd: any[]) => void;
  activeIdx: number;
  exercises: any[];
  /** what a % works out to for this client ("= 150 kg"), when there's a max */
  loadHint?: (row: any) => string | null;
  renderPicker: (p: SheetPickerProps) => React.ReactNode;
}) {
  const [mode, setModeState] = useState<Mode>(() => readLocal(MODE_KEY, ["week", "weeks"] as const, "week"));
  const [field, setFieldState] = useState<SheetField>(() =>
    readLocal(FIELD_KEY, SHEET_COLUMNS.map((c) => c.key), "rpe"),
  );
  const setMode = (m: Mode) => { setModeState(m); writeLocal(MODE_KEY, m); setSel(null); };
  const setField = (f: SheetField) => { setFieldState(f); writeLocal(FIELD_KEY, f); };

  const exById = useMemo(() => new Map((exercises ?? []).map((e: any) => [e.id, e])), [exercises]);
  const nameOf = useCallback(
    (row: any) => (row?.exercise_id ? exById.get(row.exercise_id)?.name : null) ?? row?.exercise_name_override ?? "",
    [exById],
  );

  const week = weeksData[activeIdx] ?? null;
  const slots = useMemo(() => weekSlots(weeksData, nameOf), [weeksData, nameOf]);

  // ── the grid: lines (day headers and rows) and columns ──────────────────
  const { lines, rowLines } = useMemo(() => {
    const out: Line[] = [];
    let r = 0;
    if (mode === "week") {
      for (const d of week?.days ?? []) {
        const di = Number(d?.day_index ?? 0);
        const rows: any[] = d?.rows ?? [];
        const title = String(d?.subtitle || d?.title || "").trim();
        out.push({
          kind: "day",
          key: `d${di}`,
          dayIndex: di,
          label: title ? `Day ${di} · ${title}` : `Day ${di}`,
          sets: rows.reduce((n, x) => n + (Number(x?.sets) || 0), 0),
          count: rows.length,
        });
        rows.forEach((row, pos) => {
          out.push({ kind: "row", key: `r${di}:${pos}`, r: r++, dayIndex: di, pos, name: nameOf(row), label: row?.purpose_label ?? null });
        });
      }
    } else {
      let lastDay: number | null = null;
      for (const s of slots) {
        if (s.dayIndex !== lastDay) {
          out.push({ kind: "day", key: `d${s.dayIndex}`, dayIndex: s.dayIndex, label: s.dayLabel, sets: 0, count: 0 });
          lastDay = s.dayIndex;
        }
        out.push({ kind: "row", key: `s${s.key}`, r: r++, dayIndex: s.dayIndex, pos: s.pos, name: s.name, label: null });
      }
    }
    return { lines: out, rowLines: out.filter((l): l is Extract<Line, { kind: "row" }> => l.kind === "row") };
  }, [mode, week, slots, nameOf]);

  const cols = mode === "week" ? SHEET_COLUMNS.length : weeksData.length;
  const nRows = rowLines.length;

  const locOf = useCallback(
    (r: number, c: number): Loc | null => {
      const line = rowLines[r];
      if (!line || c < 0 || c >= cols) return null;
      if (mode === "week") return { weekIdx: activeIdx, dayIndex: line.dayIndex, pos: line.pos, field: SHEET_COLUMNS[c].key };
      return { weekIdx: c, dayIndex: line.dayIndex, pos: line.pos, field };
    },
    [rowLines, cols, mode, activeIdx, field],
  );
  const rowOf = useCallback(
    (loc: Loc | null, wd = weeksData) => (loc ? rowAtSlot(wd[loc.weekIdx], loc) : null),
    [weeksData],
  );
  const textAt = (r: number, c: number) => {
    const loc = locOf(r, c);
    const row = rowOf(loc);
    return row && loc ? formatCell(row, loc.field) : "";
  };

  // ── selection ────────────────────────────────────────────────────────────
  const [sel, setSel] = useState<{ a: Pos; b: Pos } | null>(null);
  // Drag to select: a text box keeps the mouse while its button is down, so
  // the cell under the pointer is found from the window, not the cell's own events.
  const dragging = useRef<Pos | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const from = dragging.current;
      if (!from || !(e.buttons & 1)) return;
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-sheet-r]");
      if (!el || !rootRef.current?.contains(el)) return;
      const r = Number(el.dataset.sheetR);
      const c = Number(el.dataset.sheetC);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      if (r === from[0] && c === from[1]) return;
      // a range, not text: drop the text selection the drag started
      const active = document.activeElement as HTMLInputElement | null;
      if (active?.hasAttribute("data-sheet-cell")) active.setSelectionRange(active.value.length, active.value.length);
      e.preventDefault();
      setSel((prev) => ({ a: prev?.a ?? from, b: [r, c] }));
    };
    const up = () => { dragging.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  const box = sel
    ? {
        r0: Math.min(sel.a[0], sel.b[0]), r1: Math.max(sel.a[0], sel.b[0]),
        c0: Math.min(sel.a[1], sel.b[1]), c1: Math.max(sel.a[1], sel.b[1]),
      }
    : null;
  const multi = !!box && (box.r0 !== box.r1 || box.c0 !== box.c1);
  const inBox = (r: number, c: number) => !!box && r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusCell = useCallback((r: number, c: number) => {
    const el = rootRef.current?.querySelector<HTMLInputElement>(`input[data-sheet-r="${r}"][data-sheet-c="${c}"]`);
    if (el) {
      el.focus();
      el.select();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  // ── writing ──────────────────────────────────────────────────────────────
  const applyEdits = useCallback(
    (edits: Array<{ r: number; c: number; text: string }>): boolean => {
      let next = weeksData;
      const errors: string[] = [];
      for (const e of edits) {
        const loc = locOf(e.r, e.c);
        const row = rowOf(loc, next);
        if (!loc || !row) continue;
        if (formatCell(row, loc.field) === e.text.trim()) continue;
        const res = applyCell(row, loc.field, e.text);
        if ("error" in res) {
          const col = SHEET_COLUMNS.find((x) => x.key === loc.field)?.label ?? loc.field;
          errors.push(`${nameOf(row) || "Row"} · ${col}: ${res.error}`);
          continue;
        }
        next = patchSlot(next, loc.weekIdx, loc, res.patch);
      }
      if (next !== weeksData) setWeeksData(next);
      if (errors.length) toast.error(errors[0], { description: errors.length > 1 ? `and ${errors.length - 1} more` : undefined });
      return errors.length === 0;
    },
    [weeksData, setWeeksData, locOf, rowOf, nameOf],
  );

  const cellsOfBox = () => {
    const out: Pos[] = [];
    if (!box) return out;
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) out.push([r, c]);
    return out;
  };
  const fillSelection = (text: string) => {
    applyEdits(cellsOfBox().map(([r, c]) => ({ r, c, text })));
  };
  const clearSelection = () => {
    applyEdits(cellsOfBox().map(([r, c]) => ({ r, c, text: "" })));
  };
  const fillDown = (from?: Pos) => {
    if (multi && box) {
      const edits: Array<{ r: number; c: number; text: string }> = [];
      for (let c = box.c0; c <= box.c1; c++) {
        const top = textAt(box.r0, c);
        for (let r = box.r0 + 1; r <= box.r1; r++) edits.push({ r, c, text: top });
      }
      applyEdits(edits);
    } else if (from && from[0] > 0) {
      applyEdits([{ r: from[0], c: from[1], text: textAt(from[0] - 1, from[1]) }]);
    }
  };
  const fillRight = () => {
    if (!box) return;
    const edits: Array<{ r: number; c: number; text: string }> = [];
    const c1 = multi ? box.c1 : cols - 1;
    for (let r = box.r0; r <= box.r1; r++) {
      const left = textAt(r, box.c0);
      for (let c = box.c0 + 1; c <= c1; c++) edits.push({ r, c, text: left });
    }
    applyEdits(edits);
  };
  const pasteGrid = (text: string, at: Pos) => {
    const grid = parseTsv(text);
    // one value over a selection fills it, Sheets' way
    if (grid.length === 1 && grid[0].length === 1 && multi) return fillSelection(grid[0][0]);
    const start: Pos = box ? [box.r0, box.c0] : at;
    const edits: Array<{ r: number; c: number; text: string }> = [];
    grid.forEach((line, i) => line.forEach((v, j) => {
      const r = start[0] + i;
      const c = start[1] + j;
      if (r < nRows && c < cols) edits.push({ r, c, text: v });
    }));
    applyEdits(edits);
    const r1 = Math.min(nRows - 1, start[0] + grid.length - 1);
    const c1 = Math.min(cols - 1, start[1] + Math.max(...grid.map((l) => l.length)) - 1);
    setSel({ a: start, b: [r1, c1] });
  };
  const selectionTsv = () => {
    if (!box) return "";
    const grid: string[][] = [];
    for (let r = box.r0; r <= box.r1; r++) {
      const line: string[] = [];
      for (let c = box.c0; c <= box.c1; c++) line.push(textAt(r, c));
      grid.push(line);
    }
    return toTsv(grid);
  };

  // ── rows (this week): add, swap, move, duplicate, delete ────────────────
  const setDayRows = (dayIndex: number, rows: (prev: any[]) => any[]) => {
    const next = weeksData.map((w, wi) =>
      wi !== activeIdx
        ? w
        : {
            ...w,
            days: (w.days ?? []).map((d: any) =>
              Number(d?.day_index) !== dayIndex ? d : { ...d, rows: rows(d.rows ?? []).map((x: any, i: number) => ({ ...x, sort_order: i })) },
            ),
          },
    );
    setWeeksData(next);
  };
  const [picker, setPicker] = useState<
    | { kind: "add"; dayIndex: number; at: number }
    | { kind: "swap"; weekIdx: number; dayIndex: number; pos: number; excludeId: string | null }
    | null
  >(null);
  const onPick = (ex: any) => {
    if (!picker) return;
    if (picker.kind === "add") {
      setDayRows(picker.dayIndex, (rows) => {
        const copy = [...rows];
        copy.splice(picker.at, 0, newRowForExercise(ex));
        return copy;
      });
    } else {
      setWeeksData(patchSlot(weeksData, picker.weekIdx, picker, { exercise_id: ex.id, exercise_name_override: ex.name }));
    }
    setPicker(null);
  };
  const onCustomName = (name: string) => {
    if (!picker) return;
    if (picker.kind === "add") {
      setDayRows(picker.dayIndex, (rows) => {
        const copy = [...rows];
        copy.splice(picker.at, 0, { ...newRowForExercise(null), exercise_id: null, exercise_name_override: name });
        return copy;
      });
    } else {
      setWeeksData(patchSlot(weeksData, picker.weekIdx, picker, { exercise_id: null, exercise_name_override: name }));
    }
    setPicker(null);
  };
  const moveRow = (dayIndex: number, pos: number, dir: -1 | 1) =>
    setDayRows(dayIndex, (rows) => {
      const to = pos + dir;
      if (to < 0 || to >= rows.length) return rows;
      const copy = [...rows];
      const [x] = copy.splice(pos, 1);
      copy.splice(to, 0, x);
      return copy;
    });
  const duplicateRow = (dayIndex: number, pos: number) =>
    setDayRows(dayIndex, (rows) => {
      const copy = [...rows];
      const { _dbId, ...rest } = JSON.parse(JSON.stringify(rows[pos] ?? {}));
      copy.splice(pos + 1, 0, rest);
      return copy;
    });
  const deleteRow = (dayIndex: number, pos: number) =>
    setDayRows(dayIndex, (rows) => rows.filter((_, i) => i !== pos));
  const toggleTime = (dayIndex: number, pos: number) =>
    setDayRows(dayIndex, (rows) =>
      rows.map((row, i) => {
        if (i !== pos) return row;
        if (isTimeRow(row)) {
          return {
            ...row,
            tracking_type: "reps_weight",
            measurement_type: "reps",
            duration_seconds_backup: row.duration_seconds ?? row.duration_seconds_backup ?? null,
            duration_seconds: null,
            reps_text: row.reps_text_backup ?? "",
          };
        }
        return {
          ...row,
          tracking_type: "time",
          measurement_type: "time",
          reps_text_backup: row.reps_text || row.reps_text_backup || null,
          reps_text: "",
          duration_seconds: row.duration_seconds_backup ?? null,
          load_kg: null,
          load_lb: null,
          percentage: null,
          percentage_basis: "none",
          manual_override: false,
        };
      }),
    );

  // ── keyboard, per cell ───────────────────────────────────────────────────
  const move = (from: Pos, dr: number, dc: number, extend: boolean) => {
    const r = Math.max(0, Math.min(nRows - 1, from[0] + dr));
    const c = Math.max(0, Math.min(cols - 1, from[1] + dc));
    if (extend) {
      const anchor = sel?.a ?? from;
      const corner = sel?.b ?? from;
      const nb: Pos = [Math.max(0, Math.min(nRows - 1, corner[0] + dr)), Math.max(0, Math.min(cols - 1, corner[1] + dc))];
      setSel({ a: anchor, b: nb });
      return;
    }
    setSel({ a: [r, c], b: [r, c] });
    focusCell(r, c);
  };

  const [progressOpen, setProgressOpen] = useState(false);

  if (!week && mode === "week") {
    return <p className="p-4 text-sm text-muted-foreground">No week to show.</p>;
  }

  const fieldLabel = SHEET_COLUMNS.find((c) => c.key === field)?.label ?? field;
  const canProgress = mode === "weeks" && !!box && box.c1 > box.c0 && field !== "notes" && field !== "tempo";

  return (
    <div ref={rootRef} className="space-y-2" data-program-sheet data-sheet-mode={mode}>
      {/* What the sheet shows, and what the selection can do */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Sheet" className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
          {([["week", `Week ${week?.week_index ?? activeIdx + 1}`], ["weeks", "Across weeks"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mode === v}
              onClick={() => setMode(v)}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                mode === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              data-sheet-tab={v}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "weeks" && (
          <div role="tablist" aria-label="Field across weeks" className="flex flex-wrap items-center gap-1">
            {SHEET_COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={field === c.key}
                onClick={() => setField(c.key)}
                className={cn(
                  "h-8 rounded-lg px-2.5 text-xs font-medium transition-colors",
                  field === c.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                data-sheet-field={c.key}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {box && (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground" data-sheet-selection>
              {(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)} cell{(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) === 1 ? "" : "s"}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!multi} onClick={() => fillDown()} title="Fill down (Cmd/Ctrl+D)">
            <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Fill down
          </Button>
          {mode === "weeks" && (
            <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!box} onClick={fillRight} title="Copy the first week's value to the weeks after it">
              <ArrowRight className="mr-1 h-3.5 w-3.5" /> {multi ? "Fill right" : "To later weeks"}
            </Button>
          )}
          {mode === "weeks" && (
            <Popover open={progressOpen} onOpenChange={setProgressOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!canProgress} title="Select a row across weeks, then set a start and a step">
                  <TrendingUp className="mr-1 h-3.5 w-3.5" /> Progression
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                {box && (
                  <ProgressionForm
                    field={field}
                    weeks={box.c1 - box.c0 + 1}
                    rows={box.r1 - box.r0 + 1}
                    onApply={(start, step) => {
                      const edits: Array<{ r: number; c: number; text: string }> = [];
                      for (let r = box.r0; r <= box.r1; r++) {
                        const first = start ?? leadingNumber(textAt(r, box.c0));
                        if (first == null) continue;
                        const values = progression(first, step, box.c1 - box.c0 + 1, field);
                        values.forEach((v, i) => {
                          const c = box.c0 + i;
                          const row = rowOf(locOf(r, c));
                          if (row) edits.push({ r, c, text: progressionText(row, field, v) });
                        });
                      }
                      applyEdits(edits);
                      setProgressOpen(false);
                    }}
                  />
                )}
              </PopoverContent>
            </Popover>
          )}
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!box} onClick={clearSelection} title="Clear the selected cells (Delete)">
            <Eraser className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
          <SheetKeysHelp />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" data-sheet-table>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <th className="sticky left-0 z-10 w-9 bg-muted/90 px-2 py-2 font-medium">#</th>
              <th className="sticky left-9 z-10 min-w-[13rem] bg-muted/90 px-2 py-2 font-medium">Exercise</th>
              {mode === "week"
                ? SHEET_COLUMNS.map((c) => (
                    <th key={c.key} className={cn("px-1.5 py-2 font-medium", c.width)} title={c.hint}>{c.label}</th>
                  ))
                : weeksData.map((w, wi) => (
                    <th key={wi} className="min-w-[6.5rem] px-1.5 py-2 font-medium" title={w.phase ? `${w.phase}` : undefined}>
                      <span className={cn(wi === activeIdx && "text-foreground")}>Week {w.week_index ?? wi + 1}</span>
                      {w.phase ? <span className="block truncate text-[10px] font-normal">{w.phase}</span> : null}
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={2 + cols} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No exercises yet. Add a day in the Week view, then add exercises here.
                </td>
              </tr>
            )}
            {lines.map((line) => {
              if (line.kind === "day") {
                return (
                  <tr key={line.key} className="border-b border-border bg-background" data-sheet-day={line.dayIndex}>
                    <td colSpan={2 + cols} className="px-2 pb-1 pt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{line.label}</span>
                        {mode === "week" && line.count > 0 && (
                          <span className="text-xs text-muted-foreground">{line.count} exercise{line.count === 1 ? "" : "s"} · {line.sets} set{line.sets === 1 ? "" : "s"}</span>
                        )}
                        {mode === "week" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-7 px-2 text-xs"
                            onClick={() => setPicker({ kind: "add", dayIndex: line.dayIndex, at: line.count })}
                            data-sheet-add={line.dayIndex}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" /> Add exercise
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }
              const { r } = line;
              const weekRow = mode === "week" ? rowAtSlot(week, line) : null;
              return (
                <tr key={line.key} className="group border-b border-border/60 last:border-b-0" data-sheet-row={r}>
                  <td className="sticky left-0 z-10 w-9 bg-background px-1 text-center align-middle">
                    {mode === "week" ? (
                      <RowMenu
                        n={line.pos + 1}
                        timed={isTimeRow(weekRow)}
                        first={line.pos === 0}
                        last={line.pos === (week?.days?.find((d: any) => Number(d?.day_index) === line.dayIndex)?.rows?.length ?? 1) - 1}
                        onSwap={() => setPicker({ kind: "swap", weekIdx: activeIdx, dayIndex: line.dayIndex, pos: line.pos, excludeId: weekRow?.exercise_id ?? null })}
                        onInsertBelow={() => setPicker({ kind: "add", dayIndex: line.dayIndex, at: line.pos + 1 })}
                        onDuplicate={() => duplicateRow(line.dayIndex, line.pos)}
                        onMove={(d) => moveRow(line.dayIndex, line.pos, d)}
                        onToggleTime={() => toggleTime(line.dayIndex, line.pos)}
                        onDelete={() => deleteRow(line.dayIndex, line.pos)}
                      />
                    ) : (
                      <span className="text-xs tabular-nums text-muted-foreground">{line.pos + 1}</span>
                    )}
                  </td>
                  <td className="sticky left-9 z-10 min-w-[13rem] max-w-[18rem] bg-background px-2 py-1 align-middle">
                    {mode === "week" ? (
                      <button
                        type="button"
                        className="block w-full truncate text-left text-sm font-medium hover:underline"
                        onClick={() => setPicker({ kind: "swap", weekIdx: activeIdx, dayIndex: line.dayIndex, pos: line.pos, excludeId: weekRow?.exercise_id ?? null })}
                        title="Swap exercise"
                        data-sheet-exercise
                      >
                        {line.name || <span className="text-amber-600 dark:text-amber-400">Pick an exercise</span>}
                      </button>
                    ) : (
                      <span className="block truncate text-sm font-medium" title={line.name}>{line.name || "—"}</span>
                    )}
                    {line.label && <span className="block truncate text-[11px] text-muted-foreground">{line.label}</span>}
                  </td>
                  {Array.from({ length: cols }, (_, c) => {
                    const loc = locOf(r, c);
                    const row = rowOf(loc);
                    if (!loc || !row) {
                      return <td key={c} className="bg-muted/30 px-1.5 text-center text-xs text-muted-foreground/60" aria-label="No exercise here this week">·</td>;
                    }
                    const other = mode === "weeks" && nameOf(row) && line.name && nameOf(row) !== line.name ? nameOf(row) : null;
                    const hint = loc.field === "load" && loadHint ? loadHint(row) : null;
                    return (
                      <td key={c} className={cn("relative p-0 align-middle", mode === "week" && SHEET_COLUMNS[c].width)}>
                        <SheetCell
                          r={r}
                          c={c}
                          value={formatCell(row, loc.field)}
                          placeholder={loc.field === "reps" && isTimeRow(row) ? "time" : ""}
                          selected={inBox(r, c) && multi}
                          hint={hint}
                          marker={other ? `This week has ${other} here` : null}
                          ariaLabel={`${line.name || "Exercise"} · ${mode === "week" ? SHEET_COLUMNS[c].label : `Week ${weeksData[c]?.week_index ?? c + 1} ${fieldLabel}`}`}
                          onCommit={(text) => applyEdits([{ r, c, text }])}
                          onFocusCell={() =>
                            // focus that came from the keyboard (Tab, a move) or a click
                            // already set the selection; anything else starts one here
                            setSel((prev) => (prev && prev.a[0] === r && prev.a[1] === c ? prev : { a: [r, c], b: [r, c] }))
                          }
                          onMouseDown={(e) => {
                            if (e.shiftKey && sel) {
                              e.preventDefault();
                              setSel({ a: sel.a, b: [r, c] });
                              return;
                            }
                            dragging.current = [r, c];
                            setSel({ a: [r, c], b: [r, c] });
                          }}
                          multi={multi}
                          onMove={(dr, dc, extend) => move([r, c], dr, dc, extend)}
                          onTab={(back) => {
                            let nr = r;
                            let nc = c + (back ? -1 : 1);
                            if (nc >= cols) { nc = 0; nr = Math.min(nRows - 1, r + 1); }
                            if (nc < 0) { nc = cols - 1; nr = Math.max(0, r - 1); }
                            setSel({ a: [nr, nc], b: [nr, nc] });
                            focusCell(nr, nc);
                          }}
                          onFill={(text) => (multi ? fillSelection(text) : applyEdits([{ r, c, text }]))}
                          onFillDown={() => fillDown([r, c])}
                          onClear={clearSelection}
                          copyText={() => (multi ? selectionTsv() : null)}
                          onPasteGrid={(text) => pasteGrid(text, [r, c])}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {mode === "week"
          ? "Type to change a cell; Enter moves down, Tab across. Paste a block straight from Google Sheets or Excel."
          : `${fieldLabel} for each exercise, week by week. Select a row across weeks for Fill right or a Progression.`}
      </p>

      {renderPicker({
        open: !!picker,
        onOpenChange: (o) => { if (!o) setPicker(null); },
        title: picker?.kind === "add" ? "Add exercise" : "Swap exercise",
        excludeId: picker?.kind === "swap" ? picker.excludeId : null,
        onPick,
        onCustomName,
      })}
    </div>
  );
}

// ── one cell ─────────────────────────────────────────────────────────────

function SheetCell({
  r, c, value, placeholder, selected, hint, marker, ariaLabel, multi,
  onCommit, onFocusCell, onMouseDown, onMove, onTab, onFill, onFillDown, onClear, copyText, onPasteGrid,
}: {
  r: number;
  c: number;
  value: string;
  placeholder?: string;
  selected: boolean;
  hint: string | null;
  marker: string | null;
  ariaLabel: string;
  multi: boolean;
  onCommit: (text: string) => boolean;
  onFocusCell: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMove: (dr: number, dc: number, extend: boolean) => void;
  onTab: (back: boolean) => void;
  onFill: (text: string) => void;
  onFillDown: () => void;
  onClear: () => void;
  copyText: () => string | null;
  onPasteGrid: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // typing in the cell (vs. just on it): arrows then move the caret, not the cell
  const editing = useRef(false);
  const fromMouse = useRef(false);
  // what this cell last sent: a commit then a blur in the same tick (Enter,
  // Tab, an arrow) sends once, never twice
  const lastSent = useRef<string | null>(null);
  // a cell nobody is typing in follows the program (an undo, a paste, a fill
  // elsewhere), focused or not; only a cell being typed in keeps its text
  useEffect(() => {
    if (!focused || !editing.current) {
      setDraft(value);
      lastSent.current = null;
    }
  }, [value, focused]);
  const dirty = draft !== value;

  const commit = () => {
    editing.current = false;
    if (draft.trim() === value.trim()) {
      if (draft !== value) setDraft(value);
      return true;
    }
    if (lastSent.current === draft) return true;
    lastSent.current = draft;
    const ok = onCommit(draft);
    if (!ok) setDraft(value);
    return ok;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === "Enter") {
      e.preventDefault();
      if (meta) {
        onFill(draft);
        editing.current = false;
        return;
      }
      commit();
      onMove(e.shiftKey ? -1 : 1, 0, false);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commit();
      onTab(e.shiftKey);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      editing.current = false;
      requestAnimationFrame(() => el.select());
      return;
    }
    if (meta && e.key.toLowerCase() === "d") {
      e.preventDefault();
      commit();
      onFillDown();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!e.shiftKey) commit();
      onMove(e.key === "ArrowUp" ? -1 : 1, 0, e.shiftKey);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      const leave = !editing.current || e.shiftKey || (e.key === "ArrowLeft" ? atStart : atEnd);
      if (leave) {
        e.preventDefault();
        if (!e.shiftKey) commit();
        onMove(0, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
      }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && multi && !editing.current) {
      e.preventDefault();
      onClear();
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      editing.current = true;
      const n = el.value.length;
      el.setSelectionRange(n, n);
      return;
    }
    if (!meta && e.key.length === 1) editing.current = true;
    if (e.key === "Backspace" || e.key === "Delete") editing.current = true;
  };

  return (
    <div className="relative">
      <input
        className={cn(
          "h-9 w-full min-w-0 bg-transparent px-1.5 text-sm tabular-nums outline-none transition-colors",
          "focus:relative focus:z-[1] focus:bg-background focus:ring-2 focus:ring-inset focus:ring-foreground/60",
          selected && "bg-secondary ring-1 ring-inset ring-foreground/25",
          dirty && "bg-muted",
          hint && !focused && "pr-14",
        )}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        data-sheet-cell
        data-sheet-r={r}
        data-sheet-c={c}
        data-dirty={dirty ? "1" : "0"}
        onChange={(e) => { editing.current = true; lastSent.current = null; setDraft(e.target.value); }}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          // Sheets' way: a click selects the cell (and a drag selects cells);
          // a double-click, F2 or typing edits it. Only a cell already being
          // typed in takes clicks for its caret.
          const el = e.currentTarget;
          if (document.activeElement === el && editing.current) return;
          fromMouse.current = true;
          e.preventDefault();
          onMouseDown(e);
          if (!e.shiftKey) {
            el.focus();
            el.select();
          }
        }}
        onDoubleClick={(e) => {
          editing.current = true;
          const n = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(n, n);
        }}
        onFocus={(e) => {
          setFocused(true);
          editing.current = false;
          lastSent.current = null;
          if (!fromMouse.current) onFocusCell();
          fromMouse.current = false;
          const el = e.currentTarget;
          requestAnimationFrame(() => { if (document.activeElement === el && !editing.current) el.select(); });
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onCopy={(e) => {
          const tsv = copyText();
          if (tsv == null) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", tsv);
        }}
        onCut={(e) => {
          const tsv = copyText();
          if (tsv == null) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", tsv);
          onClear();
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          if (isMultiCellPaste(text) || multi) {
            e.preventDefault();
            editing.current = false;
            onPasteGrid(text);
          }
        }}
      />
      {hint && !focused && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground" data-sheet-load-hint>
          {hint}
        </span>
      )}
      {marker && (
        <span
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
          title={marker}
          aria-label={marker}
        />
      )}
    </div>
  );
}

function RowMenu({
  n, timed, first, last, onSwap, onInsertBelow, onDuplicate, onMove, onToggleTime, onDelete,
}: {
  n: number;
  timed: boolean;
  first: boolean;
  last: boolean;
  onSwap: () => void;
  onInsertBelow: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleTime: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-xs tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Exercise ${n} options`}
          data-sheet-row-menu
        >
          <span className="group-hover:hidden">{n}</span>
          <MoreHorizontal className="hidden h-4 w-4 group-hover:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={onSwap}><Repeat className="mr-2 h-4 w-4" /> Swap exercise</DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertBelow}><Plus className="mr-2 h-4 w-4" /> Add exercise below</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}><Copy className="mr-2 h-4 w-4" /> Duplicate</DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}><ArrowUp className="mr-2 h-4 w-4" /> Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}><ArrowDown className="mr-2 h-4 w-4" /> Move down</DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleTime}><Timer className="mr-2 h-4 w-4" /> {timed ? "Track by reps" : "Track by time"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}><Trash2 className="mr-2 h-4 w-4" /> Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProgressionForm({ field, weeks, rows, onApply }: { field: SheetField; weeks: number; rows: number; onApply: (start: number | null, step: number) => void }) {
  const [start, setStart] = useState("");
  const [step, setStep] = useState(String(STEP_DEFAULT[field] ?? 1));
  const stepN = Number(step);
  const startN = start.trim() === "" ? null : Number(start);
  const valid = Number.isFinite(stepN) && (startN == null || Number.isFinite(startN));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(startN, stepN);
      }}
    >
      <div>
        <p className="text-sm font-semibold">Progression</p>
        <p className="text-xs text-muted-foreground">
          {rows} exercise{rows === 1 ? "" : "s"} over {weeks} weeks. Each week adds the step to the one before.
        </p>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        Start
        <Input inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} placeholder="Each row's first week" className="h-9" />
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Each week
        <Input inputMode="decimal" value={step} onChange={(e) => setStep(e.target.value)} className="h-9" />
      </label>
      <Button type="submit" size="sm" className="h-9 w-full" disabled={!valid}>Apply</Button>
    </form>
  );
}

function SheetKeysHelp() {
  const keys: Array<[string, string]> = [
    ["Type", "Replace the cell"],
    ["Enter / Shift+Enter", "Down / up"],
    ["Tab / Shift+Tab", "Across"],
    ["Arrows", "Move (Shift to select)"],
    ["Drag", "Select cells"],
    ["Cmd/Ctrl+Enter", "Fill the selection"],
    ["Cmd/Ctrl+D", "Fill down"],
    ["Delete", "Clear the selection"],
    ["Esc", "Put the cell back"],
    ["Cmd/Ctrl+C / V", "Copy / paste with Google Sheets"],
    ["Cmd/Ctrl+Z", "Undo"],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Sheet keys">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-sm font-semibold">Sheet keys</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {keys.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="font-medium tabular-nums">{k}</dt>
              <dd className="text-muted-foreground">{v}</dd>
            </Fragment>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
