/**
 * The client's side of the account headshot: one status read (useMyHeadshot),
 * Home's compact task card while an update is outstanding, and the Account
 * section that always shows where it stands. The words are the standard JF
 * Effect account update request, the same whoever asked; never a name, never a
 * reason. Nothing here blocks the app: "Remind me later" is always there, and
 * the request clears itself once a new headshot is accepted.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { usePovFn } from "@/lib/client-pov-args";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { PREVIEW_ONLY_MESSAGE } from "@/lib/community";
import { HEADSHOT_COPY, HEADSHOT_STATUS_LABEL, type HeadshotStatus } from "@/lib/headshots/rules";
import { getMyHeadshot, snoozeMyHeadshot } from "@/lib/headshots/headshots.functions";

const HeadshotCapture = lazyWithRetry(() => import("@/components/headshots/headshot-capture").then((m) => ({ default: m.HeadshotCapture })));

export type MyHeadshotView = {
  applies: boolean;
  status: HeadshotStatus | null;
  outstanding: boolean;
  cardDue: boolean;
  copy: { title: string; body: string; action: string } | null;
  currentUrl: string | null;
  pending: { submittedAt: string; photoUrl: string | null } | null;
  preview: boolean;
};

export const MY_HEADSHOT_KEY = "my-headshot";

/** Where the signed-in client's (or, in View as client, the previewed client's) headshot stands. */
export function useMyHeadshot(enabled = true) {
  const fn = usePovFn(useServerFn(getMyHeadshot));
  const { client } = useClientImpersonation();
  return useQuery({
    queryKey: [MY_HEADSHOT_KEY, client?.id ?? "me"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => fn({ data: {} }) as Promise<MyHeadshotView>,
  });
}

/** The camera, opened from anywhere on the client's side. */
export function useHeadshotCamera() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const element = open ? (
    <HeadshotCapture
      open
      onOpenChange={setOpen}
      onDone={() => {
        void qc.invalidateQueries({ queryKey: [MY_HEADSHOT_KEY] });
        void qc.invalidateQueries({ queryKey: ["setup-banner-client"] });
        void qc.invalidateQueries({ queryKey: ["my-client-account"] });
        void qc.invalidateQueries({ queryKey: ["my-client"] });
      }}
    />
  ) : null;
  return {
    open: () => {
      if (isImpersonating) return void toast(PREVIEW_ONLY_MESSAGE);
      setOpen(true);
    },
    element,
  };
}

function useSnooze() {
  const fn = useServerFn(snoozeMyHeadshot);
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    snooze: async () => {
      if (isImpersonating) return void toast(PREVIEW_ONLY_MESSAGE);
      setBusy(true);
      // gone from Home at once; the server remembers it on every device
      qc.setQueriesData<MyHeadshotView>({ queryKey: [MY_HEADSHOT_KEY] }, (v) => (v ? { ...v, cardDue: false } : v));
      try {
        await fn();
      } catch {
        void qc.invalidateQueries({ queryKey: [MY_HEADSHOT_KEY] });
      } finally {
        setBusy(false);
      }
    },
  };
}

/**
 * Home's compact task: only while an update is outstanding and not snoozed. A
 * new client's first headshot is the setup checklist's step, so this stays out
 * of its way then.
 */
export function HeadshotTaskCard() {
  const { data } = useMyHeadshot();
  const camera = useHeadshotCamera();
  const { snooze, busy } = useSnooze();
  if (!data?.applies || !data.outstanding || !data.cardDue || !data.copy || data.status === "missing") return camera.element;
  return (
    <>
      <Card className="p-4" data-headshot-task>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground">
            <Camera className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-snug">{data.copy.title}</h2>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{data.copy.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="h-10 rounded-full px-4" onClick={camera.open} data-headshot-task-update>
                {data.copy.action}
              </Button>
              <Button size="sm" variant="ghost" className="h-10 rounded-full px-3 text-muted-foreground" onClick={() => void snooze()} disabled={busy} data-headshot-task-later>
                {HEADSHOT_COPY.later}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      {camera.element}
    </>
  );
}

/** The Account row's summary: amber only while something's needed. */
export function headshotSummary(v: MyHeadshotView | undefined): { text: string; warn?: boolean } | null {
  if (!v?.applies || !v.status) return null;
  if (v.outstanding) return { text: v.status === "missing" ? "Add your headshot" : "Update required", warn: true };
  if (v.status === "pending") return { text: "Waiting for review" };
  if (v.status === "verified") return { text: "Verified" };
  if (v.status === "previous") return { text: "On file" };
  return { text: "Not added" };
}

/** Account → Account headshot: the photo, where it stands, and the one thing to do. */
export function AccountHeadshotSection() {
  const { data, isPending } = useMyHeadshot();
  const camera = useHeadshotCamera();
  const { snooze, busy } = useSnooze();
  if (isPending) return <div className="h-24 animate-pulse rounded-xl bg-muted" />;
  if (!data?.applies) return null;
  const pending = data.pending;
  const shown = pending?.photoUrl ?? data.currentUrl;
  return (
    <div className="space-y-4" data-account-headshot data-headshot-status={data.status ?? undefined}>
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
          {shown ? <img src={shown} alt="Your account headshot" className="h-full w-full object-cover" /> : (
            <div className="grid h-full w-full place-items-center text-muted-foreground"><Camera className="h-6 w-6" /></div>
          )}
          {pending && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-semibold text-white">New</span>}
        </div>
        <div className="min-w-0">
          <div className={cn("text-[15px] font-semibold", data.outstanding && "text-warning")}>
            {data.outstanding && data.copy ? data.copy.title : data.status ? HEADSHOT_STATUS_LABEL[data.status] : ""}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            {data.outstanding && data.copy
              ? data.copy.body
              : pending
                ? `${HEADSHOT_COPY.pending} Your current photo stays until it's approved.`
                : "Private: only your coach and JF Effect admins see it. Your Crew picture is separate."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!pending && (
          <Button className="h-11 rounded-full" variant={data.outstanding ? "default" : "outline"} onClick={camera.open} data-account-headshot-update>
            <Camera className="mr-2 h-4 w-4" />
            {data.outstanding ? data.copy?.action ?? HEADSHOT_COPY.action : data.currentUrl ? "Take a new headshot" : HEADSHOT_COPY.addAction}
          </Button>
        )}
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"><Clock className="h-4 w-4" /> Submitted. No need to do anything else.</span>
        )}
        {data.outstanding && data.cardDue && data.status !== "missing" && (
          <Button variant="ghost" className="h-11 rounded-full text-muted-foreground" onClick={() => void snooze()} disabled={busy} data-account-headshot-later>
            {HEADSHOT_COPY.later}
          </Button>
        )}
      </div>
      <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Taken live with your camera. Face checks run on your phone and nothing about your face is kept but the photo. Frames from the capture are deleted within 30 days.
      </p>
      {camera.element}
    </div>
  );
}
