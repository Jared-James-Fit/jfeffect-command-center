import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSchedulerStatus,
  setSchedulerMode,
  setSchedulerEmergencyDisable,
  runSchedulerNow,
} from "@/lib/scheduler.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { AlertTriangle, Play, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export function SchedulerTab() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getSchedulerStatus);
  const modeFn = useServerFn(setSchedulerMode);
  const emergencyFn = useServerFn(setSchedulerEmergencyDisable);
  const runNowFn = useServerFn(runSchedulerNow);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["scheduler-status"],
    queryFn: () => statusFn(),
    refetchInterval: 15_000,
  });

  const [confirmReal, setConfirmReal] = useState(false);
  const [realReason, setRealReason] = useState("");
  const [realConfirmText, setRealConfirmText] = useState("");
  const [emergencyDialog, setEmergencyDialog] = useState<null | boolean>(null);
  const [emergencyReason, setEmergencyReason] = useState("");

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading scheduler status…</div>;
  }

  const s = data.settings;
  const isReal = s.mode === "real";
  const isEmergency = s.emergency_disable;

  async function enableReal() {
    try {
      await modeFn({ data: { mode: "real", reason: realReason, confirm: "I UNDERSTAND THIS WILL SEND REAL MESSAGES" } });
      toast.success("Delivery mode set to REAL");
      setConfirmReal(false);
      setRealReason("");
      setRealConfirmText("");
      qc.invalidateQueries({ queryKey: ["scheduler-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to change mode");
    }
  }

  async function disableReal() {
    try {
      await modeFn({ data: { mode: "dry_run", reason: "Reverting to dry-run mode" } });
      toast.success("Delivery mode set back to DRY RUN");
      qc.invalidateQueries({ queryKey: ["scheduler-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function toggleEmergency(next: boolean) {
    setEmergencyDialog(next);
  }

  async function confirmEmergency() {
    if (emergencyDialog === null) return;
    try {
      await emergencyFn({ data: { disabled: emergencyDialog, reason: emergencyReason || "(no reason given)" } });
      toast.success(emergencyDialog ? "Worker emergency-disabled" : "Worker re-enabled");
      setEmergencyDialog(null);
      setEmergencyReason("");
      qc.invalidateQueries({ queryKey: ["scheduler-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function runNow() {
    try {
      const r = await runNowFn({});
      toast.success(`Worker tick complete (${r?.result?.claimed ?? 0} claimed)`);
      qc.invalidateQueries({ queryKey: ["scheduler-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Run failed");
    }
  }

  const lastRun = data.lastRuns[0];
  const totals = data.totals24h;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Mode banner */}
      <Card className={`p-4 border ${isEmergency ? "border-rose-500/50 bg-rose-500/5" : isReal ? "border-amber-500/50 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {isEmergency ? (
              <ShieldAlert className="h-6 w-6 text-rose-400 shrink-0" />
            ) : isReal ? (
              <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-emerald-400 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">Scheduled response worker</h2>
                {isEmergency ? (
                  <Badge variant="outline" className="border-rose-500/40 text-rose-300">Emergency disabled</Badge>
                ) : isReal ? (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-300">REAL delivery</Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">Dry run</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                {isEmergency
                  ? "All worker activity is halted. Cron ticks return immediately without claiming or simulating anything."
                  : isReal
                    ? "Worker is sending real messages to clients. Disable immediately if anything looks wrong."
                    : "Worker is claiming due schedules, validating them, and recording what would have been sent. No emails, SMS, or in-app messages are delivered."}
              </p>
              {s.updated_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last mode change {formatDistanceToNow(new Date(s.updated_at), { addSuffix: true })}
                  {s.notes ? <> · {s.notes}</> : null}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={runNow} disabled={isEmergency}>
              <Play className="mr-1 h-3 w-3" /> Run now
            </Button>
          </div>
        </div>
      </Card>

      {/* Controls */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="font-semibold">Delivery mode</div>
          <p className="text-xs text-muted-foreground">
            Real sending is OFF by default. You must type the confirmation phrase to enable it.
            Every change is recorded in the mode-change audit log below.
          </p>
          {isReal ? (
            <Button variant="outline" onClick={disableReal} className="w-full">Switch back to dry-run</Button>
          ) : (
            <Button onClick={() => setConfirmReal(true)} className="w-full" variant="destructive">
              Enable REAL delivery…
            </Button>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Emergency disable</div>
              <p className="text-xs text-muted-foreground">Halts the worker entirely — even dry-run ticks become no-ops.</p>
            </div>
            <Switch checked={isEmergency} onCheckedChange={(v) => toggleEmergency(v)} />
          </div>
        </Card>
      </div>

      {/* Stats */}
      <Card className="p-4">
        <div className="font-semibold mb-3">Last 24 hours</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7 text-center">
          <Stat label="Claimed" value={totals.rows_claimed} />
          <Stat label="Simulated ✓" value={totals.rows_simulated_success} tone="emerald" />
          <Stat label="Simulated ✗" value={totals.rows_simulated_failed} tone="amber" />
          <Stat label="Skipped" value={totals.rows_skipped} />
          <Stat label="Duplicates blocked" value={totals.duplicates_prevented} />
          <Stat label="Real sent" value={totals.rows_real_sent} tone={totals.rows_real_sent ? "amber" : undefined} />
          <Stat label="Real failed" value={totals.rows_real_failed} tone={totals.rows_real_failed ? "rose" : undefined} />
        </div>
        {lastRun && (
          <div className="mt-3 text-xs text-muted-foreground">
            Last worker run {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} ·
            {" "}mode <span className="font-semibold">{lastRun.mode}</span> · claimed {lastRun.rows_claimed}
            {lastRun.error ? <> · error: {lastRun.error}</> : null}
          </div>
        )}
      </Card>

      {/* Pending queue preview */}
      <Card className="p-4">
        <div className="font-semibold mb-2">Pending schedules ({data.pending.length})</div>
        {data.pending.length === 0 ? (
          <div className="text-xs text-muted-foreground">No pending scheduled responses.</div>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {data.pending.slice(0, 20).map((p: any) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <code className="text-[10px] text-muted-foreground">{p.id.slice(0, 8)}</code>
                <span>Scheduled {new Date(p.scheduled_at).toLocaleString()}</span>
                <span>{p.attempts} attempt{p.attempts === 1 ? "" : "s"}</span>
                <span>{p.dry_run_validated_at ? "dry-run ok" : "not yet simulated"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Recent worker runs */}
      <Card className="p-4">
        <div className="font-semibold mb-2">Recent worker runs</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1 pr-3">When</th>
                <th className="text-left py-1 pr-3">Mode</th>
                <th className="text-right py-1 pr-3">Claimed</th>
                <th className="text-right py-1 pr-3">Sim ✓</th>
                <th className="text-right py-1 pr-3">Sim ✗</th>
                <th className="text-right py-1 pr-3">Skipped</th>
                <th className="text-right py-1 pr-3">Dupes</th>
                <th className="text-left py-1">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.lastRuns.map((r: any) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-3">{formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}</td>
                  <td className="py-1 pr-3"><Badge variant="outline" className="text-[10px]">{r.mode}</Badge></td>
                  <td className="py-1 pr-3 text-right">{r.rows_claimed}</td>
                  <td className="py-1 pr-3 text-right">{r.rows_simulated_success}</td>
                  <td className="py-1 pr-3 text-right">{r.rows_simulated_failed}</td>
                  <td className="py-1 pr-3 text-right">{r.rows_skipped}</td>
                  <td className="py-1 pr-3 text-right">{r.duplicates_prevented}</td>
                  <td className="py-1 text-rose-300">{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mode-change audit */}
      <Card className="p-4">
        <div className="font-semibold mb-2">Mode change audit</div>
        {data.audit.length === 0 ? (
          <div className="text-xs text-muted-foreground">No changes recorded yet.</div>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {data.audit.map((a: any) => (
              <li key={a.id} className="py-2">
                <div>
                  <span className="text-muted-foreground">{new Date(a.changed_at).toLocaleString()}</span>
                  {" — "}
                  <span className="font-mono">{a.previous_mode}</span> → <span className="font-mono">{a.new_mode}</span>
                  {a.previous_emergency_disabled !== a.new_emergency_disabled && (
                    <> · emergency {a.previous_emergency_disabled ? "ON" : "off"} → {a.new_emergency_disabled ? "ON" : "off"}</>
                  )}
                </div>
                {a.reason && <div className="text-muted-foreground">Reason: {a.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Enable REAL confirm dialog */}
      <Dialog open={confirmReal} onOpenChange={setConfirmReal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" /> Enable REAL delivery
            </DialogTitle>
            <DialogDescription>
              Once enabled, the worker will send real in-app messages to real clients at their scheduled time.
              Make sure dry-run QA has passed and you've reviewed pending schedules below the confirmation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold">Reason (recorded in audit log)</label>
              <Textarea value={realReason} onChange={(e) => setRealReason(e.target.value)} rows={3} placeholder="e.g. dry-run QA complete on 2026-06-13, approved by …" />
            </div>
            <div>
              <label className="text-xs font-semibold">Type the confirmation phrase exactly:</label>
              <div className="text-[11px] text-muted-foreground mb-1">I UNDERSTAND THIS WILL SEND REAL MESSAGES</div>
              <Input value={realConfirmText} onChange={(e) => setRealConfirmText(e.target.value)} placeholder="Type the phrase exactly" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReal(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={realReason.trim().length < 8 || realConfirmText.trim() !== "I UNDERSTAND THIS WILL SEND REAL MESSAGES"}
              onClick={enableReal}
            >
              Enable REAL delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emergency dialog */}
      <Dialog open={emergencyDialog !== null} onOpenChange={(v) => { if (!v) setEmergencyDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{emergencyDialog ? "Emergency disable worker" : "Re-enable worker"}</DialogTitle>
            <DialogDescription>
              {emergencyDialog
                ? "All worker activity will stop immediately. Cron ticks will be no-ops until you re-enable."
                : "The worker will resume on the next cron tick in its current mode."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={emergencyReason} onChange={(e) => setEmergencyReason(e.target.value)} rows={2} placeholder="Short reason for the audit log" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmergencyDialog(null)}>Cancel</Button>
            <Button variant={emergencyDialog ? "destructive" : "default"} onClick={confirmEmergency}>
              {emergencyDialog ? "Disable now" : "Re-enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "rose" }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-300" :
    tone === "amber"   ? "text-amber-300" :
    tone === "rose"    ? "text-rose-300" :
    "text-foreground";
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <div className={`text-lg font-bold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}