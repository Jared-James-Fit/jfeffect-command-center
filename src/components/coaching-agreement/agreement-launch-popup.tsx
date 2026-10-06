import { useEffect, useRef, useState } from "react";
import { FileSignature, ShieldCheck, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { isPopupDismissed } from "@/lib/coaching-agreement/rules";
import { useCoachingAgreement } from "./agreement-context";
import { agreementPrompt } from "./agreement-copy";

/**
 * Mandatory-but-dismissible "Sign your Coaching Agreement" popup.
 *
 * It appears once each time the app is opened, on whatever page the client lands on,
 * until they sign. "Not now" hides it for the rest of this app session, however far they
 * navigate; closing and reopening the app (or coming back after it sat in the background
 * for 10+ minutes) brings it back. It waits for any other open popup to close first so two
 * sheets never stack, but it is never tied to a particular page.
 *
 * The dismissal lives in sessionStorage on purpose: it must reset when the app is
 * relaunched. The signature itself is always recorded server-side.
 */
const SESSION_KEY = (uid: string) => `coaching-agreement:launch-dismissed:${uid}`;

// Module-level guard against duplicate instances across remounts.
let activeFor: string | null = null;

function uiIsClear() {
  return !document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]',
  );
}

function readDismissedAt(uid: string): number | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(uid));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Date.now();
  } catch {
    return null;
  }
}

function writeDismissed(uid: string) {
  try {
    sessionStorage.setItem(SESSION_KEY(uid), String(Date.now()));
  } catch {
    /* private mode: popup will simply reappear on next route change */
  }
}

function clearDismissed(uid: string) {
  try {
    sessionStorage.removeItem(SESSION_KEY(uid));
  } catch {
    /* ignore */
  }
}

export function AgreementLaunchPopup({ flowOpen }: { flowOpen: boolean }) {
  const { user } = useAuth();
  const { state, needsSignature, openSignFlow } = useCoachingAgreement();
  const [open, setOpen] = useState(false);
  const [resumeTick, setResumeTick] = useState(0);
  const hiddenSince = useRef<number | null>(null);

  const uid = user?.id ?? "";
  const eligible = !!uid && needsSignature && !flowOpen;

  // Coming back after the app sat in the background counts as reopening it.
  useEffect(() => {
    if (!uid) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const dismissedAt = readDismissedAt(uid);
      if (
        dismissedAt !== null &&
        !isPopupDismissed({ dismissedAt, hiddenSince: hiddenSince.current, now: Date.now() })
      ) {
        clearDismissed(uid);
        setResumeTick((t) => t + 1);
      }
      hiddenSince.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [uid]);

  // Opening the signing flow by any route counts as engaging with it this session.
  useEffect(() => {
    if (flowOpen && uid) writeDismissed(uid);
  }, [flowOpen, uid]);

  // Show once things have settled and no other popup is open.
  useEffect(() => {
    if (!eligible || open) return;
    if (readDismissedAt(uid) !== null) return;
    if (activeFor === uid) return;

    let stopped = false;
    let timer = 0;
    const tick = () => {
      if (stopped) return;
      if (uiIsClear() && activeFor !== uid && readDismissedAt(uid) === null) {
        activeFor = uid;
        setOpen(true);
        return;
      }
      timer = window.setTimeout(tick, 1200);
    };
    timer = window.setTimeout(tick, 2500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [eligible, open, uid, resumeTick]);

  // Close as soon as it no longer applies (signed on another screen, or the flow opened).
  useEffect(() => {
    if (open && !eligible) {
      setOpen(false);
      if (activeFor === uid) activeFor = null;
    }
  }, [open, eligible, uid]);

  useEffect(
    () => () => {
      if (activeFor === uid) activeFor = null;
    },
    [uid],
  );

  const dismiss = () => {
    if (uid) writeDismissed(uid);
    if (activeFor === uid) activeFor = null;
    setOpen(false);
  };

  if (!open) return null;
  const prompt = agreementPrompt(state);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && dismiss()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="rounded-t-3xl px-5 pt-6"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-md">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileSignature className="h-7 w-7" />
          </div>
          <SheetTitle className="text-xl font-black tracking-tight">{prompt.title}</SheetTitle>
          <SheetDescription className="mt-1.5 text-[15px] leading-snug">
            {prompt.body}
          </SheetDescription>

          {prompt.note && (
            <blockquote className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {prompt.note}
            </blockquote>
          )}

          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 shrink-0 text-primary" />
              Takes about 2 minutes on your phone
            </li>
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              One signature covers everything you buy, now and later
            </li>
          </ul>

          <div className="mt-5 space-y-2">
            <Button
              type="button"
              className="h-12 w-full text-base font-semibold"
              onClick={() => {
                setOpen(false);
                openSignFlow();
              }}
            >
              Review &amp; sign
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full text-muted-foreground"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
