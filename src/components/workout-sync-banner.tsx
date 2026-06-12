import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  retryAllNow,
  setStuckListener,
  useQueueAggregateStatus,
  type QueueStatus,
} from "@/lib/workout-offline-queue";
import { reportWorkoutSyncStuck } from "@/lib/workout-sync-failure.functions";

type Props = {
  clientId: string | null | undefined;
  workoutId: string | null | undefined;
  pageRoute: string;
  className?: string;
};

function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

const META: Record<QueueStatus, { label: string; tone: string; Icon: any }> = {
  synced: { label: "Synced", tone: "text-green-500", Icon: CheckCircle2 },
  syncing: { label: "Syncing…", tone: "text-muted-foreground", Icon: Loader2 },
  idle: { label: "Saved on device", tone: "text-amber-500", Icon: CloudOff },
  failed: { label: "Saved on device · will retry", tone: "text-amber-500", Icon: CloudOff },
  stuck: { label: "Failed to sync", tone: "text-destructive", Icon: AlertTriangle },
};

/**
 * Aggregate sync-state banner for the open workout. Shows nothing while
 * everything is synced; expands into a clear retry + fallback message if
 * writes are stuck.
 */
export function WorkoutSyncBanner({ clientId, workoutId, pageRoute, className }: Props) {
  const { status, pending, stuck } = useQueueAggregateStatus();
  const online = useOnline();
  const reportFn = useServerFn(reportWorkoutSyncStuck);
  const reportedRef = useRef<Set<string>>(new Set());

  // Listen for stuck items and escalate (once per item id per session).
  useEffect(() => {
    setStuckListener((item) => {
      if (reportedRef.current.has(item.id)) return;
      reportedRef.current.add(item.id);
      const deviceInfo =
        typeof navigator !== "undefined"
          ? {
              userAgent: navigator.userAgent,
              language: navigator.language,
              platform: (navigator as any).platform ?? null,
            }
          : null;
      void reportFn({
        data: {
          client_id: clientId ?? null,
          workout_id: workoutId ?? null,
          page_route: pageRoute,
          failed_action: item.label,
          connection_status: online ? "online" : "offline",
          sync_error_message: item.lastError ?? null,
          device_info: deviceInfo,
          attempts: item.attempts,
        },
      }).catch(() => {
        /* best-effort — no toast, banner already surfaces the issue */
      });
      toast.error("Workout not syncing", {
        description: "Your coach has been notified. Keep this page open.",
      });
    });
    return () => setStuckListener(null);
  }, [clientId, workoutId, pageRoute, online, reportFn]);

  const meta = META[status];
  const Icon = meta.Icon;

  // Don't render when there's nothing to say.
  const hidden = status === "synced" && online;
  const banner = useMemo(() => {
    if (status === "stuck") return "stuck";
    if (!online) return "offline";
    if (status === "idle" || status === "failed") return "pending";
    return null;
  }, [status, online]);

  if (hidden) return null;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        banner === "stuck"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : banner === "offline"
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border bg-muted/40",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            meta.tone,
            status === "syncing" && "animate-spin",
          )}
        />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <span>{meta.label}</span>
            {pending > 0 && (
              <span className="text-xs text-muted-foreground">
                · {pending} pending
              </span>
            )}
            {online ? (
              <Wifi className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <WifiOff className="ml-auto h-3.5 w-3.5 text-amber-500" />
            )}
          </div>
          {banner === "offline" && (
            <p className="text-xs text-muted-foreground">
              You're offline. Keep logging — your entries are saved on this
              device and will sync automatically when you reconnect.
            </p>
          )}
          {banner === "pending" && (
            <p className="text-xs text-muted-foreground">
              Your workout is saved on this device, but it has not fully synced
              yet. Keep this page open or reconnect to WiFi/data so it can
              submit.
            </p>
          )}
          {banner === "stuck" && (
            <div className="space-y-2 text-xs">
              <p>
                Your workout is saved on this device, but it has not fully
                synced after multiple tries. Keep this page open or reconnect
                to WiFi/data so it can submit.
              </p>
              <p className="text-destructive/80">
                If this does not submit after reconnecting, screenshot this
                workout and message your coach.
              </p>
              {stuck[0]?.lastError && (
                <p className="text-[11px] opacity-70 font-mono break-all">
                  {stuck[0].lastError}
                </p>
              )}
            </div>
          )}
          {(banner === "pending" || banner === "stuck") && (
            <div className="pt-1">
              <Button
                size="sm"
                variant={banner === "stuck" ? "destructive" : "outline"}
                onClick={() => {
                  retryAllNow();
                  toast("Retrying sync…");
                }}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Try Sync Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}