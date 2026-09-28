import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplet, Plus, Undo2, History, Settings2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  addWaterEntry, deleteWaterEntry, ensureWaterTarget, formatWater,
  listWaterForDate, lToMl, ozToMl, QUICK_ADD_ML, summarizeToday,
  todayLocalISO, type WaterEntry,
} from "@/lib/water";
import { WaterTargetDialog } from "./water-target-dialog";
import { WaterHistorySheet } from "./water-history-sheet";

export function WaterTrackerCard({
  userId,
  currentUserId,
  viewerRole,
  compact = false,
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [customOpen, setCustomOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = useMemo(() => todayLocalISO(), []);

  const targetQ = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId),
    staleTime: 30_000,
  });
  const entriesQ = useQuery({
    queryKey: ["water-today", userId, today],
    enabled: !!userId,
    queryFn: () => listWaterForDate(userId, today),
    staleTime: 5_000,
  });

  const target = targetQ.data;
  const entries = entriesQ.data ?? [];
  const summary = summarizeToday(entries, target?.active_ml ?? 3000);

  async function add(amountMl: number, source: WaterEntry["source"] = "quick_add") {
    if (busy) return;
    setBusy(true);
    try {
      await addWaterEntry({
        userId, amountMl, source, createdByUserId: currentUserId,
      });
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
      qc.invalidateQueries({ queryKey: ["water-history", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log water");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const latest = entries[0];
    if (!latest) return;
    setBusy(true);
    try {
      await deleteWaterEntry(latest.id);
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
      qc.invalidateQueries({ queryKey: ["water-history", userId] });
      toast.success(`Removed ${formatWater(latest.amount_ml, "L")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't undo");
    } finally {
      setBusy(false);
    }
  }

  const sourceBadge =
    target?.target_source === "coach"
      ? "Coach set"
      : target?.target_source === "admin"
      ? "Admin set"
      : target?.target_source === "user"
      ? "Custom"
      : target?.mode === "auto" && target?.target_source === "auto"
      ? "Suggested"
      : "Default";

  return (
    <>
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Droplet className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Water</div>
              <div className="text-xs text-muted-foreground leading-tight">
                {summary.reached ? "Target reached" : `${formatWater(summary.remaining, "L")} to go`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {summary.reached && (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
            )}
            <Badge variant="outline" className="text-[10px]">{sourceBadge}</Badge>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Drank today</div><div className="text-2xl font-bold tabular-nums">
              {formatWater(summary.total, "L")}
              <span className="text-sm text-muted-foreground"> of {formatWater(target?.active_ml ?? 3000, "L")}</span>\n            </div></div>\n            <div className="text-xs text-muted-foreground">{summary.pct}%</div>
          </div>
          <Progress value={summary.pct} className="h-2" />\n          {entries.length > 0 && <button type="button" onClick={() => setHistoryOpen(true)} className="w-full text-left text-xs font-medium text-sky-700 dark:text-sky-300">Today: {entries.length} {entries.length === 1 ? "drink" : "drinks"} logged · View times & history ›</button>}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {QUICK_ADD_ML.map((ml) => (
            <Button
              key={ml}
              size="sm"
              variant="secondary"
              className="h-12 rounded-xl px-3 text-sm font-bold tabular-nums"
              disabled={busy}
              onClick={() => add(ml)}
            >
              +{ml >= 1000 ? `${ml / 1000}L` : `${ml}`}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="h-12 rounded-xl px-3 text-sm font-bold sm:col-auto"
            disabled={busy}
            onClick={() => setCustomOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" /> Custom
          </Button>
        </div>

        {!compact && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={busy || entries.length === 0}
              onClick={undo}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo last
            </Button>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs"
                      onClick={() => setHistoryOpen(true)}>
                <History className="mr-1 h-3.5 w-3.5" /> Review history
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs"
                      onClick={() => setTargetOpen(true)}>
                <Settings2 className="mr-1 h-3.5 w-3.5" /> Target
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CustomAmountDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onConfirm={(ml) => add(ml, "custom")}
      />
      <WaterTargetDialog
        open={targetOpen}
        onOpenChange={setTargetOpen}
        userId={userId}
        currentUserId={currentUserId}
        viewerRole={viewerRole}
      />
      <WaterHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        userId={userId}
        targetMl={target?.active_ml ?? 3000}
      />
    </>
  );
}

function CustomAmountDialog({
  open, onOpenChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (amountMl: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"ml" | "L" | "oz">("ml");

  function submit() {
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) return;
    const ml = unit === "ml" ? Math.round(n) : unit === "L" ? lToMl(n) : ozToMl(n);
    onConfirm(ml);
    setAmount("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle>Custom water amount</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {[250, 500, 750].map((ml) => (
            <Button key={ml} type="button" variant="secondary" className="h-11 rounded-xl font-bold" onClick={() => { setUnit("ml"); setAmount(String(ml)); }}>
              {ml} mL
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-2">
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
                <SelectItem value="L">L</SelectItem>
                <SelectItem value="ml">mL</SelectItem>
                <SelectItem value="oz">oz</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2">
          <Button className="h-12 rounded-xl" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-12 rounded-xl font-bold" disabled={!amount || Number(amount) <= 0} onClick={submit}>Add water</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}