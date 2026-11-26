/**
 * Account headshots for staff: the client's panel (status, the photo waiting
 * with the server's and the device's checks, request / retake with a private
 * reason, take it with them in person, the record), Home's review card and
 * sheet (approve or ask again inline, no navigating), and the admin's reminder
 * settings. Reads with the caller's own login; the server checks the admin or
 * the client's own coach for every action. The client never sees who asked or
 * why: they get the standard account update request.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Camera, Check, ChevronRight, History, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { formatDistanceToNowStrict } from "date-fns";
import {
  HEADSHOT_COPY,
  HEADSHOT_STATUS_LABEL,
  HEADSHOT_STATUS_TONE,
  crewScheduleWords,
  headshotScheduleWords,
  type HeadshotStatus,
  type PhotoReminderSettings,
} from "@/lib/headshots/rules";
import { flagWords } from "@/lib/headshots/evidence";
import {
  cancelClientHeadshotRequest,
  decideClientHeadshot,
  getClientHeadshot,
  getPhotoReminderSettings,
  listHeadshotQueue,
  requestClientHeadshot,
  savePhotoReminderSettings,
} from "@/lib/headshots/headshots.functions";

const HeadshotCapture = lazyWithRetry(() => import("@/components/headshots/headshot-capture").then((m) => ({ default: m.HeadshotCapture })));

const ago = (iso: string | null | undefined) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : "");

export function HeadshotStatusChip({ status, className }: { status: HeadshotStatus; className?: string }) {
  const tone = HEADSHOT_STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold",
        tone === "good" ? "bg-success/10 text-success" : tone === "attention" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
        className,
      )}
      data-headshot-chip={status}
    >
      {HEADSHOT_STATUS_LABEL[status]}
    </span>
  );
}

type View = Awaited<ReturnType<typeof getClientHeadshot>>;

function useClientHeadshot(clientId: string) {
  const fn = useServerFn(getClientHeadshot);
  return useQuery({ queryKey: ["client-headshot", clientId], queryFn: () => fn({ data: { clientId } }) as Promise<View>, staleTime: 30_000 });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["client-headshot"] });
    void qc.invalidateQueries({ queryKey: ["headshot-queue"] });
    void qc.invalidateQueries({ queryKey: ["client"] });
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: ["clients-min"] });
  };
}

/* ---- decide / request ---------------------------------------------------- */

function ReasonDialog({ open, title, description, confirm, busy, onConfirm, onCancel }: { open: boolean; title: string; description: string; confirm: string; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-muted p-3 text-[13px]">
          <div className="font-semibold">{HEADSHOT_COPY.update.title}</div>
          <div className="mt-1 text-muted-foreground">{HEADSHOT_COPY.update.body}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">What the client sees. Your name and reason are never shown.</div>
        </div>
        <label className="space-y-1.5">
          <span className="text-[13px] font-semibold">Reason (optional, private)</span>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} rows={3} placeholder="e.g. Face is in shadow; sunglasses; an old photo" data-headshot-reason />
        </label>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(reason)} disabled={busy} data-headshot-reason-confirm>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useHeadshotActions() {
  const decideFn = useServerFn(decideClientHeadshot);
  const requestFn = useServerFn(requestClientHeadshot);
  const cancelFn = useServerFn(cancelClientHeadshotRequest);
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return {
    busy,
    approve: (headshotId: string) => run(`approve:${headshotId}`, () => decideFn({ data: { headshotId, decision: "accept" } }), "Headshot approved"),
    decline: (headshotId: string, note: string) => run(`decline:${headshotId}`, () => decideFn({ data: { headshotId, decision: "decline", note: note || null } }), "Retake requested"),
    request: (clientId: string, reason: string) => run(`request:${clientId}`, () => requestFn({ data: { clientId, reason: reason || null } }), "Headshot requested"),
    cancel: (clientId: string) => run(`cancel:${clientId}`, () => cancelFn({ data: { clientId } }), "Request cancelled"),
  };
}

/* ---- the client's panel ---------------------------------------------------- */

