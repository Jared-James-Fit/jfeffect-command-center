import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, History, Loader2, RotateCcw } from "lucide-react";
import {
  getScheduleHistory,
  undoScheduleChange,
} from "@/lib/schedule-manager.functions";

const scopeLabel: Record<string, string> = {
  single: "Single move",
  swap: "Swap",
  week: "Week change",
  pattern: "Pattern change",
  block: "Block-wide",
  program: "All future",
  custom: "Custom selection",
  "completed-override": "Override (completed)",
  undo: "Undo",
  "shift-following": "Shift following",
};

const roleLabel: Record<string, string> = {
  client: "Client",
  member: "Member",
  coach: "Coach",
  admin: "Admin",
  system: "System",
};

export function ScheduleHistoryDrawer({
  clientId,
  open,
  onOpenChange,
  canUndo = true,
}: {
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUndo?: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchHistory = useServerFn(getScheduleHistory);
  const undo = useServerFn(undoScheduleChange);

  const q = useQuery({
    queryKey: ["schedule-history", clientId],
    enabled: open && !!clientId,
    queryFn: () => fetchHistory({ data: { clientId: clientId!, limit: 100 } }),
  });

  const rows = q.data?.rows ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Schedule history
          </SheetTitle>
          <SheetDescription>
            Every schedule change for this account — newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {q.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!q.isLoading && rows.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No schedule changes yet.
            </div>
          )}
          {rows.map((r: any) => {
            const title = r.day?.title?.trim() || (r.day ? `Day ${r.day.day_index}` : "Workout");
            const prev = r.previous_date ? format(parseISO(r.previous_date), "EEE MMM d") : "—";
            const next = r.new_date ? format(parseISO(r.new_date), "EEE MMM d") : "—";
            return (
              <div
                key={r.id}
                className="rounded-md border border-border bg-card p-3 text-xs space-y-1"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{title}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {scopeLabel[r.scope] ?? r.scope}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {roleLabel[r.changed_by_role] ?? r.changed_by_role}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span>{prev}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium">{next}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{format(parseISO(r.created_at), "MMM d, yyyy · h:mm a")}</span>
                  {canUndo && r.scope !== "undo" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      onClick={async () => {
                        try {
                          await undo({ data: { batchId: r.batch_id } });
                          toast.success("Change reverted.");
                          void queryClient.invalidateQueries();
                        } catch (e: any) {
                          toast.error(e?.message ?? "Could not undo.");
                        }
                      }}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" /> Undo
                    </Button>
                  )}
                </div>
                {r.note && (
                  <div className="text-[10px] italic text-muted-foreground">{r.note}</div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}