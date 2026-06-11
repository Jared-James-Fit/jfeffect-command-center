import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CalendarRange, AlertTriangle, Lock, Loader2, RefreshCcw, Sparkles, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  buildSchedulePreview,
  applySchedule,
  clearAutoSchedule,
  detectAvailabilityChange,
  unlockDay,
  type PreviewRow,
  type SchedulePreview,
} from "@/lib/auto-scheduler";
import { supabase } from "@/integrations/supabase/client";
import { formatDays } from "@/lib/training-schedule";
import { WeekScheduleView } from "@/components/week-schedule-view";

const sb = supabase as any;

export function AutoSchedulePanel({ blockId }: { blockId: string }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [keepOverrides, setKeepOverrides] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: block } = useQuery({
    queryKey: ["block-sched-summary", blockId],
    queryFn: async () =>
      (
        await sb
          .from("pl_blocks")
          .select("id, client_id, start_date, last_scheduled_at, last_scheduled_availability")
          .eq("id", blockId)
          .maybeSingle()
      ).data,
  });

  const { data: client } = useQuery({
    queryKey: ["block-sched-client", block?.client_id],
    enabled: !!block?.client_id,
    queryFn: async () =>
      (
        await sb
          .from("clients")
          .select("committed_training_days, available_training_days, preferred_training_days, unavailable_training_days")
          .eq("id", block!.client_id)
          .maybeSingle()
      ).data,
  });

  const { data: change } = useQuery({
    queryKey: ["block-sched-change", blockId, block?.last_scheduled_at],
    enabled: !!block?.last_scheduled_at,
    queryFn: () => detectAvailabilityChange(blockId),
  });

  const availabilitySummary = useMemo(() => {
    if (!client) return "—";
    const all = [
      ...(client.committed_training_days ?? []),
      ...(client.available_training_days ?? []),
    ];
    const unique = Array.from(new Set(all));
    return formatDays(unique);
  }, [client]);

  const openPreview = async () => {
    setBusy(true);
    try {
      const p = await buildSchedulePreview(blockId);
      setPreview(p);
      setPreviewOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to build preview");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await applySchedule(blockId, preview);
      toast.success(`Schedule applied — ${res.updated} day(s) updated.`);
      setPreviewOpen(false);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["block-sched-summary", blockId] });
      qc.invalidateQueries({ queryKey: ["block-days-warmup", blockId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to apply schedule");
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      const res = await clearAutoSchedule(blockId, { keepManualOverrides: keepOverrides });
      toast.success(`Cleared ${res.cleared} day(s).`);
      setClearOpen(false);
      qc.invalidateQueries({ queryKey: ["block-sched-summary", blockId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clear");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-primary" />
        <h3 className="font-bold">Smart Schedule</h3>
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <div className="font-semibold text-foreground">Availability</div>
          <div>{availabilitySummary}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Block start</div>
          <div>{block?.start_date ? format(parseISO(block.start_date), "EEE MMM d, yyyy") : "Not set"}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Last generated</div>
          <div>{block?.last_scheduled_at ? format(parseISO(block.last_scheduled_at), "MMM d, h:mma") : "Never"}</div>
        </div>
      </div>

      {change?.changed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1">
            <div className="font-semibold">Client availability changed. Review schedule.</div>
            <div className="text-muted-foreground">
              Before: {formatDays(change.before)} → After: {formatDays(change.after)}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={openPreview} disabled={busy}>
            <RefreshCcw className="mr-1 h-3 w-3" /> Preview Updated
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openPreview} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
          Build Schedule From Availability
        </Button>
        <Button size="sm" variant="outline" onClick={() => setClearOpen(true)} disabled={busy}>
          <Trash2 className="mr-1 h-3 w-3" /> Clear Auto Schedule
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCalendarOpen(true)}>
          <Eye className="mr-1 h-3 w-3" /> Preview Client Calendar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Scheduling is planning only — workout logs, completion records, and completed dates are never changed.
      </p>

      {previewOpen && preview && (
        <PreviewDialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          preview={preview}
          onChange={setPreview}
          onApply={apply}
          busy={busy}
        />
      )}

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clear Auto Schedule</DialogTitle>
            <DialogDescription>This removes scheduled dates only. Logs and completions are not touched.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox id="keep" checked={keepOverrides} onCheckedChange={(v) => setKeepOverrides(!!v)} />
            <Label htmlFor="keep" className="text-sm">Keep manual overrides</Label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doClear} disabled={busy}>
              {busy ? "Clearing…" : "Clear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Client Calendar Preview</DialogTitle>
            <DialogDescription>This is exactly what the client sees in their Calendar tab.</DialogDescription>
          </DialogHeader>
          {block?.client_id && (
            <WeekScheduleView clientId={block.client_id} blockId={blockId} mode="admin" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PreviewDialog({
  open,
  onClose,
  preview,
  onChange,
  onApply,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  preview: SchedulePreview;
  onChange: (p: SchedulePreview) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const groupedByWeek = useMemo(() => {
    const m = new Map<number, PreviewRow[]>();
    for (const r of preview.rows) {
      const l = m.get(r.weekIndex) ?? [];
      l.push(r);
      m.set(r.weekIndex, l);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [preview]);

  const updateRowDate = (row: PreviewRow, newDate: string) => {
    // Preview-only edit. Persists when admin clicks Apply.
    const next: SchedulePreview = {
      ...preview,
      rows: preview.rows.map((r) =>
        r.dayId === row.dayId
          ? { ...r, dateISO: newDate, manualOverride: true, warnings: [] }
          : r,
      ),
    };
    onChange(next);
  };

  const unlockRow = async (row: PreviewRow) => {
    // Unlock immediately so a follow-up Build picks it up; date stays for now.
    await unlockDay(row.dayId);
    toast.success("Override removed");
    const next: SchedulePreview = {
      ...preview,
      rows: preview.rows.map((r) => (r.dayId === row.dayId ? { ...r, manualOverride: false } : r)),
    };
    onChange(next);
    qc.invalidateQueries({ queryKey: ["block-days-warmup"] });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Preview</DialogTitle>
          <DialogDescription>
            Review proposed dates. Edit any row to mark it as a manual override.
          </DialogDescription>
        </DialogHeader>

        {preview.blockWarnings.length > 0 && (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {preview.blockWarnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {groupedByWeek.map(([wk, rows]) => (
            <div key={wk} className="rounded-md border border-border">
              <div className="border-b border-border bg-secondary/30 px-3 py-2 text-xs font-bold">
                Week {wk + 1}
              </div>
              <div className="divide-y divide-border">
                {rows.map((r) => (
                  <div key={r.dayId} className="grid gap-2 px-3 py-2 sm:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto] sm:items-center">
                    <div className="text-sm">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Day {r.dayIndex} · {r.dayType}
                      </div>
                    </div>
                    <div>
                      <Input
                        type="date"
                        value={r.dateISO ?? ""}
                        onChange={(e) => e.target.value && updateRowDate(r, e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">{r.weekday ?? "—"}</div>
                    <div className="text-xs">
                      {r.cardio.length === 0 ? (
                        <span className="text-muted-foreground">No cardio</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.cardio.map((c, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {c.label} · {c.dayType}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {r.manualOverride && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Lock className="h-3 w-3" /> Manual
                        </Badge>
                      )}
                      {r.manualOverride && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => unlockRow(r)}>
                          Unlock
                        </Button>
                      )}
                    </div>
                    {r.warnings.length > 0 && (
                      <div className="col-span-full text-[11px] text-amber-500">
                        {r.warnings.join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={onClose}>Edit Manually</Button>
          <Button onClick={onApply} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Apply Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}