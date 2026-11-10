import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Copy,
  Loader2,
  MoreHorizontal,
  Plus,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  goalLabel,
  levelLabel,
  type ProgramDay,
  type ProgramExercise,
} from "@/lib/athlete-programs";
import {
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_SETS,
  REPS_QUICK,
  REST_CHOICES,
  RPE_QUICK,
  addExercises,
  clampSets,
  duplicateDay,
  insertAt,
  moveItem,
  newDay,
  prescription,
  removeAt,
  swapExercise,
} from "@/lib/athlete-program-draft";
import { BestOnComputerTip } from "@/components/best-on-computer-tip";
import { ChoiceChip, ProgramDetailsFields, Stepper } from "./program-builder-parts";
import { ExercisePickerSheet } from "./exercise-picker-sheet";
import type { ProgramEditor } from "./use-program-editor";

const TIP_KEY = "jf.program-builder.desktop-tip";

/** Sits right above the floating tab bar, in thumb reach. */
const ACTION_BAR_STYLE = { bottom: "calc(var(--mobile-bar-top, 80px) + 8px)" };

/**
 * The builder on a phone: one training day at a time (day chips across the
 * top), each exercise a row that reads like the program page ("3 × 8-10 ·
 * RPE 8 · 2:00 rest") and opens a sheet of big taps to change it, and Add
 * exercises + Save pinned above the tab bar. Same draft and save as the
 * desktop layout (useProgramEditor).
 */
