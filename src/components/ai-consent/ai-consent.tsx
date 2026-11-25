/**
 * Asking for, and changing, permission to send someone's data to outside AI
 * services (rules and words in src/lib/ai-consent/consent.ts; the server
 * enforces it in consent.server.ts).
 *
 * - `AiConsentPrompt`: asked once per app open until answered (portal layout).
 * - `AiConsentHost` + `withAiConsent(call)`: a feature that the server refused
 *   for want of permission opens the sheet; Allow runs the call again.
 * - `AiConsentPanel`: Account → Privacy & data, where it's withdrawn or given.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AI_CONSENT_COPY,
  AI_CONSENT_VERSION,
  AI_PROVIDERS,
  aiConsentNeedsAsking,
  aiConsentState,
  consentErrorWords,
  isAiConsentError,
  type AiConsentRow,
} from "@/lib/ai-consent/consent";

const consentKey = (userId: string | null | undefined) => ["ai-consent", userId ?? null] as const;

function useMyAiConsent() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: consentKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AiConsentRow> => {
      const { data, error } = await (supabase as any)
        .from("ai_data_consents")
        .select("granted, text_version, decided_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AiConsentRow;
    },
  });
  const set = async (granted: boolean) => {
    const { data, error } = await (supabase as any).rpc("ai_consent_set", { _granted: granted, _version: AI_CONSENT_VERSION });
    if (error) throw new Error(error.message);
    qc.setQueryData(consentKey(userId), { granted, text_version: AI_CONSENT_VERSION, decided_at: data?.decided_at ?? new Date().toISOString() });
  };
  return { userId, row: q.data, loaded: q.isSuccess, set };
}

function ConsentWords() {
  return (
    <div className="space-y-3 text-[14px] leading-snug text-muted-foreground">
      <p>{AI_CONSENT_COPY.intro}</p>
      <ul className="space-y-2" data-ai-consent-providers>
        {AI_PROVIDERS.map((p) => (
          <li key={p.name} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="text-[14px] font-semibold text-foreground">{p.name}</div>
            <div className="text-[13px]">{p.uses}</div>
          </li>
        ))}
      </ul>
      <p>{AI_CONSENT_COPY.shared} {AI_CONSENT_COPY.abroad}</p>
      <p>{AI_CONSENT_COPY.ifNot}</p>
      <p>{AI_CONSENT_COPY.change}</p>
    </div>
  );
}

/** The question itself. `onDecided(true)` after Allow is saved, `(false)` after Don't allow; closing decides nothing. */
export function AiConsentSheet({ open, onOpenChange, onDecided }: { open: boolean; onOpenChange: (o: boolean) => void; onDecided?: (granted: boolean) => void }) {
  const { set } = useMyAiConsent();
  const [saving, setSaving] = useState<boolean | null>(null);
  const answer = async (granted: boolean) => {
    if (saving !== null) return;
    setSaving(granted);
    try {
      await set(granted);
      onOpenChange(false);
      onDecided?.(granted);
      toast.success(granted ? "Allowed. You can change it in Account → Privacy & data." : "Not allowed. Those features stay off; change it any time in Account → Privacy & data.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (saving === null) onOpenChange(o); }}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-5 pt-6" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }} data-ai-consent-sheet>
        <div className="mx-auto w-full max-w-md">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </div>
          <SheetTitle className="text-lg font-bold">{AI_CONSENT_COPY.title}</SheetTitle>
          <SheetDescription className="sr-only">{AI_CONSENT_COPY.intro}</SheetDescription>
          <div className="mt-2">
            <ConsentWords />
          </div>
          <div className="mt-5 space-y-2">
            <Button type="button" className="h-12 w-full text-[16px]" disabled={saving !== null} onClick={() => void answer(true)} data-ai-consent-allow>
              {saving === true && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {AI_CONSENT_COPY.allow}
            </Button>
            <Button type="button" variant="outline" className="h-12 w-full text-[16px]" disabled={saving !== null} onClick={() => void answer(false)} data-ai-consent-decline>
              {saving === false && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {AI_CONSENT_COPY.decline}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- asking when a feature needs it ---------- */

type Waiter = (granted: boolean) => void;
let openHost: ((resolve: Waiter) => void) | null = null;

/** Opens the sheet (when the host is mounted) and resolves with the answer; false when closed or unavailable. */
export function requestAiConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!openHost) return resolve(false);
    openHost(resolve);
  });
}

