import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Loader2, MessageSquareText, ScanFace, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CodeInput } from "@/components/two-step/code-input";
import { TotpSetup } from "@/components/two-step/totp-setup";
import {
  confirmTwoStepTotp,
  finishTwoStepPasskey,
  sendTwoStepCode,
  startTwoStepPasskey,
  verifyTwoStepCode,
  type ConfirmResult,
} from "@/lib/two-step.functions";
import { firstAuthenticatorId, mfaErrorMessage, verifyTotp } from "@/lib/mfa";
import { KIND_BLURB, maskPhone, twoStepPhone, TRUST_DAYS, type TwoStepKind } from "@/lib/two-step";
import {
  deviceNameHere,
  listenForSmsCode,
  passkeyErrorText,
  passkeyLabelHere,
  passkeyTitleHere,
  passkeyWordHere,
  platformPasskeyReady,
  type TrustToken,
} from "@/lib/two-step-client";
import { createPasskey, getPasskey } from "@/lib/webauthn-browser";
import type { CreationOptionsJSON, RequestOptionsJSON } from "@/lib/webauthn";

/** What every way of confirming hands back: the device's trust token when it was ticked. */
export type Confirmed = { trust: TrustToken | null; added?: TwoStepKind };

const trustArg = (trust: boolean) => (trust ? { label: deviceNameHere() } : null);

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-destructive" data-two-step-error>
      {text}
    </p>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <>
      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {label}
    </>
  );
}

/** "Don't ask again on this device for 30 days." */
export function TrustToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-start gap-2.5 text-sm" data-two-step-trust>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        Don't ask again on this device for {TRUST_DAYS} days
        <span className="block text-xs text-muted-foreground">
          Leave this off on a shared computer.
        </span>
      </span>
    </label>
  );
}

// ── A texted code ───────────────────────────────────────────────────────────
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Text a code and type it in. "Text me a code" first (a tap, so opening the
 * screen never spends a text) unless `autoSend`; then six boxes the phone
 * fills in itself (an iPhone suggests it above the keyboard; Android reads it
 * in), a resend after 30 seconds, and the code's 10 minutes.
 */
