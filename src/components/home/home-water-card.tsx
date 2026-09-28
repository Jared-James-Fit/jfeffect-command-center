import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplet, Plus, History, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  addWaterEntry, deleteWaterEntry, ensureWaterTarget, formatWater, listWaterForDate,
  summarizeToday, todayLocalISO, lToMl, ozToMl,
} from "@/lib/water";

type Surface = "portal" | "member";

interface Props {
  userId: string;
  currentUserId: string;
  surface: Surface;
}

const QUICK_ADDS = [
  { label: "+250ml", ml: 250 },
  { label: "+500ml", ml: 500 },
  { label: "+1L", ml: 1000 },
];

/**
 * Shared "Water Today" card for portal + member Home dashboards. Larger,
 * tappable quick-add buttons + visible progress bar. Reads/writes the
 * same data as the Progress page water tracker.
 */
export function HomeWaterCard({ userId, currentUserId, surface }: Props) {
  const today = todayLocalISO();
  const qc = useQueryClient();
  const [customOpen, setCustomOpen] = useState(false);

  const { data: target } = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId),
    staleTime: 30_000,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["water-today", userId, today],
    enabled: !!userId,
    queryFn: () => listWaterForDate(userId, today),
    staleTime: 5_000,
  });

  const targetMl = target?.active_ml ?? 3000;
  const summary = summarizeToday(entries, targetMl);

  async function quickAdd(ml: number) {
    try {
      await addWaterEntry({ userId, amountMl: ml, source: "quick_add", createdByUserId: currentUserId });
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
      qc.invalidateQueries({ queryKey: ["water-history", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log water");
    }
  }

  const lastEntry = entries[0];
  async function undoLast() {
    if (!lastEntry) return;
    try {
      await deleteWaterEntry(lastEntry.id);
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
      qc.invalidateQueries({ queryKey: ["water-history", userId] });
      toast.success(`Removed ${formatWater(lastEntry.amount_ml, "ml")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't undo");
    }
  }

  const historyHref = surface === "portal" ? "/portal/progress" : "/m/progress";

  return (
    <>
    <Card className="border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Droplet className="h-4 w-4" />
          </div>
          <h3 className="text-base font-bold">Water Today</h3>
        </div>
        <Link
          to={historyHref}
          search={{ action: "history" } as never}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" /> Open
        </Link>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-black tabular-nums">
            {formatWater(summary.total, "L")}
            <span className="ml-1 text-sm font-medium text-muted-foreground">/ {formatWater(targetMl, "L")}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{summary.pct}% of today's target</div>
        </div>
      </div>
      <Progress value={summary.pct} className="mt-3 h-2.5" />

      <div className="mt-4 grid grid-cols-4 gap-2">
        {QUICK_ADDS.map((q) => (
          <Button
            key={q.ml}
            variant="secondary"
            className="h-11 min-w-0 px-2 text-xs font-bold"
            onClick={() => quickAdd(q.ml)}
          >
            <Plus className="mr-0.5 h-3.5 w-3.5 shrink-0" />{q.label}
          </Button>
        ))}
        <Button
          variant="outline"
          className="h-11 min-w-0 px-2 text-xs font-bold"
          onClick={() => setCustomOpen(true)}
        >
          <Plus className="mr-0.5 h-3.5 w-3.5 shrink-0" />Custom
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="mt-4 rounded-xl border bg-secondary/25 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold">Today’s drink history</span>
            <span className="text-[11px] text-muted-foreground">{entries.length} {entries.length === 1 ? "drink" : "drinks"}</span>
          </div>
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-lg bg-background/80 px-3 py-2">
                <span className="text-sm font-semibold tabular-nums">{formatWater(entry.amount_ml, "ml")}</span>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {format(new Date(entry.entry_at), "h:mm:ss a")}
                </span>
              </div>
            ))}
          </div>
          <Link
            to={historyHref}
            search={{ action: "history" } as never}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md py-2 text-xs font-semibold text-sky-700 hover:bg-sky-500/10 dark:text-sky-300"
          >
            <History className="h-3.5 w-3.5" /> View full history
          </Link>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 h-9 w-full text-xs text-muted-foreground hover:text-foreground"
        onClick={undoLast}
        disabled={!lastEntry}
      >
        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
        {lastEntry ? `Undo last (−${formatWater(lastEntry.amount_ml, "ml")})` : "Nothing to undo"}
      </Button>
    </Card>
    <HomeCustomWaterDialog
      open={customOpen}
      onOpenChange={setCustomOpen}
      onConfirm={(ml) => quickAdd(ml)}
    />
    </>
  );
}

function HomeCustomWaterDialog({
  open, onOpenChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (amountMl: number) => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"ml" | "L" | "oz">("ml");

  function submit() {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return;
    const ml = unit === "ml" ? Math.round(n) : unit === "L" ? lToMl(n) : ozToMl(n);
    void onConfirm(ml);
    setAmount("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle>Custom water amount</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 text-base"
              placeholder={unit === "ml" ? "e.g. 600" : unit === "L" ? "e.g. 0.6" : "e.g. 20"}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Unit</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as "ml" | "L" | "oz")}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ml">mL</SelectItem>
                <SelectItem value="L">L</SelectItem>
                <SelectItem value="oz">oz</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2">
          <Button className="h-11 rounded-xl" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11 rounded-xl font-bold" disabled={!amount || Number(amount) <= 0} onClick={submit}>Add water</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}