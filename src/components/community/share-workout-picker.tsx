import { Suspense, useState } from "react";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { formatWorkoutDuration, postTimeLabel } from "@/lib/community";
import { useRecentCompletions, type RecentCompletion } from "@/lib/community.queries";

const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })));

export const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";

/**
 * "+ Share a workout" — pick any session from the last 30 days and open the
 * share editor for it. Means nobody has to wait for their next workout to
 * post, and an empty feed always has a one-tap way to fill it.
 */
export function ShareWorkoutButton({ unit, className, label = "Share a workout", variant = "pill" }: { unit: "kg" | "lb"; className?: string; label?: string; variant?: "pill" | "block" }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<RecentCompletion | null>(null);
  const { data: sessions, isLoading } = useRecentCompletions(open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-black text-white shadow-md shadow-fuchsia-500/20 transition active:scale-[0.97]",
          SHARE_GRADIENT,
          variant === "pill" ? "h-9 rounded-full px-4 text-[13px]" : "h-12 w-full rounded-2xl text-[15px]",
          className,
        )}
      >
        <Plus className="h-4 w-4" strokeWidth={3} />
        {label}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
          <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
            <SheetTitle className="text-base font-black">Share a workout</SheetTitle>
            <SheetDescription className="text-xs">Pick a session. You'll choose the card next.</SheetDescription>
          </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
            </SheetHeader>
          <div className="max-h-[60dvh] overflow-y-auto px-2 py-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : !sessions?.length ? (
              <div className="px-6 py-10 text-center text-[13px] text-muted-foreground">No finished workouts in the last 30 days. Finish one and it'll show up here.</div>
            ) : (
              sessions.map((s) => {
                const dur = formatWorkoutDuration(s.duration_min);
                return (
                  <button
                    key={s.completion_id}
                    type="button"
                    onClick={() => {
                      setPicked(s);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted active:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold">{s.title}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {new Date(s.completed_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        {dur ? ` · ${dur}` : ""}
                        {` · ${postTimeLabel(s.completed_at)}`}
                      </div>
                    </div>
                    {s.post_id ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> {s.visibility === "private" ? "Saved" : "Posted"}
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {picked && (
        <Suspense fallback={null}>
          <ShareComposer
            open={!!picked}
            onOpenChange={(o) => !o && setPicked(null)}
            completionId={picked.completion_id}
            athleteName={picked.athlete_name}
            workoutTitle={picked.title}
            unit={unit}
          />
        </Suspense>
      )}
    </>
  );
}
