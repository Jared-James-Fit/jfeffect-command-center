import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Clock, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { resolveWarmupForDay, filterPowerliftingSections, type WarmupSection } from "@/lib/warmups";
import { cn } from "@/lib/utils";

type Props = {
  dayId: string;
  blockId: string | null;
  clientId: string;
  warmupMode?: string | null;
  dayProtocolId?: string | null;
  exerciseRows: Array<{ exercise_id?: string | null; exercises?: any }>;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
};

export function WarmupButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size={props.size ?? "sm"}
        variant={props.variant ?? "outline"}
        className={cn("gap-1.5", props.className)}
        onClick={() => setOpen(true)}
      >
        <Flame className="h-4 w-4 text-orange-500" /> Warm-Up
      </Button>
      {open && <WarmupSheet {...props} open={open} onOpenChange={setOpen} />}
    </>
  );
}

function WarmupSheet({
  dayId,
  blockId,
  clientId,
  warmupMode,
  dayProtocolId,
  exerciseRows,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["warmup-resolve", dayId, clientId, warmupMode, dayProtocolId, exerciseRows.length],
    queryFn: () =>
      resolveWarmupForDay({
        dayId,
        blockId,
        clientId,
        warmupMode,
        dayProtocolId,
        exerciseRows,
      }),
  });

  const sections: WarmupSection[] = useMemo(() => {
    if (!data?.protocol) return [];
    if (data.protocol.category === "sbd" || data.protocol.is_default_powerlifting) {
      return filterPowerliftingSections(data.protocol, data.lifts);
    }
    return data.protocol.sections;
  }, [data]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg pb-32">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            {data?.protocol?.name ?? "Warm-Up"}
          </SheetTitle>
          {data?.protocol && (
            <SheetDescription className="flex flex-wrap items-center gap-2">
              {data.protocol.estimated_minutes != null && (
                <Badge variant="outline" className="text-[10px]">
                  <Clock className="mr-1 h-3 w-3" /> ~{data.protocol.estimated_minutes} min
                </Badge>
              )}
              {data.lifts.size > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  Lifts: {[...data.lifts].join(", ")}
                </Badge>
              )}
            </SheetDescription>
          )}
        </SheetHeader>

        {isLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data?.protocol ? (
          <div className="mt-6 text-sm text-muted-foreground">
            No warm-up assigned for this workout.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {data.protocol.notes && (
              <p className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                {data.protocol.notes}
              </p>
            )}
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements listed.</p>
            ) : (
              sections.map((s, i) => <SectionCard key={i} section={s} defaultOpen={i === 0} />)
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionCard({ section, defaultOpen }: { section: WarmupSection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-bold">{section.title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {(section.items ?? []).map((it, i) => (
            <li key={i} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium">{it.name}</div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {[it.sets ? `${it.sets} sets` : null, it.reps].filter(Boolean).join(" × ")}
                </div>
              </div>
              {it.notes && <div className="mt-1 text-xs text-muted-foreground">{it.notes}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}