/**
 * Runs a server call; if the server refused it for want of permission, asks,
 * and on Allow runs it once more. Otherwise the refusal comes back as a plain
 * error ("Allow AI processing in Account → Privacy & data…") for the caller's toast.
 */
export async function withAiConsent<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!isAiConsentError(e)) throw e;
    if (await requestAiConsent()) return call();
    throw new Error(consentErrorWords(e));
  }
}

/** A server function that asks for permission when the server needs it (stable while `fn` is). */
export function useAiConsentAware<F extends (...args: any[]) => Promise<any>>(fn: F): F {
  return useMemo(() => ((...args: any[]) => withAiConsent(() => fn(...args))) as F, [fn]);
}

export function AiConsentHost() {
  const [waiter, setWaiter] = useState<Waiter | null>(null);
  useEffect(() => {
    openHost = (resolve) => setWaiter(() => resolve);
    return () => {
      openHost = null;
    };
  }, []);
  const settle = (granted: boolean) => {
    waiter?.(granted);
    setWaiter(null);
  };
  if (!waiter) return null;
  return <AiConsentSheet open onOpenChange={(o) => { if (!o) settle(false); }} onDecided={(g) => settle(g)} />;
}

/* ---------- asked on open until answered ---------- */

const SESSION_KEY = (uid: string) => `jf:ai-consent-asked:${uid}`;

function uiIsClear() {
  return !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]');
}

/** A client or member with no answer to the current wording is asked once per app open (never staff, never in "View as client"). */
export function AiConsentPrompt() {
  const { role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const { userId, row, loaded } = useMyAiConsent();
  const [open, setOpen] = useState(false);
  const eligible = !!userId && (role === "client" || role === "member") && !isImpersonating;
  const needs = eligible && loaded && aiConsentNeedsAsking(row);

  useEffect(() => {
    if (!needs || open || !userId) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY(userId))) return;
    } catch {
      /* storage unavailable */
    }
    // after the app settles and any other popup (setup, agreements, units) has closed
    let stopped = false;
    let timer = 0;
    const tick = () => {
      if (stopped) return;
      if (uiIsClear()) {
        try {
          sessionStorage.setItem(SESSION_KEY(userId), "1");
        } catch {
          /* storage unavailable */
        }
        setOpen(true);
        return;
      }
      timer = window.setTimeout(tick, 1500);
    };
    timer = window.setTimeout(tick, 4000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [needs, open, userId]);

  if (!open) return null;
  return <AiConsentSheet open={open} onOpenChange={setOpen} />;
}

/* ---------- Account → Privacy & data ---------- */

export function AiConsentPanel() {
  const { row, loaded, set } = useMyAiConsent();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = aiConsentState(row);
  const withdraw = async () => {
    setBusy(true);
    try {
      await set(false);
      toast.success("Withdrawn. Nothing more is sent to AI services; those features are off for you.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const status =
    state === "granted"
      ? `Allowed${row?.decided_at ? ` on ${new Date(row.decided_at).toLocaleDateString()}` : ""}.`
      : state === "declined"
        ? "Not allowed. Features that need it are off."
        : state === "outdated"
          ? "What's shared has changed since you answered. Review it to keep using those features."
          : "Not answered yet. Nothing is sent until you allow it.";
  return (
    <div className="space-y-3" id="ai-processing" data-ai-consent-panel={state}>
      <div className="text-[15px] font-medium">AI processing</div>
      <p className="text-sm text-muted-foreground">
        Some features send your data to {AI_PROVIDERS.map((p) => p.name).join(" and ")} to work. {loaded ? status : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-10" onClick={() => setSheet(true)} data-ai-consent-review>
          {state === "granted" ? "What's shared" : "Review and allow"}
        </Button>
        {state === "granted" && (
          <Button variant="outline" className="h-10" disabled={busy} onClick={() => void withdraw()} data-ai-consent-withdraw>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Withdraw
          </Button>
        )}
      </div>
      {sheet && <AiConsentSheet open={sheet} onOpenChange={setSheet} />}
    </div>
  );
}
