/**
 * Permission to send someone's data to outside AI services (rules and words in
 * src/lib/ai-consent/consent.ts; the server enforces it in consent.server.ts).
 * Never a popup, and never part of agreeing to anything else:
 *
 * - `AiConsentCheckbox`: an optional box, unticked, beside the Terms and
 *   Privacy Policy when an account is made (/activate), never in the Coaching
 *   Agreement. `recordAiConsentChoice` saves
 *   what it says once the agreement went through (`checkboxDecision`).
 * - `AiConsentInline`: someone with no answer yet meets one small request,
 *   in place, where a feature is about to send data (Allow / Don't allow, so
 *   it's asked once); someone who said no sees a quiet "off" line with Turn on.
 *   `AiConsentGate` puts it in place of an action; `useAiConsentInline(fn)`
 *   shows it beside an action the server refused, and Allow runs it again.
 * - `AiConsentOnce`: the same request inside a flow that doesn't need it to
 *   work (the weekly check-in, which a coach's drafting reads), shown once
 *   per person (server-side seen), never blocking anything.
 * - `AiConsentPanel`: Account → Privacy & data, the full disclosure, where
 *   it's given, declined or withdrawn.
 *
 * Only a tick or a tap on Allow saves a yes. Staff and "View as client" are
 * never asked (`askable`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { hasSeenFeature, markFeatureSeen } from "@/lib/feature-seen";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  AI_CONSENT_COPY,
  AI_CONSENT_ONCE_KEY,
  AI_CONSENT_VERSION,
  AI_PROVIDERS,
  aiConsentNeedsAsking,
  aiConsentState,
  checkboxDecision,
  consentErrorWords,
  isAiConsentError,
  type AiConsentRow,
} from "@/lib/ai-consent/consent";

const consentKey = (userId: string | null | undefined) => ["ai-consent", userId ?? null] as const;

/** Fired when the server refused a call for want of permission: every reader looks again. */
const REFUSED_EVENT = "jf:ai-consent-refused";

/** Saves an answer for the signed-in person (their own session; the database stamps who and when). */
export async function saveAiConsent(granted: boolean): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("ai_consent_set", { _granted: granted, _version: AI_CONSENT_VERSION });
  if (error) throw new Error(error.message);
  return (data?.decided_at as string | undefined) ?? null;
}

