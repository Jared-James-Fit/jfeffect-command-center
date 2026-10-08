import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Moon, HeartPulse, Footprints, Watch, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import {
  clearHealthDeviceSync,
  healthStoreProvider,
  loadHealthPlugin,
  syncHealthStore,
  type HealthPluginLike,
  type HealthSyncResult,
} from "@/platform/health";
import { WEARABLE_PROVIDERS, getWearableProvider } from "@/lib/wearables/providers";
import { TrainingRecoveryPanel } from "@/components/portal/training-recovery-panel";
import {
  resolveDaily,
  summarizeRecoveryFromRows,
  trailingAverage,
  type RecoveryState,
} from "@/lib/wearables/analytics";
import {
  beginWearableConnect,
  disconnectWearable,
  getWearableOverview,
  setWearableSharing,
  syncWearableNow,
} from "@/lib/wearables/wearables.functions";
import { cn } from "@/lib/utils";

const STATE_STYLE: Record<RecoveryState, { label: string; cls: string }> = {
  good: { label: "Recovered", cls: "bg-emerald-500/15 text-emerald-400" },
  watch: { label: "Watch", cls: "bg-amber-500/15 text-amber-400" },
  low: { label: "Low recovery", cls: "bg-red-500/15 text-red-400" },
  unknown: { label: "Building baseline", cls: "bg-muted text-muted-foreground" },
};

const QUERY_KEY = ["wearable-overview"] as const;

/**
 * mode "full"    : Account page. Connect / reconnect / disconnect / sharing, always shown to the athlete.
 * mode "summary" : Home. Only appears once a device is connected, with a link to manage it.
 */
