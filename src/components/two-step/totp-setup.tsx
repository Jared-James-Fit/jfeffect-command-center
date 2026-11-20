import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/two-step/code-input";
import { mfaErrorMessage, startTotpEnrollment, verifyTotp, type TotpEnrollment } from "@/lib/mfa";

/**
 * Add an authenticator: one tap on the phone that's signed in (the otpauth
 * link opens the authenticator app or the iPhone's Passwords app), or scan the
 * code from a computer, or type the key; then its 6-digit code turns it on.
 */
export function TotpSetup({ label, submitLabel, onDone }: {
  /** Shown in the authenticator app beside "JF Effect". */
  label?: string;
  submitLabel: string;
  onDone: () => void | Promise<void>;
}) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startTotpEnrollment(label)
      .then((e) => { if (!cancelled) setEnrollment(e); })
      .catch((e) => { if (!cancelled) setLoadError(mfaErrorMessage(e, "Couldn't start the setup. Try again.")); });
    return () => { cancelled = true; };
  }, [label]);

  async function submit(value = code) {
    if (!enrollment || value.length !== 6 || busy) return;
    setBusy(true);
    try {
      await verifyTotp(enrollment.factorId, value);
      await onDone();
    } catch (e) {
      setCode("");
      toast.error(mfaErrorMessage(e, "That code didn't work. Type the newest one from the app."));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!enrollment) {
    return (
      <div className="grid h-40 place-items-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>On this phone, tap <span className="font-medium text-foreground">Add to authenticator app</span>. On a computer, scan the square with your phone's camera.</li>
        <li>Type the 6-digit code the app shows for JF Effect.</li>
      </ol>
      <Button asChild variant="outline" className="h-11 w-full">
        <a href={enrollment.uri}>Add to authenticator app</a>
      </Button>
      <img
        src={enrollment.qrCode}
        alt="Code to scan with an authenticator app"
        className="mx-auto hidden h-44 w-44 rounded-lg bg-white p-2 sm:block"
      />
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" aria-label="Setup key">{enrollment.secret}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(enrollment.secret).then(
              () => toast.success("Key copied"),
              () => toast.error("Couldn't copy. Type the key into the app instead."),
            );
          }}
        >
          Copy key
        </Button>
      </div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <CodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} />
        <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== 6}>
          {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Checking…</> : submitLabel}
        </Button>
      </form>
    </div>
  );
}
