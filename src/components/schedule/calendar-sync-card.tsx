import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getMyCalendarFeed, getMyCalendarSyncStatus } from "@/lib/schedule.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import {
  calendarChoices,
  calendarSyncState,
  connectingMessage,
  devicePlatform,
  timeAgo,
  type CalendarChoice,
  type CalendarSyncState,
  type DevicePlatform,
} from "@/lib/calendar-sync";
import { cn } from "@/lib/utils";

const STARTED_KEY = "jf.calendarSync.startedAt";
const STARTED_APP_KEY = "jf.calendarSync.app";

type Started = { at: number | null; app: string | null };

function readStarted(): Started {
  try {
    const v = window.localStorage.getItem(STARTED_KEY);
    return { at: v ? Number(v) || null : null, app: window.localStorage.getItem(STARTED_APP_KEY) };
  } catch {
    return { at: null, app: null };
  }
}
function markStarted(app: string) {
  try {
    window.localStorage.setItem(STARTED_KEY, String(Date.now()));
    window.localStorage.setItem(STARTED_APP_KEY, app);
  } catch {
    /* storage blocked: the card just won't show "connecting" */
  }
}

type Feed = { httpsUrl: string; webcalUrl: string; googleUrl: string; outlookUrl: string; office365Url: string };

/**
 * Optional Setup step: put sessions and workouts in the client's own phone
 * calendar. Green only once Google / Apple / Outlook has actually pulled the
 * feed (recorded server-side), so the check means it really works.
 */
export function CalendarSyncCard({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState<Started>(() => (typeof window === "undefined" ? { at: null, app: null } : readStarted()));
  const pov = usePovArgs();
  const isPov = !!pov.viewAsClientId;
  const statusFn = usePovFn(useServerFn(getMyCalendarSyncStatus));

  const { data: status, isLoading } = useQuery({
    queryKey: ["my-calendar-sync", pov.viewAsClientId ?? null],
    queryFn: () => statusFn({ data: {} }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // While waiting for the calendar's first fetch, check back often so the
    // card goes green the moment it works.
    refetchInterval: (q) =>
      calendarSyncState({ lastFetchAt: (q.state.data as any)?.lastFetchAt, startedAt: started.at }) === "connecting" ? 15_000 : false,
  });

  const state: CalendarSyncState = calendarSyncState({ lastFetchAt: status?.lastFetchAt, startedAt: isPov ? null : started.at });
  const app = status?.app || "your calendar";

  // Say so when it connects, instead of leaving them to wonder.
  const prevState = useRef<CalendarSyncState | null>(null);
  useEffect(() => {
    if (prevState.current === "connecting" && state === "synced") {
      toast.success(`Connected. Your sessions and workouts now show in ${app}.`);
    }
    prevState.current = state;
  }, [state, app]);

  if (isLoading || !status?.isClient) return null;

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
      message: connectingMessage(started.app),
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
      message: "Optional. See your sessions and workouts in Apple, Google or Outlook.",
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
        onStarted={(picked) => {
          markStarted(picked);
          setStarted({ at: Date.now(), app: picked });
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
  onStarted: (app: string) => void;
}) {
  const qc = useQueryClient();
  const feedFn = useServerFn(getMyCalendarFeed);
  const [resetting, setResetting] = useState(false);
  const [expanded, setExpanded] = useState<CalendarChoice["id"] | null>(null);
  const platform = useMemo<DevicePlatform>(
    () => (typeof navigator === "undefined" ? "other" : devicePlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)),
    [],
  );
  const choices = calendarChoices(platform);
  const phone = platform === "ios" || platform === "android";

  // Fetched when the sheet opens, so the buttons are real links by the time
  // they're tapped (a link opened or shared after an await gets blocked).
  const { data: feed } = useQuery<Feed>({
    queryKey: ["my-calendar-feed"],
    queryFn: () => feedFn({ data: {} }) as Promise<Feed>,
    enabled: open && !isPov,
    staleTime: Infinity,
    retry: false,
  });

  const copyText = async (text: string, app: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onStarted(app);
      toast.success(message);
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      window.prompt("Copy this link:", text);
      onStarted(app);
    }
  };

  /** Phone → computer: the share sheet (AirDrop, Mail, Messages...), or copy. */
  const sendToComputer = async (url: string, app: string) => {
    const text = `Add my JF Effect calendar to ${app}: open this link on a computer and click Add.`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "JF Effect calendar", text, url });
        onStarted(app);
        toast.success("Sent. Open it on your computer and click Add.");
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      }
    }
    await copyText(url, app, "Link copied. Send it to yourself, open it on a computer and click Add.");
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
  const hrefFor = (c: CalendarChoice) =>
    c.id === "apple" ? feed?.webcalUrl : c.id === "google" ? feed?.googleUrl : feed?.outlookUrl;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          {/* Title sits on the Back row; the description gets the full width below it. */}
          <SheetHeader className="text-left">
            <SheetTitle className="text-left">{synced ? "Calendar synced" : "Add to your calendar"}</SheetTitle>
          </SheetHeader>
          <SheetDescription className="text-left">
            {synced
              ? `Your sessions and workouts are in ${synced}. New, moved and cancelled ones update on their own.`
              : "Pick the calendar you use. Set it up once and new, moved and cancelled sessions and workouts update on their own."}
          </SheetDescription>

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
            {choices.map((c, i) => {
              // One red action at a time: the recommended calendar, until they open another one's steps.
              const primary = !synced && !expanded && i === 0;
              const btnClass = cn("h-12 w-full justify-between text-sm font-bold", primary && "bg-gradient-primary");

              if (c.how === "web") {
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id} className="space-y-2">
                    <Button
                      type="button"
                      variant={primary ? "default" : "outline"}
                      className={btnClass}
                      disabled={disabled}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                    >
                      <span>{c.label}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium opacity-70">
                        {c.hint}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                      </span>
                    </Button>
                    {isOpen && feed && c.id === "google" && (
                      <GoogleOnPhone
                        platform={platform}
                        onSend={() => sendToComputer(feed.googleUrl, "Google Calendar")}
                        onCopy={() => copyText(feed.googleUrl, "Google Calendar", "Google link copied.")}
                      />
                    )}
                    {isOpen && feed && c.id === "outlook" && (
                      <OutlookOnPhone
                        onSend={() => sendToComputer(feed.outlookUrl, "Outlook")}
                        onSendWork={() => sendToComputer(feed.office365Url, "Outlook")}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div key={c.id} className="space-y-1.5">
                  <Button asChild variant={primary ? "default" : "outline"} className={btnClass} disabled={disabled}>
                    <a
                      href={disabled ? undefined : hrefFor(c)}
                      target={c.how === "link" ? "_blank" : undefined}
                      rel="noreferrer"
                      onClick={(e) => (disabled ? e.preventDefault() : onStarted(c.label))}
                      aria-disabled={disabled}
                    >
                      <span>{c.label}</span>
                      <span className="text-[11px] font-medium opacity-70">{c.hint}</span>
                    </a>
                  </Button>
                  {c.id === "apple" && platform === "ios" && feed && (
                    <AppleFallback onCopy={() => copyText(feed.httpsUrl, "Apple Calendar", "Link copied.")} />
                  )}
                </div>
              );
            })}

            <Button
              variant="ghost"
              className="h-11 justify-start text-sm"
              disabled={disabled}
              onClick={() =>
                feed &&
                copyText(feed.httpsUrl, "Calendar app", 'Link copied. In your calendar app, choose "Add calendar from URL" (or "Subscribe") and paste it.')
              }
            >
              <Copy className="mr-2 h-4 w-4" /> Any other calendar app: copy the link
            </Button>
            {!disabled && !phone && (
              <a
                href={feed?.office365Url}
                target="_blank"
                rel="noreferrer"
                onClick={() => onStarted("Outlook")}
                className="px-1 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
              >
                Outlook for work or school (Microsoft 365)
              </a>
            )}
          </div>

          {!phone && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Google checks linked calendars every 12 to 24 hours, so a moved session can take a while to show there.
              Apple Calendar picks up changes much faster.
            </p>
          )}

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

function StepButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-bold text-foreground transition hover:bg-secondary active:scale-[0.98]"
    >
      <Copy className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

/** iPhone: the Subscribe prompt didn't show (some home-screen apps swallow it). */
function AppleFallback({ onCopy }: { onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
      >
        No Subscribe prompt? Add it in Settings instead
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-2 rounded-lg border border-border bg-muted/30 p-3 pl-7 text-xs leading-snug">
          <li>
            <StepButton onClick={onCopy}>Copy your calendar link</StepButton>
          </li>
          <li>
            Open <b>Settings → Apps → Calendar → Calendar Accounts</b> (older iPhones: Settings → Calendar → Accounts).
          </li>
          <li>
            Tap <b>Add Account → Other → Add Subscribed Calendar</b>, paste the link, tap <b>Next</b>, then <b>Save</b>.
          </li>
        </ol>
      )}
    </div>
  );
}

/**
 * Google's phone apps can't add a calendar from a link (Google only allows it
 * on its website), so a plain link opens the app and does nothing. These are
 * the two ways that work from a phone.
 */
function GoogleOnPhone({ platform, onSend, onCopy }: { platform: DevicePlatform; onSend: () => void; onCopy: () => void }) {
  const ios = platform === "ios";
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-snug">
      <p>
        Google's phone app can't add a calendar from a link. Add it once on Google's website and it shows in the Google app on
        all your devices.
      </p>
      <Button type="button" className="h-11 w-full text-sm font-bold" onClick={onSend}>
        <Send className="mr-2 h-4 w-4" /> Send the link to my computer
      </Button>
      <p className="text-muted-foreground">
        Open it on a computer signed in to the same Google account and click <b>Add</b>.
      </p>
      <div className="pt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">No computer? On this phone</div>
      <ol className="list-decimal space-y-2 pl-4">
        <li>
          <StepButton onClick={onCopy}>Copy the Google link</StepButton>
        </li>
        <li>Paste it into {ios ? "Safari's" : "Chrome's"} address bar and go (not into the Google app).</li>
        <li>
          If Google shows its phone layout, tap {ios ? <b>aA → Request Desktop Website</b> : <b>⋮ → Desktop site</b>}, then paste
          the link again.
        </li>
        <li>
          Tap <b>Add</b>.
        </li>
      </ol>
      <p className="text-muted-foreground">
        Google checks for changes every 12 to 24 hours, so a moved session can show late there.
        {ios ? " Apple Calendar picks up changes much faster and can show your Google calendar too." : ""}
      </p>
    </div>
  );
}

/** Outlook's phone app can't add a calendar from a link either. */
function OutlookOnPhone({ onSend, onSendWork }: { onSend: () => void; onSendWork: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-snug">
      <p>Outlook's phone app can't add a calendar from a link. Add it once on Outlook's website and it shows everywhere you use Outlook.</p>
      <Button type="button" className="h-11 w-full text-sm font-bold" onClick={onSend}>
        <Send className="mr-2 h-4 w-4" /> Send the link to my computer
      </Button>
      <p className="text-muted-foreground">
        Open it on a computer signed in to Outlook and click <b>Import</b>.{" "}
        <button type="button" onClick={onSendWork} className="font-semibold underline underline-offset-2">
          Work or school account? Send this one instead
        </button>
      </p>
    </div>
  );
}
