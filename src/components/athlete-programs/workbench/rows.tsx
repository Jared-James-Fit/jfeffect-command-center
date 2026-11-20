import { useEffect } from "react";
import { Check, ChevronDown, Layers, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  programWeek,
  scopeLabel,
  totalWeeks as totalWeeksOf,
  type Cursor,
  type PlanExercise,
  type ProgramPlan,
  type Scope,
  type WeekRef,
} from "@/lib/program-plan";
import { CELL_LABEL, type CellField } from "@/lib/program-cells";
import { Cell } from "./cells";

/** The columns, in the order a coach writes them. */
const FIELDS: CellField[] = ["sets", "reps", "effort", "load", "rest"];

/** Phone: the name over its five cells. Desktop: one row of a sheet. */
export const PHONE_GRID = "grid grid-cols-[0.8fr_1.15fr_0.95fr_1.3fr_1fr] gap-1.5";
export const DESK_GRID =
  "grid grid-cols-[1.75rem_minmax(0,1fr)_4rem_5.5rem_4.5rem_6.5rem_5rem_2.5rem] items-center gap-2";

/** Column names once over the list (a phone's cells are too small to label each). */
export function ColumnHeads({ desktop }: { desktop: boolean }) {
  const heads = FIELDS.map((f) => (
    <span key={f} className="text-center">
      {CELL_LABEL[f]}
    </span>
  ));
  return desktop ? (
    <div className={cn(DESK_GRID, "px-3 pb-1 text-[11px] font-medium text-muted-foreground")} aria-hidden>
      <span />
      <span>Exercise</span>
      {heads}
      <span />
    </div>
  ) : (
    <div className={cn(PHONE_GRID, "pb-1 pl-7 text-[11px] font-medium text-muted-foreground")} aria-hidden>
      {heads}
    </div>
  );
}

/**
 * One exercise: its name (a tap opens what else it can do: swap, notes,
 * progression, back-offs, move, remove) and its numbers typed straight in.
 */
export function ExerciseRow({
  e,
  index,
  changed,
  onPatch,
  onOpen,
  desktop,
}: {
  e: PlanExercise;
  index: number;
  changed: Set<string>;
  onPatch: (p: Partial<PlanExercise>) => void;
  onOpen: () => void;
  desktop: boolean;
}) {
  const backoff = e.pct != null && e.pct_of === "top_set";
  const name = (
    <>
      <span className="block truncate text-[15px] font-medium leading-snug">{e.name ?? "Exercise"}</span>
      {(backoff || e.notes || e.tempo) && (
        <span className="block truncate text-[12px] text-muted-foreground">
          {[backoff ? "Back-off sets" : null, e.tempo ? `Tempo ${e.tempo}` : null, e.notes].filter(Boolean).join(" · ")}
        </span>
      )}
    </>
  );
  const cells = FIELDS.map((f) => (
    <Cell key={f} e={e} field={f} onPatch={onPatch} changed={changed.has(f === "effort" ? (e.rir ? "rir" : "rpe") : f)} label={!desktop} />
  ));

  if (desktop) {
    return (
      <div className={cn(DESK_GRID, "rounded-xl px-3 py-1.5 hover:bg-muted/30")} data-pb-row={e.key}>
        <span className="text-center text-[12px] tabular-nums text-muted-foreground">{index + 1}</span>
        <button type="button" onClick={onOpen} className="min-w-0 text-left" aria-label={`${e.name ?? "Exercise"}: more`}>
          {name}
        </button>
        {cells}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`More for ${e.name ?? "this exercise"}`}
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="py-2" data-pb-row={e.key}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-9 w-full items-center gap-2 text-left"
        aria-label={`${e.name ?? "Exercise"}: more`}
      >
        <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1">{name}</span>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <div className={cn(PHONE_GRID, "mt-1 pl-7")}>{cells}</div>
    </div>
  );
}

/**
 * The bottom of the builder, Google Sheets' tabs: every week of the program
 * as a tab (grouped by block), the one on screen filled and the ones an edit
 * will reach outlined, with what an edit reaches said above them and the
 * week's own tools in ⋯.
 */
