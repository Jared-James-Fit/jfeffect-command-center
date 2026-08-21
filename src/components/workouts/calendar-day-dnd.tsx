/**
 * Touch + pointer drag/drop for the client/coach workout calendar cells.
 *
 * Uses the existing @dnd-kit stack (PointerSensor + TouchSensor) instead of
 * native HTML5 drag events, so iPhone/iPad get press-and-hold rescheduling
 * while normal vertical scrolling keeps working (drag only activates after
 * the delay/tolerance constraint is satisfied).
 *
 * The canonical move itself still runs through `useMoveWorkout` — this file
 * only produces the gesture and the drop target.
 */
import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { WorkoutItem } from "@/lib/workout-today";

export type CalendarDnd = {
  dragging: boolean;
  draggingFromIso: string | null;
  canDragItem: (item: WorkoutItem) => boolean;
  onDragStartItem: (item: WorkoutItem, fromIso: string) => void;
  onDragEndItem: () => void;
  onDropDate: (iso: string) => void;
} | null;

/** iPad pointer events and iPhone touch both need a hold before dragging. */
export const CALENDAR_TOUCH_ACTIVATION = { delay: 200, tolerance: 8 } as const;
export const CALENDAR_POINTER_ACTIVATION = { distance: 6 } as const;

type Ctx = {
  dnd: CalendarDnd;
  activeIso: string | null;
  overIso: string | null;
  /** Set while a drag just ended so the source card never also opens. */
  suppressClickRef: React.MutableRefObject<number>;
};

const CalendarDndCtx = createContext<Ctx | null>(null);

export function CalendarDndProvider({
  dnd,
  children,
}: {
  dnd: CalendarDnd;
  children: React.ReactNode;
}) {
  const [activeIso, setActiveIso] = useState<string | null>(null);
  const [overIso, setOverIso] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const suppressClickRef = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: CALENDAR_POINTER_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: CALENDAR_TOUCH_ACTIVATION }),
  );

  const value = useMemo<Ctx>(
    () => ({ dnd, activeIso, overIso, suppressClickRef }),
    [dnd, activeIso, overIso],
  );

  if (!dnd) return <>{children}</>;

  const cellIso = (id: unknown) => {
    const raw = String(id ?? "");
    return raw.startsWith("cell:") ? raw.slice(5) : null;
  };

  const reset = () => {
    setActiveIso(null);
    setOverIso(null);
    setActiveLabel(null);
  };

  const handleStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      | { iso?: string; item?: WorkoutItem; label?: string }
      | undefined;
    if (!data?.iso || !data.item) return;
    suppressClickRef.current = Date.now();
    setActiveIso(data.iso);
    setActiveLabel(data.label ?? null);
    dnd.onDragStartItem(data.item, data.iso);
  };

  const handleEnd = (event: DragEndEvent) => {
    const to = cellIso(event.over?.id);
    const from = activeIso;
    suppressClickRef.current = Date.now();
    reset();
    if (to && to !== from) dnd.onDropDate(to);
    else dnd.onDragEndItem();
  };

  return (
    <CalendarDndCtx.Provider value={value}>
      <DndContext
        sensors={sensors}
        onDragStart={handleStart}
        onDragOver={(e) => setOverIso(cellIso(e.over?.id))}
        onDragCancel={() => {
          suppressClickRef.current = Date.now();
          reset();
          dnd.onDragEndItem();
        }}
        onDragEnd={handleEnd}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeIso ? (
            <div className="pointer-events-none rounded-lg border border-primary bg-card px-2 py-1 text-[10px] font-bold shadow-lg">
              {activeLabel ?? "Workout"}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </CalendarDndCtx.Provider>
  );
}

export type DayCellRenderProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  props: Record<string, unknown>;
  className: string;
};

/**
 * Wraps one calendar day cell. Renders through a child function so the cell
 * keeps whatever markup the week strip / month grid already uses.
 */
export function CalendarDayCell({
  iso,
  item,
  label,
  children,
}: {
  iso: string;
  item?: WorkoutItem;
  label?: string | null;
  children: (props: DayCellRenderProps) => React.ReactNode;
}) {
  const ctx = useContext(CalendarDndCtx);
  const dnd = ctx?.dnd ?? null;
  const canDrag = !!dnd && !!item && dnd.canDragItem(item);

  const drag = useDraggable({
    id: `drag:${iso}`,
    disabled: !canDrag,
    data: { iso, item, label },
  });
  const drop = useDroppable({ id: `cell:${iso}`, disabled: !dnd });

  if (!dnd) {
    return <>{children({ setNodeRef: () => {}, props: {}, className: "" })}</>;
  }

  const isSource = ctx?.activeIso === iso;
  const isDropTarget = !!ctx?.activeIso && ctx.activeIso !== iso;
  const isOver = isDropTarget && ctx?.overIso === iso;

  const setNodeRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node as HTMLElement);
    drop.setNodeRef(node as HTMLElement);
  };

  const props: Record<string, unknown> = {
    ...(canDrag ? drag.listeners : {}),
    ...drag.attributes,
    // A completed drag must never also click/open the card.
    onClickCapture: (e: React.MouseEvent) => {
      const last = ctx?.suppressClickRef.current ?? 0;
      if (last && Date.now() - last < 350) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };

  return (
    <>
      {children({
        setNodeRef,
        props,
        className: cn(
          canDrag && "cursor-grab active:cursor-grabbing",
          isSource && "opacity-50",
          isDropTarget && "ring-1 ring-primary/40",
          isOver && "scale-[1.03] bg-primary/10 ring-2 ring-primary",
        ),
      })}
    </>
  );
}
