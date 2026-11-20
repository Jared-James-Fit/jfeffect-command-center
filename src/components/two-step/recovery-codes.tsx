import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { makeRecoveryCodes } from "@/lib/mfa-recovery.functions";
import { recoveryCodesFile } from "@/lib/mfa-recovery";
import { saveFiles } from "@/lib/file-share";

/**
 * New recovery codes, shown once: copy them, save them as a file, and say
 * they're kept somewhere other than this phone before going on. A failure
 * never traps anyone: Try again, or (when it's part of first setup) Later,
 * with the Account card to make them any time.
 */
export function RecoveryCodesPanel({ email, onDone, onSkip }: {
  email?: string | null;
  onDone: () => void;
  /** First setup only: carry on without codes (the Account card makes them later). */
  onSkip?: () => void;
}) {
  const make = useServerFn(makeRecoveryCodes);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [madeAt, setMadeAt] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    make({})
      .then((r) => {
        if (cancelled) return;
        setCodes(r.codes);
        setMadeAt(new Date(r.madeAt));
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Couldn't make recovery codes."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const text = useMemo(() => (codes ? recoveryCodesFile(codes, email, madeAt) : ""), [codes, email, madeAt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Codes copied");
    } catch {
      toast.error("Couldn't copy. Save them as a file instead.");
    }
  }

  async function save() {
    const file = new File([text], "jf-effect-recovery-codes.txt", { type: "text/plain" });
    const outcome = await saveFiles([file]);
    if (outcome === "again") toast("Tap Save once more to finish.");
    else if (outcome === "failed") toast.error("Couldn't save the file. Copy the codes instead.");
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="h-11 w-full" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        {onSkip && (
          <Button variant="ghost" className="h-10 w-full" onClick={onSkip}>
            Later (make them in Account)
          </Button>
        )}
      </div>
    );
  }
  if (!codes) {
    return (
      <div className="grid h-40 place-items-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-recovery-codes>
      <p className="text-sm text-muted-foreground">
        If you lose this phone, one of these gets you back in. Each works once. They're shown only now, so keep
        them somewhere other than this phone: a password manager, or printed.
      </p>
      <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="tabular-nums">{c}</li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => void copy()}>
          <Copy className="mr-1.5 h-4 w-4" /> Copy
        </Button>
        <Button variant="outline" className="h-11" onClick={() => void save()}>
          <Download className="mr-1.5 h-4 w-4" /> Save
        </Button>
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} className="mt-0.5" />
        <span>I've saved these somewhere other than this phone</span>
      </label>
      <Button className="h-11 w-full" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