export function useMyAiConsent() {
  const { user, role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
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
  useEffect(() => {
    if (!userId) return;
    const again = () => void qc.invalidateQueries({ queryKey: consentKey(userId) });
    window.addEventListener(REFUSED_EVENT, again);
    return () => window.removeEventListener(REFUSED_EVENT, again);
  }, [qc, userId]);
  const set = useCallback(
    async (granted: boolean) => {
      const decided = await saveAiConsent(granted);
      qc.setQueryData(consentKey(userId), { granted, text_version: AI_CONSENT_VERSION, decided_at: decided ?? new Date().toISOString() });
    },
    [qc, userId],
  );
  // Only a client or member is ever asked: staff always pass on the server, and a
  // coach in "View as client" works as themselves.
  const askable = !!userId && (role === "client" || role === "member") && !isImpersonating;
  const state = aiConsentState(q.data);
  return {
    userId,
    row: q.data,
    loaded: q.isSuccess,
    state,
    askable,
    /** This person has to say yes before their data can go to an AI service. */
    needsYes: askable && q.isSuccess && state !== "granted",
    /** No answer to the current wording yet. */
    unanswered: askable && q.isSuccess && aiConsentNeedsAsking(q.data),
    set,
  };
}

/** The full disclosure: who gets what, where, and what happens without it. */
export function AiConsentDetails({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5 text-[13px] leading-snug text-muted-foreground", className)} data-ai-consent-details>
      <p>{AI_CONSENT_COPY.intro}</p>
      <ul className="space-y-2" data-ai-consent-providers>
        {AI_PROVIDERS.map((p) => (
          <li key={p.name}>
            <span className="font-medium text-foreground">{p.name}</span>: {p.uses}.
          </li>
        ))}
      </ul>
      <p>
        {AI_CONSENT_COPY.shared} {AI_CONSENT_COPY.abroad}
      </p>
      <p>{AI_CONSENT_COPY.ifNot}</p>
      <p>{AI_CONSENT_COPY.change}</p>
    </div>
  );
}

function MoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:underline"
      aria-expanded={open}
      onClick={onToggle}
      data-ai-consent-more
    >
      {open ? "Less" : "What's shared"}
      <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

/* ---------- the optional box in an agreement flow ---------- */

/**
 * The optional, unticked box beside the signup Terms. Controlled;
 * agreeing to the rest never depends on it.
 */
export function AiConsentCheckbox({
  checked,
  onChange,
  id = "ai-consent-box",
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex items-start gap-3", className)} data-ai-consent-checkbox>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5 h-5 w-5 shrink-0"
        aria-describedby={`${id}-text`}
      />
      <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
        <label htmlFor={id} id={`${id}-text`}>
          <span className="font-medium text-foreground">{AI_CONSENT_COPY.checkboxLead}</span> {AI_CONSENT_COPY.checkboxBody}{" "}
          {AI_CONSENT_COPY.checkboxNote}
        </label>
        <div>
          <MoreToggle open={open} onToggle={() => setOpen((o) => !o)} />
        </div>
        {open && <AiConsentDetails className="mt-2" />}
      </div>
    </div>
  );
}

/**
 * Saves what the box said once the agreement it sits beside went through:
 * ticked is a yes; unticked is a no only when there was no answer yet (so the
 * person isn't asked again); never over an existing answer. Best effort: a
 * failure leaves them unanswered, and they're asked once in place later.
 */
export async function recordAiConsentChoice(checked: boolean, row: AiConsentRow = null): Promise<void> {
  const decision = checkboxDecision(checked, row);
  if (decision === null) return;
  try {
    await saveAiConsent(decision);
  } catch (e) {
    console.warn("[ai-consent] couldn't save the box", e);
  }
}

/* ---------- in place, where a feature needs it ---------- */

/**
 * The small in-place card a feature shows before it sends anything. With no
 * answer yet it's the one request (Allow / Don't allow: either is saved, so
 * it's asked once). After a no it's a quiet line with Turn on.
 */
export function AiConsentInline({
  use,
  via = AI_PROVIDERS[0].name,
  onAllowed,
  onNo,
  className,
}: {
  use?: string;
  /** Who receives it, as the person reads it ("OpenAI", "OpenAI or Google"). */
  via?: string;
  onAllowed?: () => void;
  /** Don't allow (saved), or Not now after a no (nothing saved). */
  onNo?: () => void;
  className?: string;
}) {
  const { state, set } = useMyAiConsent();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<boolean | null>(null);
  const answer = async (granted: boolean) => {
    if (saving !== null) return;
    setSaving(granted);
    try {
      await set(granted);
      if (granted) onAllowed?.();
      else onNo?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  };
  const declined = state === "declined";

  // after a no: a state, never a request; Turn on opens the full disclosure with Allow
  if (declined && !open) {
    return (
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5", className)} data-ai-consent-off role="group" aria-label="AI processing">
        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">{AI_CONSENT_COPY.off}</p>
        <button type="button" className="shrink-0 text-[13px] font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setOpen(true)} data-ai-consent-turn-on>
          Turn on
        </button>
        {onNo && (
          <button type="button" className="shrink-0 text-[13px] text-muted-foreground" onClick={onNo} data-ai-consent-dismiss>
            Not now
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-border bg-muted/40 p-3", className)} data-ai-consent-inline role="group" aria-label="AI processing">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <p className="text-foreground">
            {use ? `This ${use} using ${via}.` : `This uses ${via}.`} Only if you allow it; it may be processed outside Canada.
          </p>
          {!declined && <MoreToggle open={open} onToggle={() => setOpen((o) => !o)} />}
          {open && <AiConsentDetails className="mt-2" />}
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Button type="button" size="sm" variant="secondary" className="h-9 flex-1 text-[13px]" disabled={saving !== null} onClick={() => void answer(true)} data-ai-consent-allow>
          {saving === true && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {AI_CONSENT_COPY.allow}
        </Button>
        {declined ? (
          <Button type="button" size="sm" variant="ghost" className="h-9 flex-1 text-[13px] text-muted-foreground" disabled={saving !== null} onClick={() => setOpen(false)} data-ai-consent-dismiss>
            Keep it off
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" className="h-9 flex-1 text-[13px] text-muted-foreground" disabled={saving !== null} onClick={() => void answer(false)} data-ai-consent-decline>
            {saving === false && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {AI_CONSENT_COPY.decline}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A feature that always sends data (a meal estimate): its action shows once
 * the person has allowed it, the in-place card until then. Staff, "View as
 * client" and an answer still loading see the action (the server decides).
 */
export function AiConsentGate({ use, via, children, className }: { use?: string; via?: string; children: ReactNode; className?: string }) {
  const { needsYes } = useMyAiConsent();
  if (!needsYes) return <>{children}</>;
  return <AiConsentInline use={use} via={via} className={className} />;
}

/* ---------- a call the server refused ---------- */

function announceRefusal() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFUSED_EVENT));
}

/**
 * Runs a server call; if the server refused it for want of permission, every
 * consent reader looks again (so a gate in view shows its card) and the
 * refusal comes back as a plain error for the caller's message.
 */
export async function withAiConsent<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!isAiConsentError(e)) throw e;
    announceRefusal();
    throw new Error(consentErrorWords(e));
  }
}

/** A server function that turns a consent refusal into a plain error (stable while `fn` is). */
export function useAiConsentAware<F extends (...args: any[]) => Promise<any>>(fn: F): F {
  return useMemo(() => ((...args: any[]) => withAiConsent(() => fn(...args))) as F, [fn]);
}

/** The person said no (or Not now) in place: nothing was sent, nothing to report. */
export class AiConsentDismissed extends Error {
  readonly aiConsentDismissed = true;
}

export function isAiConsentDismissed(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { aiConsentDismissed?: boolean }).aiConsentDismissed === true;
}

/**
 * A server function that, when the server refuses it for want of permission,
 * shows the in-place card (the returned node, placed beside the action) and
 * waits: Allow runs the call again and carries on as if nothing happened;
 * Don't allow / Not now ends it with `AiConsentDismissed` (nothing sent; callers say nothing).
 */
export function useAiConsentInline<F extends (...args: any[]) => Promise<any>>(fn: F, use?: string): [F, ReactNode] {
  const [asking, setAsking] = useState(false);
  const waiter = useRef<((granted: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      waiter.current?.(false);
      waiter.current = null;
    },
    [],
  );
  const settle = (granted: boolean) => {
    const w = waiter.current;
    waiter.current = null;
    setAsking(false);
    w?.(granted);
  };
  const wrapped = useMemo(
    () =>
      (async (...args: any[]) => {
        try {
          return await fn(...args);
        } catch (e) {
          if (!isAiConsentError(e)) throw e;
          announceRefusal();
          waiter.current?.(false);
          const granted = await new Promise<boolean>((resolve) => {
            waiter.current = resolve;
            setAsking(true);
          });
          if (granted) return fn(...args);
          throw new AiConsentDismissed("Nothing was sent.");
        }
      }) as F,
    [fn],
  );
  const node = asking ? <AiConsentInline use={use} className="mt-3" onAllowed={() => settle(true)} onNo={() => settle(false)} /> : null;
  return [wrapped, node];
}

/* ---------- once, inside a flow that works without it ---------- */

/**
 * The one request inside a flow that doesn't need AI to work (the weekly
 * check-in, which a coach's drafting reads). Shown to someone with no answer,
 * once per person (server-side seen, so never again on any device), and it
 * never blocks the flow.
 */
export function AiConsentOnce({ use, className }: { use: string; className?: string }) {
  const { userId, unanswered } = useMyAiConsent();
  const [shownHere, setShownHere] = useState(false);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const seen = useQuery({
    queryKey: ["feature-seen", userId, AI_CONSENT_ONCE_KEY],
    enabled: !!userId && unanswered && !shownHere,
    staleTime: Infinity,
    queryFn: () => hasSeenFeature(userId!, AI_CONSENT_ONCE_KEY),
  });
  const show = shownHere || (unanswered && seen.data === false);
  useEffect(() => {
    if (!show || shownHere || !userId) return;
    setShownHere(true);
    void markFeatureSeen(userId, AI_CONSENT_ONCE_KEY);
  }, [show, shownHere, userId]);
  if (answered !== null) {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)} data-ai-consent-once-saved>
        {answered ? "AI processing allowed." : "AI processing stays off."} {AI_CONSENT_COPY.change}
      </p>
    );
  }
  if (!show) return null;
  return <AiConsentInline use={use} className={className} onAllowed={() => setAnswered(true)} onNo={() => setAnswered(false)} />;
}

/* ---------- Account → Privacy & data ---------- */

export function AiConsentPanel() {
  const { row, loaded, state, set } = useMyAiConsent();
  const [busy, setBusy] = useState<boolean | null>(null);
  const choose = async (granted: boolean) => {
    if (busy !== null) return;
    setBusy(granted);
    try {
      await set(granted);
      toast.success(granted ? "AI processing allowed" : "AI processing off");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const status =
    state === "granted"
      ? `Allowed${row?.decided_at ? ` on ${new Date(row.decided_at).toLocaleDateString()}` : ""}.`
      : state === "declined"
        ? "Off. Features that need it aren't available."
        : state === "outdated"
          ? "What's shared has changed since you answered. Review it to keep using those features."
          : "Not answered yet. Nothing is sent until you allow it.";
  return (
    <div className="space-y-3" id="ai-processing" data-ai-consent-panel={state}>
      <div className="text-[15px] font-medium">AI processing</div>
      {loaded && <p className="text-sm text-foreground">{status}</p>}
      <AiConsentDetails />
      <div className="flex flex-wrap gap-2">
        {state !== "granted" && (
          <Button variant="outline" className="h-10" disabled={busy !== null} onClick={() => void choose(true)} data-ai-consent-allow>
            {busy === true && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {AI_CONSENT_COPY.allow}
          </Button>
        )}
        {state === "granted" ? (
          <Button variant="outline" className="h-10" disabled={busy !== null} onClick={() => void choose(false)} data-ai-consent-withdraw>
            {busy === false && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Withdraw
          </Button>
        ) : (
          state !== "declined" && (
            <Button variant="outline" className="h-10" disabled={busy !== null} onClick={() => void choose(false)} data-ai-consent-decline>
              {busy === false && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {AI_CONSENT_COPY.decline}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
