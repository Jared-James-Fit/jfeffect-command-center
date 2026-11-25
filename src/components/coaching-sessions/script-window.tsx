/**
 * The coach's script in a window of its own (Nov 25 2026): opened from the
 * meeting's Script window button or S on the shared screen, so the coach can
 * share only the slides window. It follows the shared screen's slide over the
 * same BroadcastChannel, and ← → (or ‹ ›) here move the slides. Built from the
 * same session read and script builder as the meeting sheet, so they never
 * disagree.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MonitorPlay, X } from "lucide-react";
import { getSessionFn } from "@/lib/coaching-sessions/sessions.functions";
import { buildPresenterScript, scriptInputFrom } from "@/lib/coaching-sessions/script";
import { ErrorState } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { PresenterScript } from "./presenter-script";

export function ScriptWindow({ sessionId }: { sessionId: string }) {
  const read = useServerFn(getSessionFn);
  const q = useQuery({
    queryKey: ["coaching-script", sessionId],
    queryFn: () => read({ data: { sessionId, refresh: false } }),
    staleTime: 60_000,
  });
  const slides = useMemo(() => (q.data ? buildPresenterScript(scriptInputFrom(q.data)) : []), [q.data]);
  const s = (q.data as any)?.session;
  const present = () => {
    const url = `/admin/meetings/${sessionId}/present`;
    const w = window.open(url, `jf-present-${sessionId}`);
    if (w) w.opener = null;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background text-foreground" data-script-window>
      <div className="mx-auto w-full max-w-2xl px-5 pb-10 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">Private · keep this window off the shared screen</p>
            <p className="truncate text-[17px] font-semibold">{s?.event?.title || "Meeting script"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={present}
              className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[14px] hover:bg-secondary"
            >
              <MonitorPlay className="h-4 w-4" /> Slides
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        {q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-64" />
          </div>
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} what="the script" onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : !slides.length || !s?.agenda ? (
          <p className="text-[16px] text-muted-foreground">This meeting has no agenda yet, so there's no script to follow.</p>
        ) : (
          <PresenterScript sessionId={sessionId} slides={slides} variant="window" />
        )}
      </div>
    </div>
  );
}
