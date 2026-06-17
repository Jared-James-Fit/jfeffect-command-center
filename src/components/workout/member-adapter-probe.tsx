/**
 * Dev-only A/B probe for the member workout adapter.
 *
 * Mounted from the member workout route. When the user opts in via
 * `localStorage.unified_member_adapter = "1"` (set in DevTools), the probe
 * builds a `member`-kind WorkoutContextAdapter for the active enrollment and
 * exercises a handful of read paths against the real day. Results render
 * in a small fixed-position badge and any thrown error is logged to the
 * console so we can diff adapter output vs the legacy direct-`supabase`
 * reads without changing the user-facing UI.
 *
 * This is intentionally read-only: no writes, no schedule mutations. The
 * existing `WorkoutTracker` keeps rendering and remains the source of
 * truth. Flag off => component returns `null` and short-circuits.
 */
import { useEffect, useState } from "react";
import { buildWorkoutAdapter } from "@/lib/workout-context";

const STORAGE_KEY = "unified_member_adapter";

function flagOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type ProbeState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "ok";
      rows: number;
      results: number;
      completion: boolean;
      day: string | null;
    }
  | { status: "error"; message: string };

export function MemberAdapterProbe({
  userId,
  enrollmentId,
  week,
  day,
}: {
  userId: string | null | undefined;
  enrollmentId: string;
  week: number;
  day: number;
}) {
  const enabled = flagOn();
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    setState({ status: "running" });
    (async () => {
      try {
        const adapter = buildWorkoutAdapter({
          kind: "member",
          userId,
          ownerId: userId,
          enrollmentId,
        });
        const dayId = `${week}:${day}`;
        const [dayDto, rows, results, completion] = await Promise.all([
          adapter.getDay(dayId),
          adapter.listRows(dayId),
          adapter.listRowResults(dayId),
          adapter.getDayCompletion(dayId),
        ]);
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.info("[member-adapter-probe]", {
          enrollmentId,
          week,
          day,
          dayDto,
          rows,
          results,
          completion,
        });
        setState({
          status: "ok",
          rows: rows.length,
          results: results.length,
          completion: !!completion?.completedAt,
          day: dayDto.title,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[member-adapter-probe] failed", err);
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, enrollmentId, week, day]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-[260px] rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-[11px] font-mono text-amber-100 shadow-lg">
      <div className="font-semibold tracking-wide">adapter probe</div>
      {state.status === "idle" && <div>idle</div>}
      {state.status === "running" && <div>running…</div>}
      {state.status === "ok" && (
        <div className="space-y-0.5">
          <div>day: {state.day ?? "(untitled)"}</div>
          <div>rows: {state.rows}</div>
          <div>logs: {state.results}</div>
          <div>completed: {state.completion ? "yes" : "no"}</div>
        </div>
      )}
      {state.status === "error" && (
        <div className="text-amber-200">err: {state.message}</div>
      )}
    </div>
  );
}