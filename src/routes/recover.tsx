import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mail, ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { requestAccountRecovery } from "@/lib/account-recovery.functions";
import { NEUTRAL_RESPONSE_MESSAGE } from "@/lib/account-recovery.constants";

export const Route = createFileRoute("/recover")({
  head: () => ({ meta: [{ title: "Recover your account — JF Effect" }] }),
  component: RecoverPage,
});

function RecoverPage() {
  const navigate = useNavigate();
  const send = useServerFn(requestAccountRecovery);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    try {
      await send({ data: { identifier: identifier.trim() } });
    } catch {
      /* swallow — neutral response */
    }
    setBusy(false);
    setDone(true);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="JF Effect" className="h-11 w-11 rounded-xl shadow-glow" />
          <span className="text-lg font-black tracking-tight">JF EFFECT</span>
        </div>

        <div className="w-full max-w-sm">
          <Card className="border-border bg-card/60 p-6 backdrop-blur-sm">
            {!done ? (
              <>
                <div className="text-center">
                  <h1 className="text-xl font-black tracking-tight">Recover Your Account</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Enter the email address or mobile number on your account and we'll
                    send recovery instructions.
                  </p>
                </div>
                <form onSubmit={submit} className="mt-6 space-y-4">
                  <div>
                    <Label
                      htmlFor="identifier"
                      className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Email or mobile number
                    </Label>
                    <div className="relative mt-1.5">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        id="identifier"
                        autoFocus
                        autoComplete="username"
                        inputMode="email"
                        required
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="pl-10 py-6 text-base"
                        placeholder="you@example.com or +1 555 0100"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={busy || identifier.trim().length < 3}
                    className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
                  >
                    {busy ? "Sending…" : "Send Recovery Instructions"}
                  </Button>
                </form>
                <div className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5">
                  <ShieldCheck className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Encrypted • Single-use • 30-minute links
                  </span>
                </div>
              </>
            ) : (
              <div className="space-y-4 text-center">
                <h2 className="text-xl font-black tracking-tight">Check your inbox</h2>
                <p className="text-sm text-muted-foreground">{NEUTRAL_RESPONSE_MESSAGE}</p>
                <Button
                  onClick={() => navigate({ to: "/auth" })}
                  className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
                >
                  Back to login
                </Button>
              </div>
            )}
          </Card>

          <div className="mt-4 text-center">
            <Link
              to="/auth"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to login
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}