export function MobileProgramBuilder({ editor }: { editor: ProgramEditor }) {
  const { d, update, setDay } = editor;
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [picker, setPicker] = useState<null | { mode: "add" } | { mode: "swap"; j: number }>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const ai = Math.max(0, Math.min(active, d.days.length - 1));
  const day = d.days[ai];
  const room = day ? MAX_EXERCISES - day.exercises.length : 0;
  const editingEx = editing != null ? day?.exercises[editing] : undefined;

  const showDay = (i: number) => {
    setActive(i);
    setEditing(null);
  };

  const onSave = async () => {
    const r = await editor.save();
    if (r.ok) return;
    if (r.at === "title") nameRef.current?.focus();
    else if (typeof r.at === "number") {
      showDay(r.at);
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    }
  };

  const addDay = () => {
    if (d.days.length >= MAX_DAYS) return;
    const at = d.days.length;
    update((x) => ({ ...x, days: [...x.days, newDay(x.days.length)] }));
    showDay(at);
  };

  const removeDay = (i: number) => {
    const gone = d.days[i];
    if (!gone || d.days.length <= 1) return;
    update((x) => ({ ...x, days: removeAt(x.days, i) }));
    showDay(Math.max(0, i - 1));
    toast(`Deleted ${gone.title.trim() || `Day ${i + 1}`}`, {
      action: {
        label: "Undo",
        onClick: () => {
          update((x) =>
            x.days.length >= MAX_DAYS ? x : { ...x, days: insertAt(x.days, i, gone) },
          );
          setActive(i);
        },
      },
    });
  };

  const setEx = (j: number, patch: Partial<ProgramExercise>) =>
    setDay(ai, (x) => ({
      ...x,
      exercises: x.exercises.map((e, k) => (k === j ? { ...e, ...patch } : e)),
    }));

  const removeEx = (j: number) => {
    const gone = day?.exercises[j];
    if (!gone) return;
    const dayIndex = ai;
    setEditing(null);
    setDay(dayIndex, (x) => ({ ...x, exercises: removeAt(x.exercises, j) }));
    toast(`Removed ${gone.name ?? "the exercise"}`, {
      action: {
        label: "Undo",
        onClick: () =>
          setDay(dayIndex, (x) =>
            x.exercises.length >= MAX_EXERCISES
              ? x
              : { ...x, exercises: insertAt(x.exercises, j, gone) },
          ),
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title={editor.editing ? "Edit program" : "New program"} backTo={editor.backTo} />

      <div className="space-y-4 px-4 pb-[calc(var(--mobile-bar-top,80px)+96px)] pt-3">
        <BestOnComputerTip storageKey={TIP_KEY}>
          Big programs are quicker at jfeffect.com on a computer, same login. Everything works here
          too.
        </BestOnComputerTip>

        <Input
          ref={nameRef}
          value={d.title}
          onChange={(e) => update((x) => ({ ...x, title: e.target.value.slice(0, 80) }))}
          placeholder="Program name, like Upper / Lower 4x"
          aria-label="Program name"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-12 text-[17px] font-semibold"
        />

        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-left transition active:scale-[0.99]"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Program details</div>
            <div className="truncate text-[13px] text-muted-foreground">{detailsLine(d)}</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>

        <DayChips days={d.days} active={ai} onPick={showDay} onAdd={addDay} />

        {day ? (
          <div ref={panelRef} className="scroll-mt-4 space-y-3">
            <div className="flex items-center gap-1">
              <Input
                value={day.title}
                onChange={(e) => setDay(ai, (x) => ({ ...x, title: e.target.value.slice(0, 40) }))}
                aria-label={`Day ${ai + 1} name`}
                placeholder="Upper, Legs, Push…"
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-[18px] font-semibold shadow-none focus-visible:ring-0"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={`Day ${ai + 1} options`}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={ai === 0}
                    onSelect={() => {
                      update((x) => ({ ...x, days: moveItem(x.days, ai, -1) }));
                      showDay(ai - 1);
                    }}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Move earlier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={ai === d.days.length - 1}
                    onSelect={() => {
                      update((x) => ({ ...x, days: moveItem(x.days, ai, 1) }));
                      showDay(ai + 1);
                    }}
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Move later
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={d.days.length >= MAX_DAYS}
                    onSelect={() => {
                      update((x) => ({ ...x, days: duplicateDay(x.days, ai) }));
                      showDay(ai + 1);
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate day
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={d.days.length <= 1}
                    onSelect={() => removeDay(ai)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete day
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {day.exercises.length ? (
              <>
                <ol className="space-y-2">
                  {day.exercises.map((e, j) => (
                    <li key={`${e.exercise_id}-${j}`}>
                      <button
                        type="button"
                        onClick={() => setEditing(j)}
                        className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-left transition active:scale-[0.99]"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-semibold tabular-nums text-muted-foreground">
                          {j + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">
                            {e.name ?? "Exercise"}
                          </div>
                          <div className="truncate text-[13px] text-muted-foreground">
                            {prescription(e)}
                          </div>
                          {e.notes ? (
                            <div className="truncate text-[12px] text-muted-foreground">
                              {e.notes}
                            </div>
                          ) : null}
                        </div>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="text-center text-[13px] text-muted-foreground">
                  {daySummary(day)}
                  {room <= 0 ? ` · ${MAX_EXERCISES} is the most for one day` : ""}
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPicker({ mode: "add" })}
                className="w-full rounded-2xl border border-dashed border-border px-4 py-7 text-center transition active:scale-[0.99]"
              >
                <span className="block text-[15px] font-medium">Nothing on this day yet</span>
                <span className="mt-1 block text-[13px] text-muted-foreground">
                  Tap here or Add exercises below. Pick a few at once.
                </span>
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div
        data-hide-on-keyboard
        className="fixed inset-x-4 z-40 mx-auto flex max-w-md gap-2 rounded-2xl border border-border bg-card/95 p-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden"
        style={ACTION_BAR_STYLE}
      >
        <Button
          variant="outline"
          className="h-12 flex-1 text-[15px]"
          disabled={!day || room <= 0}
          onClick={() => setPicker({ mode: "add" })}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Add exercises
        </Button>
        <Button
          className="h-12 min-w-[104px] text-[15px]"
          onClick={onSave}
          disabled={editor.saving}
        >
          {editor.saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <ExercisePickerSheet
        open={picker != null}
        onOpenChange={(open) => !open && setPicker(null)}
        mode={picker?.mode === "swap" ? "single" : "multi"}
        room={room}
        title={
          picker?.mode === "swap"
            ? `Swap ${day?.exercises[picker.j]?.name ?? "exercise"}`
            : `Add to ${day?.title.trim() || `Day ${ai + 1}`}`
        }
        description={
          picker?.mode === "swap"
            ? "Keeps its sets, reps, RPE, rest and note."
            : "Tap as many as you want, in the order you'll do them."
        }
        onPick={(list) => {
          if (picker?.mode === "swap") {
            const j = picker.j;
            setDay(ai, (x) => ({
              ...x,
              exercises: x.exercises.map((e, k) => (k === j ? swapExercise(e, list[0]) : e)),
            }));
            return;
          }
          if (!day) return;
          const r = addExercises(day, list);
          setDay(ai, () => r.day);
          if (r.skipped)
            toast(`${r.skipped} didn't fit: ${MAX_EXERCISES} is the most for one day.`);
        }}
      />

      <ExerciseSheet
        e={editingEx}
        index={editing ?? 0}
        count={day?.exercises.length ?? 0}
        onClose={() => setEditing(null)}
        onChange={(patch) => editing != null && setEx(editing, patch)}
        onMove={(dir) => {
          if (editing == null) return;
          setDay(ai, (x) => ({ ...x, exercises: moveItem(x.exercises, editing, dir) }));
          setEditing(editing + dir);
        }}
        onSwap={() => {
          if (editing == null) return;
          const j = editing;
          setEditing(null);
          setPicker({ mode: "swap", j });
        }}
        onRemove={() => editing != null && removeEx(editing)}
      />

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent
          side="bottom"
          hideCloseButton
          className="max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2"
        >
          <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="pb-1 text-base font-semibold">Program details</SheetTitle>
          <SheetDescription className="pb-3 text-[13px]">
            How long it runs and who it's for.
          </SheetDescription>
          <ProgramDetailsFields d={d} update={update} />
          <Button className="mt-5 h-12 w-full text-base" onClick={() => setDetailsOpen(false)}>
            Done
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function detailsLine(d: { weeks: number; goal: string | null; level: string | null }) {
  const parts = [`${d.weeks} ${d.weeks === 1 ? "week" : "weeks"}`];
  const goal = goalLabel(d.goal);
  const level = levelLabel(d.level);
  if (goal) parts.push(goal);
  if (level) parts.push(level);
  if (!goal && !level) parts.push("goal and level (optional)");
  return parts.join(" · ");
}

function daySummary(day: ProgramDay) {
  const n = day.exercises.length;
  const sets = day.exercises.reduce((sum, e) => sum + (Number(e.sets) || 0), 0);
  return `${n} ${n === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"}`;
}

/** Day 1 · Day 2 · … · + Day, across the top; the one you're on is filled. */
function DayChips({
  days,
  active,
  onPick,
  onAdd,
}: {
  days: ProgramDay[];
  active: number;
  onPick: (i: number) => void;
  onAdd: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // keep the day you're on in view (sideways only, never scrolling the page)
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>(`[data-day-chip="${active}"]`);
    if (!row || !chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollTo({ left, behavior: "smooth" });
    else if (row.scrollLeft < right) row.scrollTo({ left: right, behavior: "smooth" });
  }, [active, days.length]);

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label="Training days"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((day, i) => {
        const on = i === active;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={on}
            data-day-chip={i}
            onClick={() => onPick(i)}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] transition active:scale-[0.97]",
              on
                ? "border-foreground bg-foreground font-semibold text-background"
                : "border-border bg-background text-foreground",
            )}
          >
            <span className="max-w-[9rem] truncate">{day.title.trim() || `Day ${i + 1}`}</span>
            <span
              className={cn(
                "tabular-nums text-[12px]",
                on ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {day.exercises.length}
            </span>
          </button>
        );
      })}
      {days.length < MAX_DAYS ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-4 text-[14px] text-muted-foreground transition active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Day
        </button>
      ) : null}
    </div>
  );
}

/** One exercise's prescription as big taps: sets −/+, reps / RPE / rest one tap each. */
function ExerciseSheet({
  e,
  index,
  count,
  onClose,
  onChange,
  onMove,
  onSwap,
  onRemove,
}: {
  e: ProgramExercise | undefined;
  index: number;
  count: number;
  onClose: () => void;
  onChange: (patch: Partial<ProgramExercise>) => void;
  onMove: (dir: -1 | 1) => void;
  onSwap: () => void;
  onRemove: () => void;
}) {
  // keep the last exercise on screen while the sheet slides away
  const last = useRef(e);
  if (e) last.current = e;
  const open = !!e;
  e = e ?? last.current;
  const sets = clampSets(Number(e?.sets) || 1);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2"
      >
        {e ? (
          <div className="space-y-5">
            <div>
              <div
                aria-hidden
                className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30"
              />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-[17px] font-semibold leading-snug">
                    {e.name ?? "Exercise"}
                  </SheetTitle>
                  <SheetDescription className="text-[13px]">
                    {[`Exercise ${index + 1} of ${count}`, e.muscle_group, e.equipment]
                      .filter(Boolean)
                      .join(" · ")}
                  </SheetDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-mr-2 h-10 w-10 shrink-0"
                  aria-label="Close"
                  onClick={onClose}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-medium">Sets</span>
              <Stepper
                size="lg"
                value={sets}
                min={1}
                max={MAX_SETS}
                less="Fewer sets"
                more="More sets"
                onChange={(n) => onChange({ sets: clampSets(n) })}
              />
            </div>

            <QuickField
              label="Reps"
              value={e.reps ?? ""}
              placeholder="8-10"
              inputMode="text"
              choices={REPS_QUICK}
              onChange={(v) => onChange({ reps: v.slice(0, 20) })}
            />

            <QuickField
              label="RPE"
              hint="optional"
              value={e.rpe ?? ""}
              placeholder="—"
              inputMode="decimal"
              choices={RPE_QUICK}
              noneLabel="None"
              onChange={(v) => onChange({ rpe: v.replace(/[^\d.-]/g, "").slice(0, 7) || null })}
            />

            <div>
              <div className="mb-2 text-[15px] font-medium">Rest</div>
              <div className="flex flex-wrap gap-1.5">
                {REST_CHOICES.map((r) => (
                  <ChoiceChip
                    key={r.label}
                    className="px-3"
                    selected={(e.rest_seconds ?? null) === r.seconds}
                    onClick={() => onChange({ rest_seconds: r.seconds })}
                  >
                    {r.seconds == null ? "None" : r.label}
                  </ChoiceChip>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[15px] font-medium">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </div>
              <Input
                value={e.notes ?? ""}
                placeholder="Tempo, cue, setup"
                aria-label="Note"
                enterKeyHint="done"
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                }}
                onChange={(ev) => onChange({ notes: ev.target.value.slice(0, 200) || null })}
                className="h-11 text-base"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Button
                variant="secondary"
                className="h-12 flex-col gap-0.5 px-1 text-[12px] font-normal"
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
                Move up
              </Button>
              <Button
                variant="secondary"
                className="h-12 flex-col gap-0.5 px-1 text-[12px] font-normal"
                disabled={index >= count - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
                Move down
              </Button>
              <Button
                variant="secondary"
                className="h-12 flex-col gap-0.5 px-1 text-[12px] font-normal"
                onClick={onSwap}
              >
                <Repeat2 className="h-4 w-4" aria-hidden />
                Swap
              </Button>
              <Button
                variant="secondary"
                className="h-12 flex-col gap-0.5 px-1 text-[12px] font-normal text-destructive"
                onClick={onRemove}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </Button>
            </div>

            <Button className="h-12 w-full text-base" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** A box that takes anything, with the common answers one tap above it. */
function QuickField({
  label,
  hint,
  value,
  placeholder,
  inputMode,
  choices,
  noneLabel,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  inputMode: "text" | "decimal";
  choices: string[];
  /** Offer a "no value" chip (clears it). */
  noneLabel?: string;
  onChange: (v: string) => void;
}) {
  const v = value.trim();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium">
          {label}
          {hint ? <span className="font-normal text-muted-foreground"> ({hint})</span> : null}
        </span>
        <Input
          value={value}
          placeholder={placeholder}
          aria-label={label}
          inputMode={inputMode}
          enterKeyHint="done"
          onKeyDown={(ev) => {
            if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
          }}
          onChange={(ev) => onChange(ev.target.value)}
          className="h-11 w-28 text-center text-base font-semibold tabular-nums"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {noneLabel ? (
          <ChoiceChip className="px-3" selected={!v} onClick={() => onChange("")}>
            {noneLabel}
          </ChoiceChip>
        ) : null}
        {choices.map((c) => (
          <ChoiceChip key={c} className="px-3" selected={v === c} onClick={() => onChange(c)}>
            {c}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}
