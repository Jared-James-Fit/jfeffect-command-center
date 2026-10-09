import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronRight, Copy, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getMyCalendarFeed, getMyCalendarSyncStatus } from "@/lib/schedule.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { calendarSyncState, timeAgo, type CalendarSyncState } from "@/lib/calendar-sync";
import { cn } from "@/lib/utils";

const STARTED_KEY = "jf.calendarSync.startedAt";

function readStarted(): number | null {
  try {
    const v = window.localStorage.getItem(STARTED_KEY);
    return v ? Number(v) || null : null;
  } catch {
    return null;
  }
}
function markStarted() {
  try {
    window.localStorage.setItem(STARTED_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the card just won't show "connecting" */
  }
}

/**
 * Optional Setup step: put sessions and workouts in the client's own phone
 * calendar. Green only once Google / Apple / Outlook has actually pulled the
 * feed (recorded server-side), so the check means it really works.
 */
export function CalendarSyncCard({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(() => (typeof window === "undefined" ? null : readStarted()));
  const pov = usePovArgs();
  const isPov = !!pov.viewAsClientId;
  const statusFn = usePovFn(useServerFn(getMyCalendarSyncStatus));

  const { data: status, isLoading } = useQuery({
    queryKey: ["my-calendar-sync", pov.viewAsClientId ?? null],
    queryFn: () => statusFn({ data: {} }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // While waiting for Google/Apple's first fetch, check back every 20s.
    refetchInterval: (q) =>
      calendarSyncState({ lastFetchAt: (q.state.data as any)?.lastFetchAt, startedAt }) === "connecting" ? 20_000 : false,
  });

  if (isLoading || !status?.isClient) return null;

  const state: CalendarSyncState = calendarSyncState({ lastFetchAt: status.lastFetchAt, startedAt: isPov ? null : startedAt });
  const app = status.app || "your calendar";

  const view = {
    synced: {
      title: "Calendar synced",
      message: `Sessions and workouts show in ${app}. Checked ${timeAgo(status.lastFetchAt)}.`,
      icon: <CheckCircle2 className="h-4 w-4" />,
      tone: "bg-emerald-500/15 text-emerald-500",
      action: null,
    },
    connecting: {
      title: "Connecting your calendar…",
      message: "Waiting for your calendar app to check in. iPhone takes seconds, Google can take a few minutes.",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      tone: "bg-amber-500/15 text-amber-500",
      action: "Help",
    },
    stale: {
      title: "Calendar not syncing",
      message: `${app} hasn't checked in since ${status.lastFetchAt ? new Date(status.lastFetchAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "a while"}. Add it again.`,
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "bg-amber-500/15 text-amber-500",
      action: "Fix",
    },
    off: {
      title: "Sync your calendar",
      message: "Optional. See your sessions and workouts in Google or Apple Calendar.",
      icon: <CalendarPlus className="h-4 w-4" />,
      tone: "bg-primary/10 text-primary",
      action: "Set up",
    },
  }[state];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("block w-full text-left", className)}>
        <Card className="border-border bg-card p-3 transition active:scale-[0.99]">
          <div className="flex items-center gap-3">
            <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", view.tone)}>{view.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{view.title}</div>
              <div className="text-xs leading-snug text-muted-foreground">{view.message}</div>
            </div>
            {view.action ? (
              <span className="inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground">
                {view.action}
              </span>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </Card>
      </button>
      <CalendarSyncSheet
        open={open}
        onOpenChange={setOpen}
        synced={state === "synced" ? app : null}
        isPov={isPov}
        onStarted={() => {
          markStarted();
          setStartedAt(Date.now());
        }}
      />
    </>
  );
}

function CalendarSyncSheet({
  open,
  onOpenChange,
  synced,
  isPov,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  synced: string | null;
  isPov: boolean;
  onStarted: () => void;
}) {
  const qc = useQueryClient();
  const feedFn = useServerFn(getMyCalendarFeed);
  const [resetting, setResetting] = useState(false);
  // Fetched when the sheet opens, so the buttons are real links by the time
  // they're tapped (a link opened after an await gets blocked as a pop-up).
  const { data: feed } = useQuery({
    queryKey: ["my-calendar-feed"],
    queryFn: () => feedFn({ data: {} }),
    enabled: open && !isPov,
    staleTime: Infinity,
    retry: false,
  });

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.httpsUrl);
      onStarted();
      toast.success("Link copied. In your calendar app, choose \"Add calendar from URL\" and paste it.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  const reset = async () => {
    if (!confirm("Make a new link? The old one stops working, so you'll need to add your calendar again.")) return;
    setResetting(true);
    try {
      const next = await feedFn({ data: { reset: true } });
      qc.setQueryData(["my-calendar-feed"], next);
      qc.invalidateQueries({ queryKey: ["my-calendar-sync"] });
      toast.success("New link ready. Add your calendar again with the buttons above.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reset");
    } finally {
      setResetting(false);
    }
  };

  const disabled = isPov || !feed;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <SheetHeader className="text-left">
            <SheetTitle className="text-left">{synced ? "Calendar synced" : "Add to your calendar"}</SheetTitle>
            <SheetDescription className="text-left">
              {synced
                ? `Your sessions and workouts are in ${synced}. New, moved and cancelled ones update on their own.`
                : "Pick the calendar you use. Set it up once: new, moved and cancelled sessions and workouts update on their own."}
            </SheetDescription>
          </SheetHeader>

          {isPov && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              Preview only. The client sets this up from their own phone.
            </p>
          )}

          {synced && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Connected to {synced}
            </div>
          )}

          <div className="grid gap-2">
            <Button asChild variant={synced ? "outline" : "default"} className={cn("h-12 justify-start text-sm font-bold", !synced && "bg-gradient-primary")} disabled={disabled}>
              <a
                href={disabled ? undefined : feed!.googleUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => (disabled ? e.preventDefault() : onStarted())}
                aria-disabled={disabled}
              >
                Google Calendar
              </a>
            </Button>
            <Button asChild variant="outline" className="h-12 justify-start text-sm font-bold" disabled={disabled}>
              <a
                href={disabled ? undefined : feed!.webcalUrl}
                onClick={(e) => (disabled ? e.preventDefault() : onStarted())}
                aria-disabled={disabled}
              >
                iPhone / Apple Calendar
              </a>
            </Button>
            <Button variant="ghost" className="h-11 justify-start text-sm" disabled={disabled} onClick={copy}>
              <Copy className="mr-2 h-4 w-4" /> Copy link (Outlook and others)
            </Button>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            Google on a phone: if it opens the app and nothing happens, copy the link and add it once at
            calendar.google.com on a computer (Other calendars → From URL). It then shows on your phone too.
          </p>

          {!isPov && (
            <button type="button" onClick={reset} disabled={!feed || resetting} className="text-[11px] font-semibold text-muted-foreground underline">
              Reset link
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
