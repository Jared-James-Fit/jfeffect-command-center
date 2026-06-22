import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  retryAllNow,
  setStuckListener,
  useQueueAggregateStatus,
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

export function WorkoutSyncBanner({ clientId, workoutId, pageRoute, className }: Props) {
  const { status, pending, stuck } = useQueueAggregateStatus();
  const online = useOnline();
  const { role } = useAuth();
  const reportFn = useServerFn(reportWorkoutSyncStuck);
  const reportedRef = useRef<Set<string>>(new Set());
  const [manualRetry, setManualRetry] = useState(false);

  const isAdmin = role === "admin" || role === "coach";

  useEffect(() => {
    if (status !== "syncing") {
      setManualRetry(false);
    }
  }, [status]);

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
      // Use a quiet, non-alarming message — sync issues are temporary
      // and the client's data is already saved locally.
      toast.warning("Sync delayed", {
        description: "Your data is saved. We'll sync when the connection improves.",
        duration: 5000,
      });
    });
    return () => setStuckListener(null);
  }, [clientId, workoutId, pageRoute, online, reportFn]);

  const hidden = status === "synced" && online;

  const pill = useMemo(() => {
    if (hidden) return null;

    if (status === "syncing") {
      return {
        text: manualRetry ? "Retrying…" : "Saving…",
        variant: "gray" as const,
        tappable: false,
      };
    }

    if (status === "stuck") {
      return {
        text: "Sync issue · Tap for help",
        variant: "red" as const,
        tappable: true,
      };
    }

    if ((status === "idle" || status === "failed") && !online) {
      return {
        text: "Saved offline · Tap to sync",
        variant: "amber" as const,
        tappable: true,
      };
    }

    if (status === "failed") {
      // Online + the queue has items that errored. Surface a retry pill.
      return {
        text: "Save failed · Tap to retry",
        variant: "amber" as const,
        tappable: true,
      };
    }

    // status === "idle" while online is a transient state between enqueue
    // and runQueue() picking it up. Don't flash "Saving…" — the per-field
    // SaveStatus pills (and the syncing branch above) already cover real
    // in-flight saves. Showing it here caused the bug where the workout
    // header repeatedly ping-ponged between "Saving…" and "Saved".

    return null;
  }, [status, online, manualRetry, hidden]);

  if (!pill) return null;

  const handleTap = () => {
    if (!pill.tappable) return;
    setManualRetry(true);
    retryAllNow();
    toast("Retrying sync…");
  };

  return (
    <div
      className={cn(
        "fixed bottom-[max(4rem,env(safe-area-inset-bottom))] right-3 z-50 flex flex-col items-end",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={handleTap}
        disabled={!pill.tappable}
        className={cn(
          "text-xs select-none transition-opacity",
          pill.variant === "gray" && "text-muted-foreground",
          pill.variant === "amber" &&
            "bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-full px-2.5 py-1 cursor-pointer active:opacity-70",
          pill.variant === "red" &&
            "bg-destructive/10 text-destructive border border-destructive/20 rounded-full px-2.5 py-1 cursor-pointer active:opacity-70",
        )}
      >
        {pill.text}
      </button>

      {isAdmin && stuck.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-muted-foreground cursor-pointer select-none list-none text-right">
            Developer details
          </summary>
          <div className="mt-1 max-w-[16rem] text-[10px] font-mono text-muted-foreground bg-muted/60 rounded-md p-2 space-y-1">
            {stuck.map((item) => (
              <div key={item.id} className="break-all">
                <div className="font-semibold">{item.label}</div>
                <div>attempts: {item.attempts}</div>
                {item.lastError && (
                  <div className="text-destructive">{item.lastError}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
