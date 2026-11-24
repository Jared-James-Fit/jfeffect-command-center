import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  CopyPlus,
  History,
  Loader2,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { haptic } from "@/platform/haptics";
import { Button } from "@/components/ui/button";
import { useIsMobileNow } from "@/hooks/use-mobile";
import type { ExerciseLite } from "@/components/workout-day/workout-add-exercise";
import {
  MAX_DAYS,
  MAX_EXERCISES,
  addBlock,
  addSetGroup,
  addDay,
  addExercises,
  applyProgression,
  changedFromLastWeek,
  clampCursor,
  copyDayTo,
  copyWeekTo,
  defaultScope,
  duplicateBlock,
  duplicateDay,
  duplicateExercise,
  duplicateSetGroup,
  duplicateWeek,
  exerciseUnits,
  fmtWeight,
  inStepWeeks,
  linkedLoad,
  moveBlock,
  moveDay,
  newPlanExercise,
  offeredScope,
  patchFields,
  planMeta,
  programWeek,
  refOfWeek,
  removeBlock,
  removeDay,
  removeExercise,
  removeSetGroup,
  removeWeek,
  renameBlock,
  reorderExercise,
  scopeLabel,
  scopeWeeks,
  setGroupName,
  setBlockLength,
  setDay,
  setExercise,
  setProgramLength,
  splitIntoBlocks,
  swapExercise,
  totalWeeks,
  weekAt,
  weeksWords,
  type Cursor,
  type EditField,
  type PlanExercise,
  type Scope,
  type SetGroupKind,
  type WeekRef,
  type ProgramPlan,
} from "@/lib/program-plan";
import { resolveName } from "@/lib/program-import/review";
import { ExercisePickerSheet } from "../exercise-picker-sheet";
import type { ProgramEditor } from "../use-program-editor";
import { CellsProvider, KeyboardBar, type ActiveCell } from "./cells";
import {
  ColumnHeads,
  DayTabs,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ExerciseBlock,
  ScopeBar,
  WeekBar,
} from "./rows";
import {
  CopyWeeksSheet,
  DaySheet,
  ExerciseSheet,
  LeaveSheet,
  ProgramSheet,
  ProgressionSheet,
  SetGroupSheet,
} from "./sheets";
import { VersionsSheet } from "./versions-sheet";
import { DraftStatusLine } from "./draft-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Dragging an exercise only ever moves it up or down. */
const upAndDown: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** A typing session's edit across weeks: worked out once when it starts, so a value typed digit by digit reaches the same weeks. */
type EditSession = {
  id: string;
  dayKey: string;
  exKey: string;
  at: Cursor;
  fields: EditField[];
  reach: WeekRef[];
  own: WeekRef[];
  changed: boolean;
};

const FIELD_WORD: Record<EditField, string> = {
  sets: "sets",
  reps: "reps",
  effort: "effort",
  load: "load",
  rest: "rest",
  tempo: "tempo",
  notes: "notes",
  exercise: "exercise",
  role: "set name",
  round: "rounding",
};

