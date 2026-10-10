import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  disconnectGoogleCalendar,
  getMyCalendarFeed,
  getMyCalendarSyncStatus,
  startGoogleCalendarConnect,
  syncMyGoogleCalendarNow,
} from "@/lib/schedule.functions";
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

type GoogleStatus = {
  available: boolean;
  connected: boolean;
  revoked: boolean;
  email: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  events: number;
} | null;

/** Connected Google Calendar counts as synced; otherwise the feed's own state. */
function cardState(data: any, startedAt: number | null): CalendarSyncState {
  const g = data?.google as GoogleStatus | undefined;
  if (g?.connected) return "synced";
  const feed = calendarSyncState({ lastFetchAt: data?.lastFetchAt, startedAt });
  if (feed === "connecting") return feed;
  if (g?.revoked && feed !== "synced") return "stale";
  return feed;
}

/**
 * Optional Setup step: put sessions and workouts in the client's own phone
 * calendar. Green only once it really works: Google Calendar connected, or
 * Google / Apple / Outlook has actually pulled the feed (recorded server-side).
 */
export function CalendarSyncCard({
  className,
  viewAsClientId,
  autoOpen,
}: {
  className?: string;
  /** Read-only preview of another client's status (team preview). */
  viewAsClientId?: string | null;
  /** Open the setup sheet on mount (?sync=1 link). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState<Started>(() => (typeof window === "undefined" ? { at: null, app: null } : readStarted()));
  const pov = usePovArgs();
  const previewId = viewAsClientId ?? null;
  const isPov = !!pov.viewAsClientId || !!previewId;
  const statusFn = usePovFn(useServerFn(getMyCalendarSyncStatus));

  const { data: status, isLoading } = useQuery({
    queryKey: ["my-calendar-sync", previewId ?? pov.viewAsClientId ?? null],
    queryFn: () => statusFn({ data: previewId ? { viewAsClientId: previewId } : {} }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // While waiting for the calendar to connect, check back often so the card
    // goes green the moment it works.
    refetchInterval: (q) => (cardState(q.state.data, started.at) === "connecting" ? 15_000 : false),
  });

  const google = (status?.google ?? null) as GoogleStatus;
  const state: CalendarSyncState = cardState(status, isPov ? null : started.at);
  const app = google?.connected ? "Google Calendar" : status?.app || "your calendar";

  // Say so when it connects, instead of leaving them to wonder.
  const prevState = useRef<CalendarSyncState | null>(null);
  useEffect(() => {
    if (prevState.current === "connecting" && state === "synced") {
      toast.success(`Connected. Your sessions and workouts now show in ${app}.`);
    }
    prevState.current = state;
  }, [state, app]);

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpen && !isPov && status?.isClient && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [autoOpen, isPov, status?.isClient]);

  if (isLoading || !status?.isClient) return null;

  const view = {
    synced: {
      title: "Calendar synced",
      message: google?.connected
        ? `Sessions and workouts sync to Google Calendar${google.email ? ` (${google.email})` : ""}.${google.lastSyncedAt ? ` Updated ${timeAgo(google.lastSyncedAt)}.` : ""}`
        : `Sessions and workouts show in ${app}. Checked ${timeAgo(status.lastFetchAt)}.`,
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
      message: google?.revoked
        ? "Google access was removed, so your calendar stopped updating. Connect Google Calendar again."
        : `${app} hasn't checked in since ${status.lastFetchAt ? new Date(status.lastFetchAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "a while"}. Add it again.`,
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
        google={google}
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
  google,
  isPov,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  synced: string | null;
  google: GoogleStatus;
  isPov: boolean;
  onStarted: (app: string) => void;
}) {
  const qc = useQueryClient();
  const feedFn = useServerFn(getMyCalendarFeed);
  const startGoogleFn = useServerFn(startGoogleCalendarConnect);
  const disconnectGoogleFn = useServerFn(disconnectGoogleCalendar);
  const syncNowFn = useServerFn(syncMyGoogleCalendarNow);
  const [syncing, setSyncing] = useState(false);
  const [lastManualSync, setLastManualSync] = useState(0);
  const syncNow = async () => {
    if (Date.now() - lastManualSync < 60_000) {
      toast.message("Synced less than a minute ago. Try again in a moment.");
      return;
    }
    setSyncing(true);
    try {
      const r: any = await syncNowFn();
      setLastManualSync(Date.now());
      if (r?.skipped === "revoked") toast.error("Google access was removed. Reconnect Google Calendar.");
      else if (r?.skipped) toast.message("Nothing to sync yet.");
      else
        toast.success(
          `Synced ${r?.events ?? 0} item${r?.events === 1 ? "" : "s"}: ${r?.inserted ?? 0} added, ${r?.updated ?? 0} updated, ${r?.removed ?? 0} removed${r?.failed ? `, ${r.failed} failed` : ""}.`,
        );
      await qc.invalidateQueries({ queryKey: ["my-calendar-sync"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't sync.");
    } finally {
      setSyncing(false);
    }
  };
  const [resetting, setResetting] = useState(false);
  const [openingGoogle, setOpeningGoogle] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expanded, setExpanded] = useState<CalendarChoice["id"] | null>(null);
  const platform = useMemo<DevicePlatform>(
    () => (typeof navigator === "undefined" ? "other" : devicePlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)),
    [],
  );
  const googleConnected = !!google?.connected;
  // Once the Google sign-in app is set up, Google is one tap on every device.
  const googleConnect = !!google?.available;
  const choices = calendarChoices(platform, { googleConnect }).filter((c) => !(c.id === "google" && googleConnected));
  const phone = platform === "ios" || platform === "android";

  const connectGoogle = async () => {
    setOpeningGoogle(true);
    try {
      const { url } = await startGoogleFn({ data: { returnTo: `${window.location.pathname}${window.location.search}` } });
      onStarted("Google sign-in");
      window.location.assign(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open Google sign-in.");
      setOpeningGoogle(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!confirm("Disconnect Google Calendar? The JF Effect calendar is removed from your Google account.")) return;
    setDisconnecting(true);
    try {
      await disconnectGoogleFn();
      await qc.invalidateQueries({ queryKey: ["my-calendar-sync"] });
      toast.success("Google Calendar disconnected.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

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

          {googleConnected ? (
            <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Google Calendar connected
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {google?.email ? `${google.email}, ` : ""}in a calendar called "JF Effect".
                {google?.lastSyncedAt ? ` Updated ${timeAgo(google.lastSyncedAt)}.` : ""} Changes show up within about 5 minutes.
              </p>
              {google?.error && (
                <p className="text-xs leading-snug text-amber-300">The last update didn't fully go through. It tries again every 5 minutes.</p>
              )}
              <p className="text-xs leading-snug text-muted-foreground">
                Your JF Effect sessions, appointments and scheduled workouts are added to a separate "JF Effect" calendar in your
                Google account. Workouts show as all-day items.
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                <b>If you don't see them:</b> in the Google Calendar app make sure "JF Effect" is ticked; on iPhone's Calendar app,
                enable it at{" "}
                <a href="https://calendar.google.com/calendar/syncselect" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  calendar.google.com/calendar/syncselect
                </a>
                .
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                One-way sync: the app adds its schedule to Google. It doesn't import your personal Google events.
              </p>
              <Button type="button" size="sm" variant="outline" className="h-10 w-full sm:w-auto" disabled={isPov || syncing} onClick={syncNow}>
                {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              {!isPov && (
                <button
                  type="button"
                  onClick={disconnectGoogle}
                  disabled={disconnecting}
                  className="text-[11px] font-semibold text-muted-foreground underline underline-offset-2"
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect Google Calendar"}
                </button>
              )}
            </div>
          ) : (
            synced && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Connected to {synced}
              </div>
            )
          )}

          <div className="grid gap-2">
            {choices.map((c, i) => {
              // One red action at a time: the recommended calendar, until they open another one's steps.
              const primary = !synced && !expanded && i === 0;
              const btnClass = cn("h-12 w-full justify-between text-sm font-bold", primary && "bg-gradient-primary");

              if (c.how === "connect") {
                return (
                  <Button
                    key={c.id}
                    type="button"
                    variant={primary ? "default" : "outline"}
                    className={btnClass}
                    disabled={isPov || openingGoogle}
                    onClick={connectGoogle}
                  >
                    <span>{google?.revoked ? "Reconnect Google Calendar" : c.label}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium opacity-70">
                      {openingGoogle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {openingGoogle ? "Opening Google…" : c.hint}
                    </span>
                  </Button>
                );
              }

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

          {!phone && !googleConnect && (
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