export function AccountHeadshotPanel({ clientId, clientName, bare = false }: { clientId: string; clientName?: string; bare?: boolean }) {
  const { data: v, isPending, isError, refetch } = useClientHeadshot(clientId);
  const actions = useHeadshotActions();
  const invalidate = useInvalidate();
  const [ask, setAsk] = useState<null | { kind: "request" } | { kind: "decline"; id: string }>(null);
  const [capture, setCapture] = useState(false);
  const [history, setHistory] = useState(false);

  // In a sheet (the Clients list's ⋯, the client header's ⋯) the panel sits bare: no card in a sheet.
  const Wrap = bare ? "div" : Card;
  if (isPending) return bare ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : <Card className="h-40 animate-pulse p-5" />;
  if (isError || !v)
    return (
      <Wrap className={bare ? "" : "p-5"}>
        <p className="text-sm text-muted-foreground">Couldn't load the account headshot.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>Try again</Button>
      </Wrap>
    );

  return (
    <Wrap className={bare ? "space-y-4" : "space-y-4 p-5"} id={bare ? undefined : "account-headshot"} data-headshot-panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold"><UserRound className="h-4 w-4 text-muted-foreground" /> Account headshot</h3>
        <HeadshotStatusChip status={v.status} />
      </div>

      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
          {v.currentUrl ? <img src={v.currentUrl} alt="Current account headshot" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-muted-foreground"><Camera className="h-6 w-6" /></div>}
        </div>
        <div className="min-w-0 text-[13px] text-muted-foreground">
          {v.currentUrl ? (
            <>
              <div className="font-medium text-foreground">{v.status === "verified" ? "Current headshot" : "Previously submitted headshot"}</div>
              <div>
                {v.status === "verified" ? "Taken live and approved" : "On file from before live verification"}
                {v.currentUpdatedAt ? ` · ${new Date(v.currentUpdatedAt).toLocaleDateString()}` : ""}
              </div>
            </>
          ) : (
            <div>No headshot on file.{!v.request && v.applies ? " They aren't asked automatically (they joined before account headshots); request one if you need it." : ""}</div>
          )}
        </div>
      </div>

      {v.pending && (
        <div className="space-y-3 rounded-2xl border border-border p-3" data-headshot-pending>
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-semibold">Waiting for review</span>
            <span className="text-muted-foreground">{ago(v.pending.submittedAt)}</span>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {v.pending.photoUrl && <img src={v.pending.photoUrl} alt="New headshot" className="h-40 w-40 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1 space-y-1.5 text-[12px] text-muted-foreground">
              <CheckLines view={v} />
            </div>
          </div>
          {v.pending.evidenceUrl && (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Frames from the capture ({["straight on", ...v.pending.challenge.map((c) => (c === "blink" ? "blink" : c === "turn_left" ? "turned left" : "turned right"))].join(", ")})</div>
              <img src={v.pending.evidenceUrl} alt="Capture frames" className="h-20 w-auto max-w-full rounded-lg object-contain [image-rendering:auto]" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" onClick={() => void actions.approve(v.pending!.id)} disabled={!!actions.busy} data-headshot-approve>
              {actions.busy === `approve:${v.pending.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Approve
            </Button>
            <Button variant="outline" className="h-10" onClick={() => setAsk({ kind: "decline", id: v.pending!.id })} disabled={!!actions.busy} data-headshot-decline>
              Request retake
            </Button>
          </div>
        </div>
      )}

      {v.request && !v.pending && (
        <div className="rounded-2xl bg-muted/60 p-3 text-[13px]" data-headshot-request>
          <div className="font-semibold">{v.request.kind === "onboarding" ? "Asked as part of setup" : "Retake requested"}</div>
          <div className="text-muted-foreground">
            {v.request.openedBy ? `By ${v.request.openedBy} · ` : ""}
            {ago(v.request.openedAt)} · {v.request.remindersSent} reminder{v.request.remindersSent === 1 ? "" : "s"} sent
            {v.request.snoozedUntil && new Date(v.request.snoozedUntil) > new Date() ? ` · they chose "Remind me later" (until ${new Date(v.request.snoozedUntil).toLocaleDateString()})` : ""}
          </div>
          {v.request.reason && <div className="mt-1.5"><span className="font-medium">Private reason:</span> <span className="text-muted-foreground">{v.request.reason}</span></div>}
          <button type="button" className="mt-2 text-[13px] font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-50" onClick={() => void actions.cancel(clientId)} disabled={!!actions.busy} data-headshot-cancel>
            Cancel the request
          </button>
        </div>
      )}

      {v.applies ? (
        <div className="flex flex-wrap gap-2">
          {!v.request && !v.pending && (
            <Button variant="outline" className="h-10" onClick={() => setAsk({ kind: "request" })} disabled={!!actions.busy} data-headshot-request-new>
              {v.currentUrl ? "Request a retake" : "Request a headshot"}
            </Button>
          )}
          <Button variant="outline" className="h-10" onClick={() => setCapture(true)} disabled={!v.hasLogin} data-headshot-take>
            <Camera className="mr-2 h-4 w-4" /> Take it with them
          </Button>
          <Button variant="ghost" className="h-10" onClick={() => setHistory((h) => !h)}>
            <History className="mr-2 h-4 w-4" /> Record
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">Account headshots are for coaching clients with a login.</p>
      )}

      {history && (
        <ul className="space-y-1.5 border-t border-border pt-3 text-[12px]" data-headshot-history>
          {v.events.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
          {v.events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-28 shrink-0 text-muted-foreground">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span>{eventWords(e.kind, e.detail)}{e.actor ? ` · ${e.actor}` : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Private to the client's coach and admins. The automatic checks reduce simple spoofing but don't prove identity; you're the one who knows them. Capture frames are deleted within 30 days.
      </p>

      <ReasonDialog
        open={!!ask}
        title={ask?.kind === "decline" ? "Request a retake" : v.currentUrl ? "Request a retake" : "Request a headshot"}
        description={ask?.kind === "decline" ? "The photo waiting isn't used, and their current one stays until a new one is approved." : "They're asked in the app, then reminded on your reminder schedule until it's done. Their current photo stays until a new one is approved."}
        confirm="Send request"
        busy={!!actions.busy}
        onCancel={() => setAsk(null)}
        onConfirm={(reason) => {
          const a = ask;
          setAsk(null);
          if (a?.kind === "decline") void actions.decline(a.id, reason);
          else void actions.request(clientId, reason);
        }}
      />
      {capture && (
        <HeadshotCapture
          open
          mode="coach"
          clientId={clientId}
          clientName={clientName}
          onOpenChange={setCapture}
          onDone={() => {
            invalidate();
          }}
        />
      )}
    </Wrap>
  );
}

/**
 * The account headshot in a sheet, so a retake is one tap from client management (the Clients
 * list row's ⋯) and from the client's header ⋯, without opening the client's details.
 */
export function HeadshotSheet({ open, onOpenChange, clientId, clientName }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; clientName?: string | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] sm:mx-auto sm:max-w-[560px]" data-headshot-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>{clientName || "Account headshot"}</SheetTitle>
          <SheetDescription>Their private account headshot. Request one or a retake, approve one waiting, or take it with them.</SheetDescription>
        </SheetHeader>
        <div className="mt-3">{open && <AccountHeadshotPanel clientId={clientId} clientName={clientName ?? undefined} bare />}</div>
      </SheetContent>
    </Sheet>
  );
}

function CheckLines({ view }: { view: View }) {
  const p = view.pending!;
  const server = (p.server ?? {}) as any;
  const device = (p.device ?? {}) as any;
  const lines: { ok: boolean | null; text: string }[] = [];
  lines.push({
    ok: p.method !== "live",
    text: p.method === "guided" ? "Guided live capture with face checks" : p.method === "coach_assisted" ? "Taken by the coach in person" : "Live capture without the automatic face checks",
  });
  if (server.blink) lines.push({ ok: !!server.blink.confirmed, text: server.blink.confirmed ? "Blink confirmed by the server" : "Server couldn't confirm the blink" });
  if (server.turn) lines.push({ ok: !!server.turn.confirmed, text: server.turn.confirmed ? "Head turn confirmed by the server" : "Server couldn't confirm the head turn" });
  if (Array.isArray(device.steps) && device.steps.length) lines.push({ ok: true, text: `Device saw: ${device.steps.map((s: any) => (s.step === "blink" ? "blink" : "turn")).join(", ")}` });
  for (const f of p.flags.filter((f) => !["blink_unconfirmed", "turn_unconfirmed", "no_device_checks", "coach_assisted"].includes(f))) lines.push({ ok: false, text: flagWords(f) });
  return (
    <ul className="space-y-1" data-headshot-checks>
      {lines.map((l, i) => (
        <li key={i} className={cn("flex items-start gap-1.5", l.ok === false && "text-warning")}>
          <span aria-hidden>{l.ok === false ? "•" : "✓"}</span>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

function eventWords(kind: string, d: Record<string, any>): string {
  switch (kind) {
    case "requested":
      return d.kind === "onboarding" ? "Asked as part of setup" : `Headshot requested${d.reason ? ` (${d.reason})` : ""}`;
    case "capture_started":
      return d.method === "coach_assisted" ? "Coach started a photo" : "Opened the headshot camera";
    case "submitted":
      return "Submitted a headshot";
    case "check_failed":
      return `A capture didn't pass (${String(d.reason ?? "").replace(/_/g, " ")})`;
    case "accepted":
      return d.automatic ? "Headshot automatically saved" : "Headshot approved";
    case "declined":
      return `Retake requested${d.note ? ` (${d.note})` : ""}`;
    case "request_cancelled":
      return "Request cancelled";
    case "reminder_sent":
      return `Reminder ${d.number ?? ""} sent`.replace("  ", " ");
    case "snoozed":
      return "Chose Remind me later";
    case "help_asked":
      return "Asked the coach to take it with them";
    case "files_deleted":
      return "Capture frames deleted";
    default:
      return kind.replace(/_/g, " ");
  }
}

/* ---- Home: what's waiting -------------------------------------------------- */

type QueueItem = Awaited<ReturnType<typeof listHeadshotQueue>>[number];

function useHeadshotQueue() {
  const fn = useServerFn(listHeadshotQueue);
  return useQuery({ queryKey: ["headshot-queue"], queryFn: () => fn() as Promise<QueueItem[]>, staleTime: 60_000, refetchInterval: 5 * 60_000 });
}

/** Home's card: headshots to review (and requests still out). Hidden when there's nothing to review. */
export function HeadshotReviewCard() {
  const { data } = useHeadshotQueue();
  const [open, setOpen] = useState(false);
  const items = data ?? [];
  const toReview = items.filter((i) => i.status === "pending");
  if (!toReview.length) return null;
  return (
    <>
      <Card className="p-4" data-headshot-review-card>
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-left">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted"><UserRound className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">Account headshots to review</h2>
            <p className="truncate text-[13px] text-muted-foreground">{toReview.map((i) => i.name).join(", ")}</p>
          </div>
          <span className="text-[15px] font-semibold tabular-nums">{toReview.length}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </Card>
      <HeadshotReviewSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export function HeadshotReviewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isPending } = useHeadshotQueue();
  const actions = useHeadshotActions();
  const [decline, setDecline] = useState<QueueItem | null>(null);
  const items = data ?? [];
  const pending = items.filter((i) => i.status === "pending");
  const outstanding = items.filter((i) => i.status !== "pending");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] sm:mx-auto sm:max-w-[640px]" data-headshot-review-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>Account headshots</SheetTitle>
          <SheetDescription>Approve a new headshot or ask for another. The client only ever sees the standard request.</SheetDescription>
        </SheetHeader>
        {isPending && <div className="mt-4 h-32 animate-pulse rounded-xl bg-muted" />}
        {!isPending && pending.length === 0 && <p className="mt-4 text-[14px] text-muted-foreground">Nothing to review.</p>}
        <ul className="mt-3 space-y-3">
          {pending.map((i) => (
            <li key={i.clientId} className="flex gap-3 rounded-2xl border border-border p-3" data-headshot-queue-item>
              {i.photoUrl ? <img src={i.photoUrl} alt={`${i.name}'s new headshot`} className="h-24 w-24 shrink-0 rounded-xl object-cover" /> : <div className="h-24 w-24 shrink-0 rounded-xl bg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Link to="/admin/clients/$id" params={{ id: i.clientId }} search={{ tab: "info" } as any} className="truncate text-[15px] font-semibold hover:underline" onClick={() => onOpenChange(false)}>{i.name}</Link>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{ago(i.submittedAt)}</span>
                </div>
                {i.flags.length > 0 && <p className="mt-0.5 text-[12px] text-warning">{i.flags.map(flagWords).join(" · ")}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" className="h-9" onClick={() => i.headshotId && void actions.approve(i.headshotId)} disabled={!!actions.busy}>
                    {actions.busy === `approve:${i.headshotId}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => setDecline(i)} disabled={!!actions.busy}>Request retake</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {outstanding.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[13px] font-semibold text-muted-foreground">Waiting on the client</h3>
            <ul className="mt-2 divide-y divide-border">
              {outstanding.map((i) => (
                <li key={i.clientId} className="flex items-center gap-2 py-2.5 text-[14px]">
                  <Link to="/admin/clients/$id" params={{ id: i.clientId }} search={{ tab: "info" } as any} className="min-w-0 flex-1 truncate font-medium hover:underline" onClick={() => onOpenChange(false)}>{i.name}</Link>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{i.requestKind === "onboarding" ? "Setup" : "Retake"} · {ago(i.openedAt)} · {i.remindersSent} reminder{i.remindersSent === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ReasonDialog
          open={!!decline}
          title={`Request a retake${decline ? ` from ${decline.name}` : ""}`}
          description="The photo waiting isn't used; their current one stays until a new one is approved."
          confirm="Send request"
          busy={!!actions.busy}
          onCancel={() => setDecline(null)}
          onConfirm={(reason) => {
            const d = decline;
            setDecline(null);
            if (d?.headshotId) void actions.decline(d.headshotId, reason);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/* ---- settings (admin) ------------------------------------------------------- */

export function PhotoReminderSettingsCard() {
  const getFn = useServerFn(getPhotoReminderSettings);
  const saveFn = useServerFn(savePhotoReminderSettings);
  const qc = useQueryClient();
  const { data, isPending, isError } = useQuery({ queryKey: ["photo-reminder-settings"], queryFn: () => getFn() as Promise<PhotoReminderSettings> });
  const [draft, setDraft] = useState<PhotoReminderSettings | null>(null);
  const [follow, setFollow] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) {
      setDraft(data);
      setFollow(data.headshot.followUpDays.join(", "));
    }
  }, [data]);
  if (isError) return null;
  if (isPending || !draft) return <Card className="h-48 animate-pulse p-5" />;
  const save = async () => {
    setSaving(true);
    try {
      const followUpDays = follow.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      const next = await saveFn({ data: { ...draft, headshot: { ...draft.headshot, followUpDays } } });
      qc.setQueryData(["photo-reminder-settings"], next);
      toast.success("Photo reminders saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <Card className="space-y-5 p-5" data-photo-reminder-settings>
      <div>
        <h3 className="text-[16px] font-semibold">Photo reminders</h3>
        <p className="text-[13px] text-muted-foreground">How often people are reminded about an account headshot or a Crew picture. Never during quiet hours, a workout or at night; never more than one photo reminder at a time.</p>
      </div>
      <section className="space-y-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[14px] font-semibold">Account headshot reminders</span>
          <Switch checked={draft.headshot.enabled} onCheckedChange={(on) => setDraft({ ...draft, headshot: { ...draft.headshot, enabled: on } })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Follow-ups (days after the request)</span>
            <Input value={follow} onChange={(e) => setFollow(e.target.value)} inputMode="numeric" placeholder="3, 7, 14" />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Then every (days, 0 = stop)</span>
            <Input value={String(draft.headshot.repeatDays)} onChange={(e) => setDraft({ ...draft, headshot: { ...draft.headshot, repeatDays: num(e.target.value) } })} inputMode="numeric" />
          </label>
        </div>
        <p className="text-[12px] text-muted-foreground">{headshotScheduleWords(draft.headshot)}.</p>
      </section>
      <section className="space-y-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[14px] font-semibold">Crew picture reminder</span>
          <Switch checked={draft.crew.enabled} onCheckedChange={(on) => setDraft({ ...draft, crew: { ...draft.crew, enabled: on } })} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(["firstDays", "secondDays", "repeatDays"] as const).map((k) => (
            <label key={k} className="space-y-1">
              <span className="text-[12px] text-muted-foreground">{k === "firstDays" ? "First (days)" : k === "secondDays" ? "Second (days)" : "Then every"}</span>
              <Input value={String(draft.crew[k])} onChange={(e) => setDraft({ ...draft, crew: { ...draft.crew, [k]: num(e.target.value) } })} inputMode="numeric" />
            </label>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">{crewScheduleWords(draft.crew)}, from when they joined, until they add any picture.</p>
      </section>
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save</Button>
      </div>
    </Card>
  );
}