/** The fields of an exercise an edit session changed, as they are now (to give the weeks it skipped). */
function pickFields(e: PlanExercise, fields: EditField[]): Partial<PlanExercise> {
  const out: Partial<PlanExercise> = {};
  for (const f of fields) {
    if (f === "sets") out.sets = e.sets;
    if (f === "reps") out.reps = e.reps;
    if (f === "effort") Object.assign(out, { rpe: e.rpe ?? null, rir: e.rir ?? null });
    if (f === "load") Object.assign(out, { load: e.load ?? null, unit: e.unit ?? null, pct: e.pct ?? null, pct_of: e.pct_of ?? null });
    if (f === "rest") out.rest_seconds = e.rest_seconds ?? null;
    if (f === "tempo") out.tempo = e.tempo ?? null;
    if (f === "notes") out.notes = e.notes ?? null;
    if (f === "exercise") Object.assign(out, { exercise_id: e.exercise_id, name: e.name, muscle_group: e.muscle_group ?? null, equipment: e.equipment ?? null });
    if (f === "role") Object.assign(out, { role: e.role ?? null, label: e.label ?? null });
    if (f === "round") out.round = e.round ?? null;
  }
  return out;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Picker = null | { mode: "add" } | { mode: "swap"; exKey: string } | { mode: "resolve"; name: string };

/** What a review panel above the day can do (an imported program's checks). */
export type WorkbenchReviewApi = {
  plan: ProgramPlan;
  /** Shows that week and day, and the exercise when one is named. */
  goTo: (at: { b: number; w: number; d: number; e?: number }) => void;
  /** Opens the library picker for a name the file used; the pick becomes it everywhere. */
  resolve: (sourceName: string) => void;
  /** An edit, one Undo step. */
  edit: (fn: (plan: ProgramPlan) => ProgramPlan) => void;
  /** Takes the last edit back. */
  undo: () => void;
};

/**
 * The program builder (Nov 19 2026): one screen for phones and computers.
 * Days are tabs along the top, weeks are tabs along the bottom (Google
 * Sheets' tabs, grouped by block), and each exercise's numbers are typed
 * straight into its row. Every edit reaches the weeks its scope names, said
 * over the weeks and outlined on their tabs ("All 12 weeks", "Weeks 3–12",
 * "Week 3 only"), so building once fills the program and changing one week
 * is a tap away. Undo / Redo for everything, the draft kept on the phone, and
 * nothing goes to the server until Save.
 */
export function ProgramWorkbench({
  editor,
  review,
  beforeSave,
}: {
  editor: ProgramEditor;
  /** A panel above the day (an import's review), given ways to move around and fix things. */
  review?: (api: WorkbenchReviewApi) => ReactNode;
  /** Asked before saving (an import's confirm step); false keeps the builder open. */
  beforeSave?: () => Promise<boolean>;
}) {
  const navigate = useNavigate();
  const desktop = !useIsMobileNow();
  const { d, edit } = editor;
  const plan = d.plan;

  const [cursorRaw, setCursor] = useState<Cursor>({ b: 0, w: 0, d: 0 });
  const cur = clampCursor(plan, cursorRaw);
  const [scopeRaw, setScope] = useState<Scope>(() => defaultScope(plan, 0));
  // the choice as this week offers it ("rest of block" on its first week is the whole block)
  const scope = offeredScope(plan, cur, scopeRaw);
  const week = weekAt(plan, cur)!;
  const day = week.days[cur.d] ?? null;
  const targets = useMemo(() => scopeWeeks(plan, cur, scope), [plan, cur.b, cur.w, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopeText = scopeLabel(plan, cur, scope);
  const units = useMemo(() => (day ? exerciseUnits(day) : []), [day]);
  const planRef = useRef(plan);
  planRef.current = plan;

  // the cell being typed in, and the weight unit loads start in
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [unit, setUnit] = useState<"lb" | "kg">(() => {
    for (const b of plan.blocks) for (const w of b.weeks) for (const dd of w.days) for (const e of dd.exercises) if (e.load != null && e.unit) return e.unit;
    return "lb";
  });

  const [exSheet, setExSheet] = useState<string | null>(null);
  const [groupSheet, setGroupSheet] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState(false);
  const [programSheet, setProgramSheet] = useState(false);
  const [copy, setCopy] = useState<null | { day: string | null }>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [leave, setLeave] = useState(false);
  const [versions, setVersions] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [conflict, setConflict] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // on a phone the builder owns the screen: no app bar on top, no tab bar below
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-program-builder", "");
    return () => html.removeAttribute("data-program-builder");
  }, []);

  // ⌘Z / ⇧⌘Z on a computer (a box being typed in keeps its own undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  const undoable = (message: string) =>
    toast(message, { action: { label: "Undo", onClick: () => editor.undo() }, duration: 5000 });

  const goWeek = (b: number, w: number) => {
    const key = day?.key;
    const next = plan.blocks[b]?.weeks[w];
    if (!next) return;
    const i = key ? next.days.findIndex((x) => x.key === key) : -1;
    setCursor({ b, w, d: i >= 0 ? i : Math.min(cur.d, Math.max(0, next.days.length - 1)) });
    if (b !== cur.b) setScope(defaultScope(plan, b));
  };

  const goCursor = (c: Cursor) => {
    setCursor(c);
    if (c.b !== cur.b) setScope(defaultScope(plan, c.b));
  };

  // a flag's place: the week and day on screen, then the exercise scrolled to and lit for a moment
  const goTo = (at: { b: number; w: number; d: number; e?: number }) => {
    goCursor({ b: at.b, w: at.w, d: at.d });
    if (at.e == null) return;
    const key = plan.blocks[at.b]?.weeks[at.w]?.days[at.d]?.exercises[at.e]?.key;
    if (!key) return;
    setTimeout(() => {
      const entry = document.querySelector<HTMLElement>(`[data-pb-entry="${CSS.escape(key)}"]`);
      const el = (entry?.closest("[data-pb-row]") as HTMLElement | null) ?? entry;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.setAttribute("data-pb-flash", "");
      setTimeout(() => el.removeAttribute("data-pb-flash"), 1600);
    }, 60);
  };

  const onSave = async (force = false) => {
    if (!force && beforeSave && !(await beforeSave())) return;
    const r = await editor.save({ force });
    if (r.ok) return;
    if (r.conflict) {
      setConflict(true);
      return;
    }
    if (r.at === "title") titleRef.current?.focus();
    else if (r.at && typeof r.at === "object") goCursor(r.at);
  };
  const onBack = () => {
    if (editor.dirty) setLeave(true);
    else navigate({ to: editor.backTo as any });
  };

  /* ---- exercises ---- */
  // An edit across weeks reaches the weeks in step with this one; a week given its
  // own value on purpose (a progression, a deload) keeps it, and the builder says so
  // once the edit is done, with a tap to change those weeks too.
  const session = useRef<EditSession | null>(null);
  const endSession = (id?: string) => {
    const s = session.current;
    if (!s || (id && s.id !== id)) return;
    session.current = null;
    if (!s.changed || !s.own.length) return;
    const words = weeksWords(planRef.current, s.own);
    const ex = weekAt(planRef.current, s.at)?.days.find((x) => x.key === s.dayKey)?.exercises.find((x) => x.key === s.exKey);
    const what = s.fields.map((f) => (f === "effort" ? (ex?.rir ? "RIR" : "RPE") : FIELD_WORD[f])).join(" and ");
    toast(`${cap(words)} kept their own ${what}`, {
      description: "They were set differently, so this change left them as they were.",
      duration: 7000,
      action: {
        label: "Change them too",
        onClick: () => {
          const now = weekAt(planRef.current, s.at)?.days.find((x) => x.key === s.dayKey)?.exercises.find((x) => x.key === s.exKey);
          if (!now) return;
          edit((x) => setExercise(x, s.own, s.dayKey, s.exKey, pickFields(now, s.fields)));
        },
      },
    });
  };
  // a session never outlives the week, day or scope it was worked out for
  useEffect(() => () => endSession(), [cur.b, cur.w, cur.d, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchEx = (exKey: string, p: Partial<PlanExercise>, sessionId?: string) => {
    if (!day) return;
    const fields = patchFields(p);
    const id = sessionId ?? `once:${exKey}:${fields.join(",")}:${Date.now()}`;
    let s = session.current;
    if (!s || s.id !== id) {
      endSession();
      const split = targets.length > 1 ? inStepWeeks(plan, cur, targets, day.key, exKey, fields) : { reach: targets, own: [] };
      s = { id, dayKey: day.key, exKey, at: { ...cur }, fields, ...split, changed: false };
      session.current = s;
    }
    s.changed = true;
    const reach = s.reach;
    edit((x) => setExercise(x, reach, day.key, exKey, p), `${exKey}:${fields.join(",")}:${id}`);
    if (!sessionId) endSession(id);
  };
  // a new set group or copy, scrolled to and lit for a moment
  const flash = (exKey: string | null) => {
    if (!exKey) return;
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-pb-entry="${CSS.escape(exKey)}"]`);
      const box = (el?.closest("[data-pb-unit]") as HTMLElement | null) ?? el;
      if (!box) return;
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
      box.setAttribute("data-pb-flash", "new");
      setTimeout(() => box.removeAttribute("data-pb-flash"), 1400);
    }, 60);
  };
  const duplicateEx = (exKey: string) => {
    if (!day) return;
    const name = day.exercises.find((e) => e.key === exKey)?.name ?? "Exercise";
    let r: ReturnType<typeof duplicateExercise> | null = null;
    edit((x) => {
      r = duplicateExercise(x, targets, day.key, exKey);
      return r.plan;
    });
    setExSheet(null);
    const out = r as ReturnType<typeof duplicateExercise> | null;
    if (!out?.key) {
      toast(`No room: a day holds ${MAX_EXERCISES} set groups.`);
      return;
    }
    undoable(`Duplicated ${name} · ${scopeText}`);
    if (out.skipped) toast(`${out.skipped} ${out.skipped === 1 ? "week was" : "weeks were"} too full for the copy.`);
    flash(out.key);
  };
  const addGroup = (exKey: string, kind: SetGroupKind) => {
    if (!day) return;
    let key = "";
    edit((x) => {
      const r = addSetGroup(x, targets, day.key, exKey, kind);
      key = r.key;
      return r.plan;
    });
    setExSheet(null);
    undoable(`Added ${kind === "backoff" ? "back-off sets" : kind === "warmup" ? "warm-up sets" : "a set group"} · ${scopeText}`);
    flash(key);
  };
  const swapPicked = (exKey: string, ex: ExerciseLite) => {
    if (!day) return;
    const split = targets.length > 1 ? inStepWeeks(plan, cur, targets, day.key, exKey, ["exercise"]) : { reach: targets, own: [] };
    edit((x) => swapExercise(x, split.reach, day.key, exKey, ex));
    if (split.own.length) {
      const own = split.own;
      const dayKey = day.key;
      toast(`Swapped in ${ex.name}. ${cap(weeksWords(plan, own))} kept the exercise they have.`, {
        duration: 7000,
        action: { label: "Swap them too", onClick: () => edit((x) => swapExercise(x, own, dayKey, exKey, ex)) },
      });
    } else undoable(`Swapped in ${ex.name} · ${scopeText}`);
  };

  /* ---- dragging an exercise ---- */
  const sensors = useSensors(
    // a mouse drags at once; a finger presses and holds the handle, so a swipe still scrolls
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const unitIds = useMemo(() => units.map((u) => u.group ?? u.key), [units]);
  const overRef = useRef<string | null>(null);
  const onDragStart = (ev: DragStartEvent) => {
    endSession();
    (document.activeElement as HTMLElement | null)?.blur?.();
    overRef.current = String(ev.active.id);
    haptic("medium");
  };
  const onDragOver = (ev: DragOverEvent) => {
    const id = ev.over ? String(ev.over.id) : null;
    if (id && id !== overRef.current) haptic("selection");
    overRef.current = id;
  };
  const onDragEnd = (ev: DragEndEvent) => {
    overRef.current = null;
    if (!day || !ev.over) return;
    const from = unitIds.indexOf(String(ev.active.id));
    const to = unitIds.indexOf(String(ev.over.id));
    if (from < 0 || to < 0 || from === to) return;
    const first = units[from].entries[0];
    edit((x) => reorderExercise(x, targets, cur, day.key, first.key, to));
    haptic("light");
    if (targets.length > 1) undoable(`Moved ${first.name ?? "exercise"} · ${scopeText}`);
  };
  const addPicked = (picked: ExerciseLite[]) => {
    if (!day) return;
    const items = picked.map((x) => newPlanExercise(x));
    let skipped = 0;
    edit((x) => {
      const r = addExercises(x, targets, day.key, items);
      skipped = r.skipped;
      return r.plan;
    });
    const n = picked.length - skipped;
    if (n > 0) undoable(`Added ${n} ${n === 1 ? "exercise" : "exercises"} to ${scopeText}`);
    if (skipped) toast(`${skipped} didn't fit: a day holds ${MAX_EXERCISES} exercises.`);
  };
  const removeEx = (exKey: string) => {
    if (!day) return;
    const name = day.exercises.find((e) => e.key === exKey)?.name ?? "Exercise";
    edit((x) => removeExercise(x, targets, day.key, exKey));
    setExSheet(null);
    undoable(`Removed ${name} · ${scopeText}`);
  };

  /* ---- days ---- */
  const addNewDay = () => {
    if (week.days.length >= MAX_DAYS) return;
    let key = "";
    edit((x) => {
      const r = addDay(x, targets);
      key = r.key;
      return r.plan;
    });
    setCursor({ ...cur, d: week.days.length });
    if (key && scope !== "week") toast(`Added a day to ${scopeText}`);
  };
  const renameDayEverywhere = (patch: { title?: string; focus?: string | null }) => {
    if (!day) return;
    const everyWeek = plan.blocks.flatMap((bl, b) => bl.weeks.map((_, w) => ({ b, w })));
    edit((x) => setDay(x, everyWeek, day.key, patch), `${day.key}:${Object.keys(patch).join(",")}`);
  };

  /* ---- weeks & blocks ---- */
  const weekMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Week and program options"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary"
          data-week-menu
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60">
        <DropdownMenuItem onSelect={() => setCopy({ day: null })} className="min-h-11">
          <Copy className="mr-2 h-4 w-4" /> Copy week {programWeek(plan, cur)} to…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            edit((x) => duplicateWeek(x, cur));
            goCursor({ b: cur.b, w: cur.w + 1, d: cur.d });
            undoable(`Added a copy of week ${programWeek(plan, cur)}`);
          }}
          disabled={totalWeeks(plan) >= 24}
          className="min-h-11"
        >
          <CopyPlus className="mr-2 h-4 w-4" /> Duplicate this week
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            edit((x) => removeWeek(x, cur));
            undoable(`Deleted week ${programWeek(plan, cur)}`);
          }}
          disabled={plan.blocks[cur.b].weeks.length <= 1}
          className="min-h-11 text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete this week
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const hasExercises = plan.blocks.some((bl) => bl.weeks.some((w) => w.days.some((x) => x.exercises.length > 0)));
  const readyToSave = editor.dirty && hasExercises;
  const exSheetEx = exSheet && day ? day.exercises.find((e) => e.key === exSheet) ?? null : null;
  const exUnit = exSheetEx ? units.find((u) => u.entries.some((e) => e.key === exSheetEx.key)) ?? null : null;
  const groupEx = groupSheet && day ? day.exercises.find((e) => e.key === groupSheet) ?? null : null;
  const groupLinked = groupEx && day ? linkedLoad(day, groupEx.key) : null;
  const room = day ? MAX_EXERCISES - day.exercises.length : 0;
  // the header's height on a phone (it holds the days, the scope and the column names)
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el || desktop) return;
    const set = () => setHeaderH(el.getBoundingClientRect().height);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop]);

  return (
    <CellsProvider value={{ active, setActive, unit, setUnit, endSession }}>
      <div className={cn("mx-auto w-full", desktop ? "max-w-5xl px-4 pb-6 md:px-8" : "pb-[calc(env(safe-area-inset-bottom)+7.5rem)]")} data-program-workbench>
        {/* Header: back, the name, Undo / Redo, Save; the days under it */}
        <header
          ref={headerRef}
          className={cn(
            "z-40 border-b border-border/60 bg-background",
            desktop ? "sticky top-0 -mx-4 px-4 pt-3 md:-mx-8 md:px-8" : "pb-header phone-column fixed inset-x-0 px-3",
          )}
          data-builder-header
        >
          <div className="flex items-center gap-1.5 py-1.5">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <input
                ref={titleRef}
                value={d.title}
                onChange={(e) => editor.updateMeta({ title: e.target.value.slice(0, 80) })}
                placeholder="Name your program"
                aria-label="Program name"
                className="block w-full min-w-0 truncate bg-transparent text-[17px] font-semibold leading-tight outline-none placeholder:text-muted-foreground"
                data-program-title
              />
              <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                {/* on a phone the weeks along the bottom already say the length: the name keeps its status */}
                <button
                  type="button"
                  onClick={() => setProgramSheet(true)}
                  className="min-w-0 shrink truncate text-left hover:text-foreground max-md:hidden"
                  data-program-meta
                >
                  {planMeta(plan, { days: false })}
                </button>
                <span aria-hidden className="shrink-0 max-md:hidden">·</span>
                <DraftStatusLine status={editor.status} />
              </div>
            </div>
            <button
              type="button"
              onClick={editor.undo}
              disabled={!editor.canUndo}
              aria-label="Undo"
              className="grid h-10 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary disabled:opacity-30"
              data-undo
            >
              <Undo2 className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={editor.redo}
              disabled={!editor.canRedo}
              aria-label="Redo"
              // the smallest phones keep the name readable: Redo is ⇧⌘Z or Undo's twin there
              className="grid h-10 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary disabled:opacity-30 max-[359px]:hidden"
              data-redo
            >
              <Redo2 className="h-[18px] w-[18px]" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Program options"
                  className="grid h-10 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary"
                  data-builder-menu
                >
                  <MoreHorizontal className="h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={() => setProgramSheet(true)} className="min-h-11">
                  <SlidersHorizontal className="mr-2 h-4 w-4" /> Details, length & blocks
                </DropdownMenuItem>
                {editor.editing && d.id && (
                  <DropdownMenuItem onSelect={() => setVersions(true)} className="min-h-11" data-open-versions>
                    <History className="mr-2 h-4 w-4" /> Version history
                  </DropdownMenuItem>
                )}
                {editor.dirty && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setDiscardAsk(true)}
                      className="min-h-11 text-destructive focus:text-destructive"
                      data-discard-draft
                    >
                      <RotateCcw className="mr-2 h-4 w-4" /> {editor.editing ? "Discard unsaved changes" : "Discard this draft"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* nothing to save: the status line by the name already says so, no second "Saved" */}
            {!(editor.editing && !editor.dirty) && (
              <Button
                onClick={() => void onSave()}
                disabled={editor.saving}
                // the screen's one red button: Save once there's something to save, else Add exercises
                variant={readyToSave ? "default" : "secondary"}
                className="h-10 shrink-0 px-4 text-[15px]"
                data-save
              >
                {editor.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            )}
          </div>
          <div className="pb-1">
            <DayTabs
              days={week.days}
              active={cur.d}
              onPick={(i) => setCursor({ ...cur, d: i })}
              onAdd={addNewDay}
              canAdd={week.days.length < MAX_DAYS}
              onDayMenu={() => setDaySheet(true)}
            />
          </div>
          {/* which weeks an edit changes, always in view while editing */}
          <div className="pb-1.5">
            <ScopeBar plan={plan} cursor={cur} scope={scope} onScope={setScope} />
          </div>
          {day && day.exercises.length > 0 && <ColumnHeads desktop={desktop} />}
        </header>
        {/* the fixed header's room on a phone */}
        {!desktop && (
          <div
            aria-hidden
            style={{ height: headerH ? `${headerH}px` : "calc(var(--app-chrome-top) + var(--app-safe-top) + 10rem)" }}
          />
        )}

        {review && (
          <div className={cn(desktop ? "pt-4" : "px-3 pt-2")} data-workbench-review>
            {review({
              plan,
              goTo,
              resolve: (name) => setPicker({ mode: "resolve", name }),
              edit: (fn) => edit(fn),
              undo: () => editor.undo(),
            })}
          </div>
        )}

        {/* The day */}
        <section className={cn(desktop ? "pt-4" : "px-3 pt-2")} aria-label={day ? day.title : "Day"}>
          {day && day.exercises.length > 0 ? (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[upAndDown]}
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                autoScroll={{ threshold: { x: 0, y: 0.25 }, acceleration: 14 }}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={() => (overRef.current = null)}
                accessibility={{
                  screenReaderInstructions: {
                    draggable: "To move an exercise, press space or enter, use the arrow keys, then press space or enter again.",
                  },
                }}
              >
                <SortableContext items={unitIds} strategy={verticalListSortingStrategy}>
                  <div className={cn(desktop ? "space-y-1" : "divide-y divide-border/60")} data-day-list>
                    {units.map((u, i) => (
                      <ExerciseBlock
                        key={unitIds[i]}
                        id={unitIds[i]}
                        unit={u}
                        day={day}
                        desktop={desktop}
                        changedOf={(k) => changedFromLastWeek(plan, cur, day.key, k) as Set<string>}
                        onPatch={patchEx}
                        onOpen={() => {
                          const head = u.entries[0];
                          if (head.exercise_id) setExSheet(head.key);
                          else setPicker({ mode: "resolve", name: head.source_name ?? head.name ?? "" });
                        }}
                        onOpenGroup={(k) => setGroupSheet(k)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {day.exercises.length < MAX_EXERCISES && (
                <button
                  type="button"
                  onClick={() => setPicker({ mode: "add" })}
                  className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[15px] font-medium text-muted-foreground transition hover:bg-secondary/40"
                  data-add-exercises
                >
                  <Plus className="h-4 w-4" /> Add exercises
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center px-6 py-14 text-center" data-day-empty>
              <div className="text-[16px] font-semibold">{day?.title || "This day"} has no exercises yet</div>
              <p className="mt-1 max-w-xs text-[14px] text-muted-foreground">
                Pick from the library. They go into {scopeText.charAt(0).toLowerCase() + scopeText.slice(1)}.
              </p>
              <Button
                className="mt-4 h-12 px-6 text-[15px]"
                variant={readyToSave ? "secondary" : "default"}
                onClick={() => setPicker({ mode: "add" })}
                data-add-exercises
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add exercises
              </Button>
            </div>
          )}
        </section>

        <WeekBar plan={plan} cursor={cur} targets={targets} onPick={goWeek} weekMenu={weekMenu} desktop={desktop} />
      </div>

      <KeyboardBar />

      <ExercisePickerSheet
        open={!!picker}
        onOpenChange={(o) => !o && setPicker(null)}
        mode={picker?.mode === "swap" || picker?.mode === "resolve" ? "single" : "multi"}
        room={day ? MAX_EXERCISES - day.exercises.length : 0}
        initialSearch={picker?.mode === "resolve" ? picker.name : undefined}
        title={
          picker?.mode === "resolve"
            ? `Pick the exercise for "${picker.name}"`
            : picker?.mode === "swap"
              ? "Swap exercise"
              : `Add to ${day?.title || "this day"}`
        }
        description={
          picker?.mode === "resolve"
            ? "Every place your program uses it becomes this exercise. Sets, reps and loads stay."
            : picker?.mode === "swap"
              ? `Keeps the sets, reps and load, in ${scopeText}`
              : `Into ${scopeText}`
        }
        onPick={(picked) => {
          if (picker?.mode === "resolve" && picked[0]) {
            const name = picker.name;
            edit((x) => resolveName(x, name, picked[0]));
            undoable(`"${name}" is now ${picked[0].name} everywhere`);
          } else if (picker?.mode === "swap" && day && picked[0]) {
            swapPicked(picker.exKey, picked[0]);
          } else addPicked(picked);
        }}
      />

      <ExerciseSheet
        open={!!exSheetEx}
        onOpenChange={(o) => {
          if (!o) {
            setExSheet(null);
            endSession();
          }
        }}
        e={exSheetEx}
        groups={exUnit?.entries.length ?? 1}
        scopeText={scopeText}
        canAdd={room > 0}
        canDuplicate={!!exUnit && room >= exUnit.entries.length}
        onPatch={(p, sid) => exSheetEx && patchEx(exSheetEx.key, p, sid)}
        onDuplicate={() => exSheetEx && duplicateEx(exSheetEx.key)}
        onSwap={() => {
          if (!exSheetEx) return;
          setPicker({ mode: "swap", exKey: exSheetEx.key });
          setExSheet(null);
        }}
        onProgress={() => {
          if (!exSheetEx) return;
          setProgress(exSheetEx.key);
          setExSheet(null);
        }}
        onAddGroup={(kind) => exSheetEx && addGroup(exSheetEx.key, kind)}
        onRemove={() => exSheetEx && removeEx(exSheetEx.key)}
      />

      <SetGroupSheet
        open={!!groupEx}
        onOpenChange={(o) => {
          if (!o) {
            setGroupSheet(null);
            endSession();
          }
        }}
        e={groupEx}
        exerciseName={groupEx?.name ?? "Exercise"}
        scopeText={scopeText}
        linked={groupLinked ? `= ${fmtWeight(groupLinked.load)} ${groupLinked.unit} (of ${fmtWeight(groupLinked.of)} ${groupLinked.unit})` : null}
        canAdd={room > 0}
        onPatch={(p, sid) => groupEx && patchEx(groupEx.key, p, sid)}
        onDuplicate={() => {
          if (!groupEx || !day) return;
          let key = "";
          edit((x) => {
            const r = duplicateSetGroup(x, targets, day.key, groupEx.key);
            key = r.key;
            return r.plan;
          });
          setGroupSheet(null);
          undoable(`Duplicated ${setGroupName(groupEx).toLowerCase()} · ${scopeText}`);
          flash(key);
        }}
        onProgress={() => {
          if (!groupEx) return;
          setProgress(groupEx.key);
          setGroupSheet(null);
        }}
        onRemove={() => {
          if (!groupEx || !day) return;
          edit((x) => removeSetGroup(x, targets, day.key, groupEx.key));
          setGroupSheet(null);
          undoable(`Removed ${setGroupName(groupEx).toLowerCase()} · ${scopeText}`);
        }}
      />

      {progress && day && (
        <ProgressionSheet
          key={progress}
          open
          onOpenChange={(o) => !o && setProgress(null)}
          plan={plan}
          cursor={cur}
          dayKey={day.key}
          exKey={progress}
          onPatchWeek={(ref: WeekRef, p) => edit((x) => setExercise(x, [ref], day.key, progress, p), `${progress}:${ref.b}:${ref.w}:${Object.keys(p).join(",")}`)}
          onFill={(refs, field, values) => {
            edit((x) => applyProgression(x, refs, day.key, progress, field, values));
            undoable(`Filled ${refs.length} weeks`);
          }}
        />
      )}

      <DaySheet
        open={daySheet && !!day}
        onOpenChange={setDaySheet}
        title={day?.title ?? ""}
        focus={day?.focus ?? ""}
        scopeText={scopeText}
        canAdd={week.days.length < MAX_DAYS}
        canRemove={week.days.length > 1}
        canLeft={cur.d > 0}
        canRight={cur.d < week.days.length - 1}
        onRename={(title) => renameDayEverywhere({ title })}
        onFocus={(focus) => renameDayEverywhere({ focus: focus || null })}
        onDuplicate={() => {
          if (!day) return;
          edit((x) => duplicateDay(x, targets, day.key).plan);
          setCursor({ ...cur, d: cur.d + 1 });
          setDaySheet(false);
          undoable(`Duplicated ${day.title} (${scopeText})`);
        }}
        onCopy={() => {
          setDaySheet(false);
          if (day) setCopy({ day: day.key });
        }}
        onMove={(dir) => {
          if (!day) return;
          edit((x) => moveDay(x, targets, day.key, dir));
          setCursor({ ...cur, d: cur.d + dir });
        }}
        onRemove={() => {
          if (!day) return;
          edit((x) => removeDay(x, targets, day.key));
          setCursor({ ...cur, d: Math.max(0, cur.d - 1) });
          setDaySheet(false);
          undoable(`Deleted ${day.title} from ${scopeText}`);
        }}
      />

      <CopyWeeksSheet
        open={!!copy}
        onOpenChange={(o) => !o && setCopy(null)}
        plan={plan}
        from={cur}
        what={copy?.day ? week.days.find((x) => x.key === copy.day)?.title ?? "This day" : null}
        onCopy={(to) => {
          const dayKey = copy?.day;
          edit((x) => (dayKey ? copyDayTo(x, cur, dayKey, to) : copyWeekTo(x, cur, to)));
          undoable(`Copied to ${to.length} ${to.length === 1 ? "week" : "weeks"}`);
        }}
      />

      <ProgramSheet
        open={programSheet}
        onOpenChange={setProgramSheet}
        d={d}
        updateMeta={editor.updateMeta}
        onLength={(n) => edit((x) => setProgramLength(x, n))}
        onBlockLength={(b, n) => edit((x) => setBlockLength(x, b, n))}
        onRenameBlock={(b, name) => edit((x) => renameBlock(x, b, name), `block:${b}:name`)}
        onAddBlock={() => {
          edit((x) => addBlock(x));
          goCursor({ b: plan.blocks.length, w: 0, d: 0 });
          undoable("Added a block");
        }}
        onDuplicateBlock={(b) => edit((x) => duplicateBlock(x, b))}
        onMoveBlock={(b, dir) => edit((x) => moveBlock(x, b, dir))}
        onRemoveBlock={(b) => {
          const name = plan.blocks[b]?.name ?? "Block";
          edit((x) => removeBlock(x, b));
          goCursor({ b: 0, w: 0, d: 0 });
          undoable(`Deleted ${name}`);
        }}
        onSplit={() => {
          // the week on screen stays on screen, in whichever block it lands in
          const g = programWeek(plan, cur);
          const next = splitIntoBlocks(plan, 4);
          edit(() => next);
          setCursor({ ...refOfWeek(next, g), d: cur.d });
          setScope("block");
          undoable("Split into 4-week blocks");
        }}
      />

      {d.id && (
        <VersionsSheet
          open={versions}
          onOpenChange={setVersions}
          programId={d.id}
          current={d}
          cursor={cur}
          running
          onRestore={(next, versionNo, what) => {
            editor.replace(next);
            editor.markRestore(versionNo);
            toast(`Restored ${what}`, {
              description: "Tap Save to keep it. Your later versions stay in history.",
              duration: 8000,
              action: { label: "Undo", onClick: () => editor.undo() },
            });
          }}
        />
      )}

      <AlertDialog open={discardAsk} onOpenChange={setDiscardAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{editor.editing ? "Discard unsaved changes?" : "Discard this draft?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {editor.editing
                ? "The program goes back to how it was last saved, here and on your other devices. Saved versions stay in history."
                : "Everything you've built here is cleared, here and on your other devices."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                editor.discard();
                setCursor({ b: 0, w: 0, d: 0 });
                toast(editor.editing ? "Back to your last save" : "Draft discarded");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changed on another device</AlertDialogTitle>
            <AlertDialogDescription>
              This program was saved somewhere else after you opened it here. Saving now replaces that version with
              yours. The other one stays in Version history either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConflict(false);
                void onSave(true);
              }}
            >
              Save mine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeaveSheet
        open={leave}
        onOpenChange={setLeave}
        saving={editor.saving}
        onSave={async () => {
          setLeave(false);
          await onSave();
        }}
        onLeave={() => {
          setLeave(false);
          navigate({ to: editor.backTo as any });
        }}
      />
    </CellsProvider>
  );
}