export function WeekBar({
  plan,
  cursor,
  scope,
  targets,
  onScope,
  onPick,
  weekMenu,
  desktop,
}: {
  plan: ProgramPlan;
  cursor: Cursor;
  scope: Scope;
  targets: WeekRef[];
  onScope: (s: Scope) => void;
  onPick: (b: number, w: number) => void;
  weekMenu: React.ReactNode;
  desktop: boolean;
}) {
  const { ref: strip, style: stripFade } = useScrollFade([plan.blocks.length, totalWeeksOf(plan)]);
  const hit = new Set(targets.map((t) => `${t.b}:${t.w}`));
  const multi = plan.blocks.length > 1;
  const g = programWeek(plan, cursor);

  // the week on screen stays in view as it changes
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-week-tab="${cursor.b}:${cursor.w}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [cursor.b, cursor.w]);

  const scopes: Scope[] = plan.blocks[cursor.b].weeks.length > 1 ? ["week", "following", "block"] : ["week"];
  return (
    <div
      className={cn(
        "z-40 border-t border-border bg-background",
        desktop ? "sticky bottom-0 -mx-4 px-4 pb-3 pt-2" : "phone-column fixed inset-x-0 bottom-0 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5",
      )}
      data-week-bar
      data-hide-on-keyboard
    >
      <div className="flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-ml-1 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-[13px] text-muted-foreground transition hover:bg-secondary"
              data-scope-chip={scope}
            >
              <span className="shrink-0">Edits apply to</span>
              <span className="truncate font-semibold text-foreground">{scopeLabel(plan, cursor, scope)}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-72">
            <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
              Which weeks an edit on this screen changes
            </DropdownMenuLabel>
            {scopes.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onScope(s)} className="min-h-11 gap-2" data-scope-option={s}>
                <Check className={cn("h-4 w-4", s === scope ? "opacity-100" : "opacity-0")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{scopeLabel(plan, cursor, s)}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {s === "week" ? "Make this week different" : s === "following" ? "From this week on" : "Keep every week the same"}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* the tabs say which week is on screen; a computer has room to say it in words too */}
        {desktop && (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground tabular-nums">
            {multi && <Layers className="h-3.5 w-3.5" aria-hidden />}
            {multi ? `${plan.blocks[cursor.b].name} · ` : ""}Week {g} of {plan.blocks.reduce((n, b) => n + b.weeks.length, 0)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <div ref={strip} style={stripFade} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 no-scrollbar" role="tablist" aria-label="Weeks">
          {plan.blocks.map((block, b) => (
            <div key={block.key} className="flex shrink-0 items-center gap-1">
              {b > 0 && <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />}
              {multi && (
                <span className="mr-0.5 max-w-[5.5rem] shrink-0 truncate text-[11px] font-medium text-muted-foreground">
                  {block.name}
                </span>
              )}
              {block.weeks.map((week, w) => {
                const on = b === cursor.b && w === cursor.w;
                const reached = hit.has(`${b}:${w}`);
                return (
                  <button
                    key={week.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-label={`Week ${programWeek(plan, { b, w })}${reached && !on ? ", changes with this edit" : ""}`}
                    onClick={() => onPick(b, w)}
                    className={cn(
                      "grid h-10 min-w-10 shrink-0 place-items-center rounded-lg px-2 text-[14px] font-semibold tabular-nums transition-colors",
                      on
                        ? "bg-foreground text-background"
                        : reached
                          ? "bg-foreground/[0.07] text-foreground ring-1 ring-inset ring-foreground/30"
                          : "text-muted-foreground hover:bg-secondary",
                    )}
                    data-week-tab={`${b}:${w}`}
                    data-week-reached={reached ? "" : undefined}
                  >
                    {programWeek(plan, { b, w })}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {weekMenu}
      </div>
    </div>
  );
}

/** The training days of the week on screen, as tabs, with + for another day. */
export function DayTabs({
  days,
  active,
  onPick,
  onAdd,
  canAdd,
  onDayMenu,
}: {
  days: { key: string; title: string; exercises: unknown[] }[];
  active: number;
  onPick: (i: number) => void;
  onAdd: () => void;
  canAdd: boolean;
  onDayMenu: () => void;
}) {
  const { ref: strip, style: stripFade } = useScrollFade([days.length]);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-day-tab="${active}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [active]);
  return (
    <div className="flex items-center gap-1.5">
      <div ref={strip} style={stripFade} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 no-scrollbar" role="tablist" aria-label="Training days">
        {days.map((d, i) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => (i === active ? onDayMenu() : onPick(i))}
            className={cn(
              "inline-flex h-9 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors",
              i === active ? "bg-foreground text-background" : "bg-secondary text-foreground",
            )}
            data-day-tab={i}
          >
            <span className="truncate">{d.title || `Day ${i + 1}`}</span>
            {d.exercises.length > 0 && (
              <span className={cn("text-[12px] tabular-nums", i === active ? "text-background/70" : "text-muted-foreground")}>
                {d.exercises.length}
              </span>
            )}
          </button>
        ))}
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-dashed border-border px-3 text-[14px] font-medium text-muted-foreground"
            data-add-day
          >
            + Day
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDayMenu}
        aria-label="This day's options"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
        data-day-menu
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger };
