import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  acceptWorkspaceInvitation,
  finishInviteSignup,
  peekWorkspaceInvitation,
  sendInviteSignupCode,
} from "@/lib/coach-platform/coach-workspace.functions";
import { ACCEPT_WORDS, PEEK_WORDS } from "@/lib/coach-platform/workspace";

// A coach's invitation (invite-only pilot). The link alone accepts nothing:
// the signed-in login's confirmed email has to be the one invited, and a
// client sees exactly what they're agreeing to share first.
export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Your coach's invitation · JF Effect" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const peekFn = useServerFn(peekWorkspaceInvitation);
  const acceptFn = useServerFn(acceptWorkspaceInvitation);
  const peek = useQuery({ queryKey: ["invite-peek", token], queryFn: () => peekFn({ data: { token } }), staleTime: 0, gcTime: 0 });
  const accept = useMutation({ mutationFn: () => acceptFn({ data: { token } }) });
  const here = `/invite/${token}`;

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-[100svh] max-w-md flex-col justify-center gap-4 bg-background p-4">
      <p className="text-center text-[13px] font-semibold tracking-wide text-muted-foreground">JF EFFECT</p>
      {children}
    </main>
  );

  if (peek.isLoading || loading) return shell(<Loader2 className="mx-auto h-5 w-5 animate-spin" />);
  const p = peek.data ?? { state: "invalid" as const };

  if (accept.data?.ok) {
    return shell(
      <Card className="space-y-3 p-5">
        <h1 className="text-[20px] font-semibold">You're with {accept.data.business}</h1>
        <p className="text-[14px] text-muted-foreground">
          {accept.data.kind === "client"
            ? "Your coach can see your training and set up your program. You can end this any time from your account."
            : "You're on the team. Your workspace is ready."}
        </p>
        <Button onClick={() => navigate({ to: accept.data!.kind === "client" ? "/portal" : "/workspace" })}>Continue</Button>
      </Card>,
    );
  }

  if (p.state !== "open") {
    return shell(
      <Card className="p-5">
        <p className="text-[15px]">{PEEK_WORDS[p.state]}</p>
      </Card>,
    );
  }

  const isClient = p.kind === "client";
  return shell(
    <Card className="space-y-4 p-5">
      <h1 className="text-[20px] font-semibold">
        {p.business} invited you {isClient ? "to train with them" : `to join their team as ${p.role === "admin" ? "an admin" : "a coach"}`}
      </h1>
      {isClient && "consent" in p && (
        <div className="rounded-lg bg-muted p-3 text-[14px] leading-relaxed">
          <p className="mb-1 font-medium">What you're agreeing to</p>
          <p>{(p as any).consent}</p>
        </div>
      )}
      {accept.data && !accept.data.ok && (
        <p className="text-[14px] text-destructive">{ACCEPT_WORDS[accept.data.reason ?? ""] ?? "That didn't work. Try again."}</p>
      )}
      {accept.isError && <p className="text-[14px] text-destructive">{(accept.error as Error).message}</p>}
      {user ? (
        <Button className="w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
          {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isClient ? "I agree, accept" : "Join the team"}
        </Button>
      ) : (
        <NewLogin token={token} signInHref={here} />
      )}
    </Card>,
  );
}

/** Signed out: make a login with a code sent to the invited email, or sign in. */
function NewLogin({ token, signInHref }: { token: string; signInHref: string }) {
  const sendFn = useServerFn(sendInviteSignupCode);
  const finishFn = useServerFn(finishInviteSignup);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const send = useMutation({ mutationFn: () => sendFn({ data: { token } }) });
  const finish = useMutation({
    mutationFn: async () => {
      const r = await finishFn({ data: { token, code, password, fullName: name } });
      const { error } = await supabase.auth.signInWithPassword({ email: r.email, password });
      if (error) throw new Error("Your account is made. Sign in to accept.");
      return r;
    },
  });
  const signIn = (
    <Button asChild variant="outline" className="w-full">
      <Link to="/auth" search={{ next: signInHref }}>I have an account: sign in</Link>
    </Button>
  );
  if (send.data?.signIn) {
    return (
      <div className="space-y-2">
        <p className="text-[14px] text-muted-foreground">{send.data.emailHint} already has a login. Sign in with it to accept.</p>
        {signIn}
      </div>
    );
  }
  if (!send.data?.sent) {
    return (
      <div className="space-y-2">
        <Button className="w-full" onClick={() => send.mutate()} disabled={send.isPending}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "I'm new: send me a code"}
        </Button>
        {send.isError && <p className="text-[14px] text-destructive">{(send.error as Error).message}</p>}
        {signIn}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        finish.mutate();
      }}
    >
      <p className="text-[14px] text-muted-foreground">I sent a 6-digit code to {send.data.emailHint}.</p>
      <Input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="h-11 text-[16px]" />
      <Input autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-[16px]" />
      <Input type="password" autoComplete="new-password" placeholder="A password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 text-[16px]" />
      {finish.isError && <p className="text-[14px] text-destructive">{(finish.error as Error).message}</p>}
      <Button type="submit" className="w-full" disabled={finish.isPending || code.length !== 6 || name.trim().length < 2 || password.length < 8}>
        {finish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Make my account"}
      </Button>
    </form>
  );
}
