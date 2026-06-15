import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [
      { title: "Unsubscribe — JF Membership" },
      { name: "description", content: "Confirm that you want to stop receiving JF Membership emails." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UnsubscribePage,
});

type State =
  | { kind: "loading" }
  | { kind: "missing_token" }
  | { kind: "invalid" }
  | { kind: "ready" }
  | { kind: "already" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (!t) { setState({ kind: "missing_token" }); return; }
    setToken(t);
    (async () => {
      try {
        const r = await fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`);
        if (!r.ok) { setState({ kind: "invalid" }); return; }
        const j = await r.json();
        if (j?.valid) setState({ kind: "ready" });
        else if (j?.reason === "already_unsubscribed") setState({ kind: "already" });
        else setState({ kind: "invalid" });
      } catch {
        setState({ kind: "invalid" });
      }
    })();
  }, []);

  const confirm = async () => {
    if (!token) return;
    setState({ kind: "submitting" });
    try {
      const r = await fetch(`/email/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.success) setState({ kind: "success" });
      else if (j?.reason === "already_unsubscribed") setState({ kind: "already" });
      else setState({ kind: "error", message: j?.error ?? "Couldn't unsubscribe." });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Network error." });
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-xl font-bold">Unsubscribe</h1>
        <div className="mt-4 text-sm text-muted-foreground">
          {state.kind === "loading" && "Verifying your link…"}
          {state.kind === "missing_token" && "This link is missing the unsubscribe token. Open the link directly from the email."}
          {state.kind === "invalid" && "This unsubscribe link is invalid or expired."}
          {state.kind === "ready" && "Click below to stop receiving emails from JF Membership."}
          {state.kind === "submitting" && "Processing…"}
          {state.kind === "success" && "You've been unsubscribed. You won't receive further emails from us."}
          {state.kind === "already" && "This email address is already unsubscribed."}
          {state.kind === "error" && state.message}
        </div>
        {state.kind === "ready" && (
          <Button className="mt-5 h-11 w-full font-bold" onClick={confirm}>
            Confirm unsubscribe
          </Button>
        )}
      </Card>
    </main>
  );
}