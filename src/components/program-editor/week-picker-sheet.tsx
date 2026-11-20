import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

export type PickWeek = { id: string; label: string };
export type PickGroup = { name?: string; weeks: PickWeek[] };

/**
 * Pick the weeks something is copied onto (both program editors: a member's
 * builder and a coach's block or template). The week it comes from is shown
 * but can't be picked; quick picks for the usual answers (the rest of the
 * block, every later week, every week); the button says how many.
 */
export function WeekPickerSheet({
  open,
  onOpenChange,
  title,
  description,
  groups,
  fromId,
  quick,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  groups: PickGroup[];
  fromId: string;
  /** one-tap picks, e.g. { label: "Rest of Block 1", ids: [...] } */
  quick: { label: string; ids: string[] }[];
  onConfirm: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const n = picked.size;
  const close = (o: boolean) => {
    if (!o) setPicked(new Set());
    onOpenChange(o);
  };
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto sm:max-w-lg"
        data-week-picker
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-start gap-3 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-[18px] font-semibold leading-tight">{title}</SheetTitle>
            <SheetDescription className="mt-0.5 text-[13px]">{description}</SheetDescription>
          </div>
          <button
            type="button"
            onClick={() => close(false)}
            className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold hover:bg-secondary"
          >
            Done
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {quick
              .filter((q) => q.ids.some((id) => id !== fromId))
              .map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setPicked(new Set(q.ids.filter((id) => id !== fromId)))}
                  className="h-9 rounded-full bg-secondary px-3.5 text-[14px] font-medium"
                >
                  {q.label}
                </button>
              ))}
            {n > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="h-9 rounded-full bg-secondary px-3.5 text-[14px] font-medium">
                Clear
              </button>
            )}
          </div>
          <div className="space-y-3">
            {groups.map((g, gi) => (
              <div key={gi}>
                {g.name && <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{g.name}</div>}
                <div className="flex flex-wrap gap-1.5">
                  {g.weeks.map((wk) => {
                    const self = wk.id === fromId;
                    const on = picked.has(wk.id);
                    return (
                      <button
                        key={wk.id}
                        type="button"
                        disabled={self}
                        onClick={() =>
                          setPicked((s) => {
                            const next = new Set(s);
                            if (next.has(wk.id)) next.delete(wk.id);
                            else next.add(wk.id);
                            return next;
                          })
                        }
                        className={cn(
                          "grid h-11 min-w-11 place-items-center rounded-lg px-2 text-[15px] font-semibold tabular-nums transition-colors",
                          self ? "bg-muted text-muted-foreground" : on ? "bg-foreground text-background" : "border border-border",
                        )}
                        aria-pressed={on}
                        aria-label={`Week ${wk.label}${self ? " (copying from)" : ""}`}
                        data-copy-week={wk.id}
                      >
                        {wk.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Button
            className="h-12 w-full text-[15px]"
            disabled={!n}
            onClick={() => {
              onConfirm([...picked]);
              close(false);
            }}
            data-copy-confirm
          >
            {n ? `Copy to ${n} ${n === 1 ? "week" : "weeks"}` : "Pick the weeks"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
