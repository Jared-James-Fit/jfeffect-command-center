import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  CopyPlus,
  Layers,
  Loader2,
  MoreHorizontal,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsMobileNow } from "@/hooks/use-mobile";
import type { ExerciseLite } from "@/components/workout-day/workout-add-exercise";
import {
  MAX_DAYS,
  MAX_EXERCISES,
  addBackoff,
  addBlock,
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
  duplicateWeek,
  moveBlock,
  moveDay,
  moveExercise,
  newPlanExercise,
  planMeta,
  programWeek,
  refOfWeek,
  removeBlock,
  removeDay,
  removeExercise,
  removeWeek,
  renameBlock,
  scopeLabel,
  scopeWeeks,
  setBlockLength,
  setDay,
  setExercise,
  setProgramLength,
  splitIntoBlocks,
  swapExercise,
  totalWeeks,
  weekAt,
  type Cursor,
  type PlanExercise,
  type Scope,
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
  ExerciseRow,
  WeekBar,
} from "./rows";
import {
  CopyWeeksSheet,
  DaySheet,
  ExerciseSheet,
  LeaveSheet,
  ProgramSheet,
  ProgressionSheet,
} from "./sheets";

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
}: {
  editor: ProgramEditor;
  /** A panel above the day (an import's review), given ways to move around and fix things. */
  review?: (api: WorkbenchReviewApi) => ReactNode;
}) {
  const navigate = useNavigate();
  const desktop = !useIsMobileNow();
  const { d, edit } = editor;
  const plan = d.plan;

  const [cursorRaw, setCursor] = useState<Cursor>({ b: 0, w: 0, d: 0 });
  const cur = clampCursor(plan, cursorRaw);
  const [scope, setScope] = useState<Scope>(() => defaultScope(plan, 0));
  const week = weekAt(plan, cur)!;
  const day = week.days[cur.d] ?? null;
  const targets = useMemo(() => scopeWeeks(plan, cur, scope), [plan, cur.b, cur.w, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopeText = scopeLabel(plan, cur, scope);

  // the cell being typed in, and the weight unit loads start in
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [unit, setUnit] = useState<"lb" | "kg">(() => {
    for (const b of plan.blocks) for (const w of b.weeks) for (const dd of w.days) for (const e of dd.exercises) if (e.load != null && e.unit) return e.unit;
    return "lb";
  });

  const [exSheet, setExSheet] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState(false);
  const [programSheet, setProgramSheet] = useState(false);
  const [copy, setCopy] = useState<null | { day: string | null }>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [leave, setLeave] = useState(false);
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
      const el = document.querySelector<HTMLElement>(`[data-pb-row="${CSS.escape(key)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.setAttribute("data-pb-flash", "");
      setTimeout(() => el.removeAttribute("data-pb-flash"), 1600);
    }, 60);
  };

  const onSave = async () => {
    const r = await editor.save();
    if (r.ok) return;
    if (r.at === "title") titleRef.current?.focus();
    else if (r.at && typeof r.at === "object") goCursor(r.at);
  };
  const onBack = () => {
    if (editor.dirty) setLeave(true);
    else navigate({ to: editor.backTo as any });
  };

  /* ---- exercises ---- */
  const patchEx = (exKey: string, p: Partial<PlanExercise>, merge?: string) => {
    if (!day) return;
    edit((x) => setExercise(x, targets, day.key, exKey, p), merge ?? `${exKey}:${Object.keys(p).join(",")}:${scope}`);
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
    undoable(`Removed ${name} from ${scopeText}`);
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setProgramSheet(true)} className="min-h-11">
          <Layers className="mr-2 h-4 w-4" /> Length & blocks…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const hasExercises = plan.blocks.some((bl) => bl.weeks.some((w) => w.days.some((x) => x.exercises.length > 0)));
  const readyToSave = editor.dirty && hasExercises;
  const exSheetEx = exSheet && day ? day.exercises.find((e) => e.key === exSheet) ?? null : null;
  const exIndex = exSheetEx && day ? day.exercises.indexOf(exSheetEx) : -1;

  return (
    <CellsProvider value={{ active, setActive, unit, setUnit }}>
      <div className={cn("mx-auto w-full", desktop ? "max-w-5xl px-4 pb-6 md:px-8" : "pb-[calc(env(safe-area-inset-bottom)+7.5rem)]")} data-program-workbench>
        {/* Header: back, the name, Undo / Redo, Save; the days under it */}
        <header
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
              <button
                type="button"
                onClick={() => setProgramSheet(true)}
                className="block max-w-full truncate text-left text-[12px] text-muted-foreground hover:text-foreground"
                data-program-meta
              >
                {planMeta(plan, { days: false })} ›
              </button>
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
            <Button
              onClick={onSave}
              disabled={editor.saving || (editor.editing && !editor.dirty)}
              // the screen's one red button: Save once there's something to save, else Add exercises
              variant={readyToSave ? "default" : "secondary"}
              className="h-10 shrink-0 px-4 text-[15px]"
              data-save
            >
              {editor.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editor.editing && !editor.dirty ? "Saved" : "Save"}
            </Button>
          </div>
          <div className="pb-1.5">
            <DayTabs
              days={week.days}
              active={cur.d}
              onPick={(i) => setCursor({ ...cur, d: i })}
              onAdd={addNewDay}
              canAdd={week.days.length < MAX_DAYS}
              onDayMenu={() => setDaySheet(true)}
            />
          </div>
        </header>
        {/* the fixed header's room on a phone */}
        {!desktop && <div aria-hidden style={{ height: "calc(var(--app-chrome-top) + var(--app-safe-top) + 6.6rem)" }} />}

        {review && (
          <div className={cn(desktop ? "pt-4" : "px-3 pt-2")} data-workbench-review>
            {review({
              plan,
              goTo,
              resolve: (name) => setPicker({ mode: "resolve", name }),
              edit: (fn) => edit(fn),
            })}
          </div>
        )}

        {/* The day */}
        <section className={cn(desktop ? "pt-4" : "px-3 pt-2")} aria-label={day ? day.title : "Day"}>
          {day && day.exercises.length > 0 ? (
            <>
              <ColumnHeads desktop={desktop} />
              <div className={cn(desktop ? "space-y-0.5" : "divide-y divide-border/50")} data-day-list>
                {day.exercises.map((e, i) => (
                  <ExerciseRow
                    key={e.key}
                    e={e}
                    index={i}
                    desktop={desktop}
                    changed={changedFromLastWeek(plan, cur, day.key, e.key) as Set<string>}
                    onPatch={(p) => patchEx(e.key, p)}
                    onOpen={() =>
                      e.exercise_id ? setExSheet(e.key) : setPicker({ mode: "resolve", name: e.source_name ?? e.name ?? "" })
                    }
                  />
                ))}
              </div>
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

        <WeekBar
          plan={plan}
          cursor={cur}
          scope={scope}
          targets={targets}
          onScope={setScope}
          onPick={goWeek}
          weekMenu={weekMenu}
          desktop={desktop}
        />
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
            const exKey = picker.exKey;
            edit((x) => swapExercise(x, targets, day.key, exKey, picked[0]));
            undoable(`Swapped in ${picked[0].name} (${scopeText})`);
          } else addPicked(picked);
        }}
      />

      <ExerciseSheet
        open={!!exSheetEx}
        onOpenChange={(o) => !o && setExSheet(null)}
        e={exSheetEx}
        scopeText={scopeText}
        canUp={exIndex > 0}
        canDown={!!day && exIndex >= 0 && exIndex < day.exercises.length - 1}
        onPatch={(p, merge) => exSheetEx && patchEx(exSheetEx.key, p, merge)}
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
        onBackoff={() => {
          if (!exSheetEx || !day) return;
          edit((x) => addBackoff(x, targets, day.key, exSheetEx.key));
          setExSheet(null);
          undoable(`Added back-off sets (${scopeText})`);
        }}
        onMove={(dir) => exSheetEx && day && edit((x) => moveExercise(x, targets, day.key, exSheetEx.key, dir))}
        onRemove={() => exSheetEx && removeEx(exSheetEx.key)}
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
