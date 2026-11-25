/**
 * Asking for, and changing, permission to send someone's data to outside AI
 * services (rules and words in src/lib/ai-consent/consent.ts; the server
 * enforces it in consent.server.ts). Never a popup on its own:
 *
 * - `AiConsentChoice`: the compact question inside onboarding (the member
 *   setup wizard's last step, the coaching setup checklist), shown only while
 *   it's unanswered; skipping it decides nothing.
 * - `AiConsentInline` / `AiConsentGate`: a small card in place, right where a
 *   feature that sends data is about to run, for someone who hasn't allowed it.
 * - `useAiConsentInline(fn)`: a server call the server refused for want of
 *   permission puts that card beside the action; Allow runs the call again.
 * - `AiConsentPanel`: Account → Privacy & data, the full disclosure, where it's
 *   given, declined or withdrawn.
 *
 * Nothing here grants anything by itself: only a tap on Allow saves a yes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AI_CONSENT_COPY,
  AI_CONSENT_VERSION,
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  aiConsentNeedsAsking,
  aiConsentState,
  consentErrorWords,
  isAiConsentError,
  type AiConsentRow,
} from "@/lib/ai-consent/consent";

const consentKey = (userId: string | null | undefined) => ["ai-consent", userId ?? null] as const;

/** Fired when the server refused a call for want of permission: every reader looks again. */
const REFUSED_EVENT = "jf:ai-consent-refused";

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
      const { data, error } = await (supabase as any).rpc("ai_consent_set", { _granted: granted, _version: AI_CONSENT_VERSION });
      if (error) throw new Error(error.message);
      qc.setQueryData(consentKey(userId), { granted, text_version: AI_CONSENT_VERSION, decided_at: data?.decided_at ?? new Date().toISOString() });
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
    /** No answer to the current wording yet (onboarding asks only then). */
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

function useAnswer(onDecided?: (granted: boolean) => void) {
  const { set } = useMyAiConsent();
  const [saving, setSaving] = useState<boolean | null>(null);
  const answer = async (granted: boolean) => {
    if (saving !== null) return;
    setSaving(granted);
    try {
      await set(granted);
      onDecided?.(granted);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  };
  return { saving, answer };
}

/**
 * The small in-place request a feature shows before it sends anything.
 * `use` says what this feature does with it, in a few words ("estimates the
 * meal you describe"). Allow saves a yes and calls `onAllowed`; Not now
 * decides nothing and calls `onDismiss`.
 */
export function AiConsentInline({
  use,
  via = AI_PROVIDERS[0].name,
  onAllowed,
  onDismiss,
  className,
}: {
  use?: string;
  /** Who receives it, as the person reads it ("OpenAI", "OpenAI or Google"). */
  via?: string;
  onAllowed?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { saving, answer } = useAnswer((g) => {
    if (g) onAllowed?.();
  });
  return (
    <div className={cn("rounded-xl border border-border bg-muted/40 p-3", className)} data-ai-consent-inline role="group" aria-label="AI processing">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <p className="text-foreground">
            {use ? `This ${use} using ${via}.` : `This uses ${via}.`} Only what this needs is sent, and only if you allow it.
          </p>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-ai-consent-more
          >
            {open ? "Less" : "What's shared"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && <AiConsentDetails className="mt-2" />}
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Button type="button" size="sm" variant="secondary" className="h-9 flex-1 text-[13px]" disabled={saving !== null} onClick={() => void answer(true)} data-ai-consent-allow>
          {saving === true && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Allow
        </Button>
        {onDismiss && (
          <Button type="button" size="sm" variant="ghost" className="h-9 flex-1 text-[13px] text-muted-foreground" disabled={saving !== null} onClick={onDismiss} data-ai-consent-dismiss>
            Not now
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A feature that always sends data (a meal estimate): its action shows once
 * the person has allowed it, the inline request until then. Staff, "View as
 * client" and an answer still loading see the action (the server decides).
 */
export function AiConsentGate({ use, children, className }: { use?: string; children: ReactNode; className?: string }) {
  const { needsYes } = useMyAiConsent();
  if (!needsYes) return <>{children}</>;
  return <AiConsentInline use={use} className={className} />;
}

/* ---------- a call the server refused ---------- */

function announceRefusal() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFUSED_EVENT));
}

/**
 * Runs a server call; if the server refused it for want of permission, every
 * consent reader looks again (so a gate in view shows its request) and the
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

/** The person tapped Not now on the inline request: nothing was sent, nothing to report. */
export class AiConsentDismissed extends Error {
  readonly aiConsentDismissed = true;
}

export function isAiConsentDismissed(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { aiConsentDismissed?: boolean }).aiConsentDismissed === true;
}

/**
 * A server function that, when the server refuses it for want of permission,
 * shows the inline request (the returned node, placed beside the action) and
 * waits: Allow runs the call again and carries on as if nothing happened; Not
 * now ends it with `AiConsentDismissed` (nothing sent; callers say nothing).
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
          throw new AiConsentDismissed("Nothing was sent. Allow AI processing to use this, or change it any time in Account → Privacy & data.");
        }
      }) as F,
    [fn],
  );
  const node = asking ? <AiConsentInline use={use} className="mt-3" onAllowed={() => settle(true)} onDismiss={() => settle(false)} /> : null;
  return [wrapped, node];
}

/* ---------- onboarding ---------- */

/**
 * The question inside an onboarding flow, compact. Shown only while there's no
 * answer to the current wording; a choice is saved the moment it's tapped and
 * the card then says what was chosen. Not answering decides nothing.
 */
export function AiConsentChoice({ className }: { className?: string }) {
  const { unanswered, askable, state } = useMyAiConsent();
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const { saving, answer } = useAnswer((g) => setAnswered(g));
  // stays mounted with its result once answered here; otherwise only while unanswered
  if (!askable || (answered === null && !unanswered)) return null;
  const choice = answered ?? (state === "granted" ? true : state === "declined" ? false : null);
  return (
    <div className={cn("rounded-xl border border-border p-3", className)} data-ai-consent-choice>
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">AI features</div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Some features (meal estimates, imports, your coach's drafts) send what they need to {AI_PROVIDER_NAMES}. Nothing is sent unless you allow it.
          </p>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-ai-consent-more
          >
            {open ? "Less" : "What's shared"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && <AiConsentDetails className="mt-2" />}
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Allow AI processing">
        {[
          { v: true, label: AI_CONSENT_COPY.allow, attr: { "data-ai-consent-allow": "" } },
          { v: false, label: AI_CONSENT_COPY.decline, attr: { "data-ai-consent-decline": "" } },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={choice === o.v}
            disabled={saving !== null}
            onClick={() => void answer(o.v)}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-lg border text-[13px] font-medium transition",
              choice === o.v ? "border-foreground bg-secondary text-foreground" : "border-border hover:bg-secondary",
            )}
            {...o.attr}
          >
            {saving === o.v && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
      {choice !== null && <p className="mt-2 text-[12px] text-muted-foreground">{AI_CONSENT_COPY.change}</p>}
    </div>
  );
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
        ? "Not allowed. Features that need it are off."
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