export function WearablesCard({ mode = "full" }: { mode?: "full" | "summary" }) {
  const qc = useQueryClient();
  const pov = usePovArgs();
  const overviewFn = usePovFn(getWearableOverview);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: [...QUERY_KEY, pov.viewAsClientId ?? "me"],
    staleTime: 60_000,
    queryFn: () => overviewFn({ data: {} }),
  });

  // Result of returning from the provider's authorize page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const r = url.searchParams.get("wearable");
    if (!r) return;
    if (r === "oura_connected") toast.success("Oura connected. Pulling your last 30 days.");
    else if (r === "oura_denied") toast("Oura connection cancelled.");
    else toast.error("Couldn't connect Oura. Try again.");
    url.searchParams.delete("wearable");
    window.history.replaceState({}, "", url.toString());
    qc.invalidateQueries({ queryKey: QUERY_KEY });
  }, [qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  // Phone health store (Apple Health in the iOS app, Health Connect in the Android app).
  const deviceStore = healthStoreProvider();
  const [healthPlugin, setHealthPlugin] = useState<HealthPluginLike | null>(null);
  const [healthState, setHealthState] = useState<"loading" | "ready" | "web" | "needs_update">(
    "loading",
  );
  useEffect(() => {
    let alive = true;
    loadHealthPlugin()
      .then((r) => {
        if (!alive) return;
        setHealthPlugin(r.plugin);
        setHealthState(r.plugin ? "ready" : (r.reason ?? "web"));
      })
      .catch(() => alive && setHealthState("needs_update"));
    return () => {
      alive = false;
    };
  }, []);

  const reportHealth = (r: HealthSyncResult, connecting: boolean) => {
    if (r.ok) {
      toast.success(connecting ? `Connected. Synced ${r.days} days.` : `Synced ${r.days} days.`);
      refresh();
    } else if (r.reason === "no_data") {
      toast(
        "No health data found yet. Check iPhone Settings > Health > Data Access & Devices > JF Effect, and that your watch app shares sleep and heart rate to Health.",
        { duration: 9000 },
      );
    } else if (r.reason === "disconnected") {
      toast("This device was disconnected. Tap Connect to turn it back on.");
      refresh();
    } else {
      toast.error(r.message ?? "Couldn't read health data on this phone.");
    }
  };

  const connect = useMutation({
    mutationFn: async (provider: string) => {
      if (getWearableProvider(provider)?.kind === "health_store") {
        if (!healthPlugin) throw new Error("Open the JF Effect app on your phone to connect.");
        return { health: await syncHealthStore(healthPlugin, { requestAccess: true }) };
      }
      return { url: (await beginWearableConnect({ data: { provider } })).url };
    },
    onSuccess: (r) => {
      if ("url" in r && r.url) window.location.href = r.url;
      else if ("health" in r && r.health) reportHealth(r.health, true);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't start the connection."),
  });
  const sync = useMutation({
    mutationFn: async (provider: string) => {
      if (getWearableProvider(provider)?.kind === "health_store") {
        if (!healthPlugin) throw new Error("Sync runs from the JF Effect app on your phone.");
        return { health: await syncHealthStore(healthPlugin, { days: 14 }) };
      }
      return { cloud: await syncWearableNow({ data: { provider } }) };
    },
    onSuccess: (r) => {
      if ("health" in r && r.health) return reportHealth(r.health, false);
      if ("cloud" in r && r.cloud) {
        toast.success(r.cloud.days ? `Synced ${r.cloud.days} days.` : "Already up to date.");
        refresh();
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Sync failed."),
  });
  const share = useMutation({
    mutationFn: (v: { provider: string; shared: boolean }) => setWearableSharing({ data: v }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update sharing."),
  });
  const disconnect = useMutation({
    mutationFn: (v: { provider: string; deleteData: boolean }) => disconnectWearable({ data: v }),
    onSuccess: (_r, v) => {
      if (v.provider === deviceStore) clearHealthDeviceSync();
      toast.success("Disconnected.");
      setConfirmDisconnect(null);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't disconnect."),
  });

  const priority = useMemo(
    () => (data?.connections ?? []).map((c) => c.provider),
    [data?.connections],
  );
  const series = useMemo(
    () => resolveDaily((data?.metrics ?? []) as any[], priority),
    [data?.metrics, priority],
  );
  // Recovery signals (HRV, resting HR, sleep) come from ONE source so baselines are
  // like-for-like; the merged `series` is only for additive fields like steps.
  const recoveryResult = useMemo(
    () => summarizeRecoveryFromRows((data?.metrics ?? []) as any[]),
    [data?.metrics],
  );
  const recovery = recoveryResult?.summary ?? null;
  const recSeries = recoveryResult?.series ?? [];
  const latest = useMemo(
    () => [...recSeries].reverse().find((d) => d.sleep_minutes != null || d.hrv_ms != null),
    [recSeries],
  );
  const hrvSpark = useMemo(
    () =>
      recSeries
        .filter((d) => d.hrv_ms != null)
        .slice(-30)
        .map((d) => ({ d: d.metric_date, v: d.hrv_ms })),
    [recSeries],
  );
  const sourceLabel = recovery
    ? (WEARABLE_PROVIDERS.find((p) => p.id === recovery.provider)?.label ?? recovery.provider)
    : null;

  if (isPending) return null;
  if (isError || !data) {
    // Never vanish silently: if this fails (migration not applied, network), say so on the settings page.
    if (mode === "summary") return null;
    return (
      <Card className="p-4 space-y-1">
        <div className="flex items-center gap-2">
          <Watch className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Devices &amp; recovery</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Device connections aren&apos;t available right now. Try again in a moment.
        </p>
        {error instanceof Error && error.message && (
          <p className="text-xs text-muted-foreground/70 break-words">{error.message}</p>
        )}
      </Card>
    );
  }

  const active = data.connections.filter((c) => c.status !== "disconnected");
  const isOwner = data.isOwner;
  // A coach viewing a client who has nothing connected (or isn't sharing) sees nothing.
  if (!isOwner && active.length === 0) return null;
  // On Home, setup lives in Account; only show the card once there is something to show.
  if (mode === "summary" && active.length === 0) return null;

  const offered = WEARABLE_PROVIDERS.filter((p) => !active.some((c) => c.provider === p.id));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Watch className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Devices &amp; recovery</h3>
        {sourceLabel && <span className="text-xs text-muted-foreground">via {sourceLabel}</span>}
        {recovery && (
          <span
            className={cn(
              "ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium",
              STATE_STYLE[recovery.state].cls,
            )}
          >
            {STATE_STYLE[recovery.state].label}
          </span>
        )}
      </div>

      {active.length > 0 && latest && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={Moon}
              label="Sleep"
              value={
                latest.sleep_minutes != null ? `${(latest.sleep_minutes / 60).toFixed(1)}h` : "–"
              }
              sub={
                trailingAverage(recSeries, "sleep_minutes") != null
                  ? `7d avg ${(trailingAverage(recSeries, "sleep_minutes")! / 60).toFixed(1)}h`
                  : undefined
              }
            />
            <Stat
              icon={Activity}
              label={recovery?.hrvMethod ? `HRV (${recovery.hrvMethod.toUpperCase()})` : "HRV"}
              value={latest.hrv_ms != null ? `${Math.round(latest.hrv_ms)} ms` : "–"}
              sub={
                recovery?.hrvPctVsBaseline != null
                  ? `${recovery.hrvPctVsBaseline > 0 ? "+" : ""}${recovery.hrvPctVsBaseline}% vs baseline`
                  : undefined
              }
            />
            <Stat
              icon={HeartPulse}
              label="Resting HR"
              value={latest.resting_hr != null ? `${Math.round(latest.resting_hr)} bpm` : "–"}
              sub={
                recovery?.restingHrDeltaBpm != null
                  ? `${recovery.restingHrDeltaBpm > 0 ? "+" : ""}${recovery.restingHrDeltaBpm} vs baseline`
                  : undefined
              }
            />
            <Stat
              icon={Footprints}
              label="Steps"
              value={
                series[series.length - 1]?.steps != null
                  ? series[series.length - 1].steps!.toLocaleString()
                  : "–"
              }
              sub={
                trailingAverage(series, "steps") != null
                  ? `7d avg ${Math.round(trailingAverage(series, "steps")!).toLocaleString()}`
                  : undefined
              }
            />
          </div>
          {recovery && recovery.reasons.length > 0 && (
            <ul className="text-sm text-muted-foreground list-disc pl-5">
              {recovery.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {hrvSpark.length > 3 && (
            <div className="h-14">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hrvSpark}>
                  <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary) / 0.15)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {recovery && recSeries.length > 0 && (
        <TrainingRecoveryPanel
          recovery={recSeries}
          hrvLabel={recovery.hrvMethod ? `HRV (${recovery.hrvMethod.toUpperCase()})` : "HRV"}
        />
      )}

      {active.map((c) => {
        const meta = WEARABLE_PROVIDERS.find((p) => p.id === c.provider);
        return (
          <div key={c.provider} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{meta?.label ?? c.provider}</span>
              <span className="text-xs text-muted-foreground">
                {c.status === "reconnect_required"
                  ? "Needs reconnecting"
                  : c.last_synced_at
                    ? `Synced ${new Date(c.last_synced_at).toLocaleString()}`
                    : "Syncing…"}
              </span>
            </div>
            {c.last_error && c.status !== "connected" && (
              <p className="text-xs text-red-400">{c.last_error}</p>
            )}
            {isOwner && mode === "full" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Share with my coach</span>
                  <Switch
                    checked={c.shared_with_coach}
                    onCheckedChange={(v) => share.mutate({ provider: c.provider, shared: v })}
                  />
                </div>
                <div className="flex gap-2">
                  {getWearableProvider(c.provider)?.kind === "health_store" &&
                  (c.provider !== deviceStore || !healthPlugin) ? (
                    <span className="self-center text-xs text-muted-foreground">
                      Syncs from your phone when you open the JF Effect app
                    </span>
                  ) : c.status === "reconnect_required" ? (
                    <Button
                      size="sm"
                      onClick={() => connect.mutate(c.provider)}
                      disabled={connect.isPending}
                    >
                      Reconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sync.mutate(c.provider)}
                      disabled={sync.isPending}
                    >
                      <RefreshCw
                        className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")}
                      />
                      Sync now
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDisconnect(c.provider)}
                  >
                    Disconnect
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {isOwner && mode === "full" && (
        <div className="space-y-2">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Connect a device so your coach can program around your sleep, HRV and resting heart
              rate, not just your training log.
            </p>
          )}
          <div className="space-y-2">
            {offered
              // In the phone app, only offer that phone's own health store.
              .filter((p) => p.kind !== "health_store" || !deviceStore || p.id === deviceStore)
              .map((p) => {
                const isStore = p.kind === "health_store";
                const ready =
                  p.live &&
                  (isStore
                    ? healthState === "ready" && p.id === deviceStore
                    : p.id !== "oura" || data.configured.oura);
                const status = !p.live
                  ? "Coming soon"
                  : isStore
                    ? healthState === "needs_update"
                      ? "Update the app to connect"
                      : healthState === "loading"
                        ? ""
                        : p.id === "apple_health"
                          ? "Connect in the iPhone app"
                          : "Connect in the Android app"
                    : "Not set up";
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.blurb}</div>
                    </div>
                    {ready ? (
                      <Button
                        size="sm"
                        onClick={() => connect.mutate(p.id)}
                        disabled={connect.isPending}
                      >
                        Connect
                      </Button>
                    ) : (
                      <span className="text-right text-xs text-muted-foreground">{status}</span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <AlertDialog
        open={!!confirmDisconnect}
        onOpenChange={(o) => !o && setConfirmDisconnect(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect device?</AlertDialogTitle>
            <AlertDialogDescription>
              We stop syncing and delete the access we hold. You can also erase the sleep, HRV and
              activity history we already saved from this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmDisconnect &&
                disconnect.mutate({ provider: confirmDisconnect, deleteData: false })
              }
            >
              Disconnect, keep history
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() =>
                confirmDisconnect &&
                disconnect.mutate({ provider: confirmDisconnect, deleteData: true })
              }
            >
              Disconnect and delete data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Moon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