export function SmsCodeStep({
  purpose,
  methodId,
  phone,
  to,
  autoSend,
  trust,
  onConfirmed,
}: {
  purpose: "sign_in" | "add_phone";
  methodId?: string | null;
  phone?: string | null;
  /** The masked number, before a code is sent. */
  to?: string | null;
  autoSend?: boolean;
  trust: boolean;
  onConfirmed: (c: Confirmed) => void | Promise<void>;
}) {
  const send = useServerFn(sendTwoStepCode);
  const verify = useServerFn(verifyTwoStepCode);
  const [sent, setSent] = useState<{ to: string; resendAt: number; expiresAt: number } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sentOnce = useRef(false);

  const doSend = useCallback(async () => {
    setBusy("send");
    setError(null);
    try {
      const r = await send({ data: { purpose, methodId: methodId ?? null, phone: phone ?? null } });
      if (r.ok) {
        const t = Date.now();
        setSent({ to: r.to, resendAt: t + r.resendInS * 1000, expiresAt: t + r.expiresInS * 1000 });
        setCode("");
      } else {
        setError(r.message);
        if (r.reason === "cooldown" && r.waitS)
          setSent((s) => (s ? { ...s, resendAt: Date.now() + r.waitS! * 1000 } : s));
      }
    } catch (e: any) {
      setError(e?.message ?? "The text didn't go. Try again.");
    } finally {
      setBusy(null);
    }
  }, [send, purpose, methodId, phone]);

  useEffect(() => {
    if (autoSend && !sentOnce.current) {
      sentOnce.current = true;
      void doSend();
    }
  }, [autoSend, doSend]);

  useEffect(() => {
    if (!sent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      setBusy("check");
      setError(null);
      try {
        const r: ConfirmResult = await verify({
          data: { purpose, code: value, trust: trustArg(trust) },
        });
        if (r.ok) {
          await onConfirmed({ trust: r.trust, added: r.added });
          return;
        }
        setError(r.message);
        setCode("");
        if (r.reason === "used_up" || r.reason === "expired" || r.reason === "none") {
          setSent((s) => (s ? { ...s, resendAt: Math.min(s.resendAt, Date.now()) } : s));
        }
      } catch (e: any) {
        setError(e?.message ?? "Couldn't check the code. Try again.");
        setCode("");
      } finally {
        setBusy(null);
      }
    },
    [busy, verify, purpose, trust, onConfirmed],
  );

  // Android Chrome reads the text itself (WebOTP); stop when the step goes.
  useEffect(() => {
    if (!sent) return;
    const ac = new AbortController();
    void listenForSmsCode(ac.signal).then((c) => {
      if (c && !ac.signal.aborted) {
        setCode(c);
        void submit(c);
      }
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent?.expiresAt]);

  if (!sent) {
    return (
      <div className="space-y-3" data-two-step-sms="send">
        <p className="text-sm text-muted-foreground">
          We'll text a 6-digit code to{" "}
          <span className="font-medium text-foreground">
            {to ?? (phone ? maskPhone(phone) : "your phone")}
          </span>
          .
        </p>
        <Problem text={error} />
        <Button className="h-12 w-full text-base" onClick={() => void doSend()} disabled={!!busy}>
          {busy === "send" ? <Busy label="Sending…" /> : "Text me a code"}
        </Button>
      </div>
    );
  }

  const resendIn = sent.resendAt - now;
  const expired = sent.expiresAt <= now;
  return (
    <div className="space-y-3" data-two-step-sms="code">
      <p className="text-sm text-muted-foreground">
        Enter the code we texted to <span className="font-medium text-foreground">{sent.to}</span>.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <CodeInput
          value={code}
          onChange={setCode}
          onComplete={(v) => void submit(v)}
          disabled={busy === "check" || expired}
        />
        <Problem text={expired ? "That code ran out. Send a new one." : error} />
        <Button
          type="submit"
          className="h-12 w-full text-base"
          disabled={!!busy || code.length !== 6 || expired}
        >
          {busy === "check" ? <Busy label="Checking…" /> : "Continue"}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {expired ? "Code expired" : `Expires in ${clock(sent.expiresAt - now)}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 px-2"
          onClick={() => void doSend()}
          disabled={!!busy || resendIn > 0}
          data-two-step-resend
        >
          {busy === "send" ? (
            <Busy label="Sending…" />
          ) : resendIn > 0 ? (
            `Resend in ${clock(resendIn)}`
          ) : (
            "Send a new code"
          )}
        </Button>
      </div>
    </div>
  );
}

/** Add a phone: the number (theirs on file to start), then the code texted to it. */
export function AddPhoneFlow({
  suggestedPhone,
  trust,
  onAdded,
}: {
  suggestedPhone?: string | null;
  trust: boolean;
  onAdded: (c: Confirmed) => void | Promise<void>;
}) {
  const [raw, setRaw] = useState(() =>
    suggestedPhone ? suggestedPhone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3") : "",
  );
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (phone) {
    return (
      <div className="space-y-3">
        <SmsCodeStep
          purpose="add_phone"
          phone={phone}
          autoSend
          trust={trust}
          onConfirmed={onAdded}
        />
        <Button variant="ghost" className="h-10 w-full" onClick={() => setPhone(null)}>
          Change the number
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      data-two-step-add-phone
      onSubmit={(e) => {
        e.preventDefault();
        const p = twoStepPhone(raw);
        if (!p) {
          setError("Type a Canadian or US mobile number, like 204 555 0123.");
          return;
        }
        setError(null);
        setPhone(p);
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Mobile number</span>
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="204 555 0123"
          className="h-12 text-base"
          autoFocus
        />
      </label>
      <Problem text={error} />
      <Button type="submit" className="h-12 w-full text-base" disabled={!raw.trim()}>
        Text me a code
      </Button>
      <p className="text-xs text-muted-foreground">
        Standard text rates may apply. We only text this number to sign you in.
      </p>
    </form>
  );
}

// ── Passkeys ────────────────────────────────────────────────────────────────
const FRESH_MS = 4 * 60_000;

/**
 * Face ID / Touch ID. The challenge is fetched before the tap, so the tap
 * opens Face ID straight away (an iPhone allows it only right after a tap).
 */
function usePasskeyOptions<T>(purpose: "register" | "verify") {
  const start = useServerFn(startTwoStepPasskey);
  const ref = useRef<{ options: T; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchOptions = useCallback(async () => {
    try {
      const r = await start({ data: { purpose } });
      ref.current = { options: r.options as T, at: Date.now() };
      setError(null);
    } catch (e: any) {
      ref.current = null;
      setError(e?.message ?? "Couldn't get ready. Check your connection.");
    }
  }, [start, purpose]);
  useEffect(() => {
    void fetchOptions();
  }, [fetchOptions]);
  const take = useCallback(async (): Promise<T | null> => {
    const o = ref.current;
    ref.current = null;
    if (o && Date.now() - o.at < FRESH_MS) return o.options;
    await fetchOptions();
    const again = ref.current as { options: T } | null;
    ref.current = null;
    return again?.options ?? null;
  }, [fetchOptions]);
  return { take, refetch: fetchOptions, error };
}

export function PasskeyConfirm({
  trust,
  onConfirmed,
}: {
  trust: boolean;
  onConfirmed: (c: Confirmed) => void | Promise<void>;
}) {
  const finish = useServerFn(finishTwoStepPasskey);
  const { take, refetch, error: prepError } = usePasskeyOptions<RequestOptionsJSON>("verify");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = passkeyWordHere();

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const options = await take();
      if (!options) throw new Error("Couldn't get ready. Check your connection and try again.");
      const credential = await getPasskey(options);
      const r = await finish({
        data: { purpose: "verify", credential: credential as any, trust: trustArg(trust) },
      });
      if (r.ok) {
        await onConfirmed({ trust: r.trust });
        return;
      }
      setError(r.message);
    } catch (e) {
      setError(passkeyErrorText(e, word));
    } finally {
      setBusy(false);
      void refetch();
    }
  }

  return (
    <div className="space-y-3" data-two-step-passkey="verify">
      <Button className="h-12 w-full text-base" onClick={() => void go()} disabled={busy}>
        {busy ? (
          <Busy label="Waiting for you…" />
        ) : (
          <>
            <ScanFace className="mr-2 h-5 w-5" /> Use {word}
          </>
        )}
      </Button>
      <Problem text={error ?? prepError} />
    </div>
  );
}

export function AddPasskeyFlow({
  trust,
  onAdded,
}: {
  trust: boolean;
  onAdded: (c: Confirmed) => void | Promise<void>;
}) {
  const finish = useServerFn(finishTwoStepPasskey);
  const { take, refetch, error: prepError } = usePasskeyOptions<CreationOptionsJSON>("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = passkeyWordHere();

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const options = await take();
      if (!options) throw new Error("Couldn't get ready. Check your connection and try again.");
      const credential = await createPasskey(options);
      const r = await finish({
        data: {
          purpose: "register",
          credential: credential as any,
          label: passkeyLabelHere(),
          trust: trustArg(trust),
        },
      });
      if (r.ok) {
        await onAdded({ trust: r.trust, added: "passkey" });
        return;
      }
      setError(r.message);
    } catch (e) {
      setError(passkeyErrorText(e, word));
    } finally {
      setBusy(false);
      void refetch();
    }
  }

  return (
    <div className="space-y-3" data-two-step-passkey="register">
      <p className="text-sm text-muted-foreground">
        Your phone or computer asks for {word}. Nothing about your face or fingerprint leaves the
        device, and the passkey works only on jfeffect.com.
      </p>
      <Button className="h-12 w-full text-base" onClick={() => void go()} disabled={busy}>
        {busy ? (
          <Busy label="Waiting for you…" />
        ) : (
          <>
            <ScanFace className="mr-2 h-5 w-5" /> Set up {word}
          </>
        )}
      </Button>
      <Problem text={error ?? prepError} />
    </div>
  );
}

// ── Authenticator app ───────────────────────────────────────────────────────
export function TotpConfirm({
  trust,
  onConfirmed,
}: {
  trust: boolean;
  onConfirmed: (c: Confirmed) => void | Promise<void>;
}) {
  const confirm = useServerFn(confirmTwoStepTotp);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    firstAuthenticatorId()
      .then((id) => !off && setFactorId(id))
      .catch((e) => !off && setError(mfaErrorMessage(e, "Couldn't load your authenticator app.")));
    return () => {
      off = true;
    };
  }, []);

  async function submit(value = code) {
    if (!factorId || value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factorId, value);
      // Keep this sign-in confirmed even if the app is removed later; trust the device if ticked.
      const r = await confirm({ data: { trust: trustArg(trust) } }).catch(() => ({ trust: null }));
      await onConfirmed({ trust: (r as any)?.trust ?? null });
    } catch (e) {
      setCode("");
      setError(mfaErrorMessage(e, "That code didn't work. Type the newest one from the app."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      data-two-step-totp
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Open your authenticator app and type the 6-digit code for JF Effect.
      </p>
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(v) => void submit(v)}
        disabled={busy || !factorId}
      />
      <Problem text={error} />
      <Button
        type="submit"
        className="h-12 w-full text-base"
        disabled={busy || code.length !== 6 || !factorId}
      >
        {busy ? <Busy label="Checking…" /> : "Continue"}
      </Button>
    </form>
  );
}

// ── Choosing a way to set up ────────────────────────────────────────────────
export const KIND_ICON: Record<TwoStepKind, typeof ScanFace> = {
  passkey: ScanFace,
  sms: MessageSquareText,
  totp: Smartphone,
};

/** Face ID first when this device has it, then a text, then an authenticator app. */
export function useAddableKinds(): { kinds: TwoStepKind[]; ready: boolean } {
  const [passkey, setPasskey] = useState<boolean | null>(null);
  useEffect(() => {
    let off = false;
    void platformPasskeyReady().then((v) => !off && setPasskey(v));
    return () => {
      off = true;
    };
  }, []);
  return { kinds: passkey ? ["passkey", "sms", "totp"] : ["sms", "totp"], ready: passkey !== null };
}

export function WayChoices({
  kinds,
  have,
  onPick,
}: {
  kinds: TwoStepKind[];
  /** Kinds they already have (a passkey on another device is still worth adding here). */
  have?: TwoStepKind[];
  onPick: (k: TwoStepKind) => void;
}) {
  const title = (k: TwoStepKind) =>
    k === "passkey" ? passkeyTitleHere() : k === "sms" ? "Text message" : "Authenticator app";
  return (
    <div className="space-y-2" data-two-step-choices>
      {kinds.map((k, i) => {
        const Icon = KIND_ICON[k];
        const already = have?.includes(k) && k !== "passkey";
        return (
          <button
            key={k}
            type="button"
            onClick={() => onPick(k)}
            className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition hover:bg-secondary active:scale-[0.99]"
            data-two-step-choice={k}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {title(k)}
                {i === 0 && !already && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Recommended
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">
                {k === "passkey"
                  ? `Confirm with ${passkeyWordHere()}. The fastest.`
                  : already
                    ? "Add another number."
                    : KIND_BLURB[k]}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Set up one way, start to finish (the gate's first setup and Account's "Add a way"). */
export function AddWay({
  kind,
  suggestedPhone,
  trust,
  onAdded,
  onCantStart,
}: {
  kind: TwoStepKind;
  suggestedPhone?: string | null;
  trust: boolean;
  onAdded: (c: Confirmed) => void | Promise<void>;
  onCantStart?: () => void;
}) {
  const confirm = useServerFn(confirmTwoStepTotp);
  if (kind === "sms")
    return <AddPhoneFlow suggestedPhone={suggestedPhone} trust={trust} onAdded={onAdded} />;
  if (kind === "passkey") return <AddPasskeyFlow trust={trust} onAdded={onAdded} />;
  return (
    <TotpSetup
      submitLabel="Turn it on"
      onCantStart={onCantStart}
      onDone={async () => {
        const r = await confirm({ data: { trust: trustArg(trust) } }).catch(() => ({
          trust: null,
        }));
        await onAdded({ trust: (r as any)?.trust ?? null, added: "totp" });
      }}
    />
  );
}
