import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SetupInviteStep } from "@/components/setup-invite-step";
import { claimHandlingInviteFn, getHandlingInviteFn } from "@/lib/competition/handling.functions";
import { shareMeta } from "@/lib/share-meta";

/**
 * A competition-handling invitation (jfeffect.com/h/<token>, Nov 26 2026). The
 * token names nobody; the server says only the first name, the handler and the
 * meet, and how they get in (`inviteAccess`): signed in as the athlete, straight
 * on to their meet details; an athlete with an account, sign in; a new
 * athlete, the same one-tap setup as every setup link and a password, then
 * their meet details; signed in as someone else on an invite made for a new
 * record, take it onto their own account. The link is never the athlete's
 * consent to anything: the steps after it are.
 */
export const Route = createFileRoute("/h/$token")({
  head: () => ({
    meta: [
      { title: "Your meet · JF Effect" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      ...shareMeta({ title: "Your meet with JF Effect", description: "Set up your meet in a few minutes." }),
    ],
  }),
  component: HandlingInvitePage,
});

type Invite = Awaited<ReturnType<typeof getHandlingInviteFn>>;

function HandlingInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const read = useServerFn(getHandlingInviteFn);
  const claim = useServerFn(claimHandlingInviteFn);
  const [inv, setInv] = useState<Invite | null>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<"start" | "setup" | "password" | "done">("start");
  const [user, setUser] = useState<User | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setFailed(false);
    read({ data: { token } })
      .then(setInv)
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  const goToMeet = (competitionId: string | null | undefined) =>
    navigate({
      to: "/portal/competition",
      search: competitionId ? { meet: competitionId, onboard: true } : {},
      replace: true,
    });

  // signed in as them: straight to their meet
  useEffect(() => {
    if (inv && "access" in inv && inv.access === "continue") void goToMeet(inv.competitionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv]);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return toast.error("Pick a password");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || (user && u.user.id !== user.id)) return toast.error("Open the link again to carry on.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPhase("done");
    // their own record now has a login: the invite carries straight on
    try {
      const r = await claim({ data: { token } });
      void goToMeet(r.competitionId);
    } catch {
      void goToMeet(null);
    }
  };

  const takeOver = async () => {
    setBusy(true);
    try {
      const r = await claim({ data: { token } });
      void goToMeet(r.competitionId);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't open it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-sm flex-col justify-center px-5 py-10" data-handling-invite>
      <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        <Trophy className="h-6 w-6" />
      </div>
      {failed ? (
        <div className="space-y-3 text-center">
          <p className="text-[15px]">This didn't load.</p>
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !inv ? (
        <p className="text-center text-sm text-muted-foreground">Opening your invitation…</p>
      ) : inv.state !== "ok" ? (
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">
            {inv.state === "expired" ? "This link ran out" : inv.state === "revoked" ? "This link was cancelled" : "This link doesn't work"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Ask {("handlerFirst" in inv ? inv.handlerFirst : null) ?? "your handler"} for a new one. If you already set up your meet, sign in and open Competition.
          </p>
          <Button className="mt-2 w-full" variant="outline" onClick={() => navigate({ to: "/auth" })}>
            Sign in
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {inv.first ? `${inv.first}, ` : ""}
              {inv.handlerFirst ?? "Your handler"} is handling you
              {inv.meet?.name ? ` at ${inv.meet.name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up your meet details in a few minutes: your class, lifts, warm-ups and travel. Your plan gets built from them.
            </p>
          </div>

          {"access" in inv && inv.access === "continue" ? (
            <p className="text-center text-sm text-muted-foreground">Opening your meet…</p>
          ) : null}

          {"access" in inv && inv.access === "sign_in" ? (
            <Button
              className="w-full"
              onClick={() => navigate({ to: "/auth", search: { next: `/h/${token}` } })}
              data-invite-sign-in
            >
              Sign in to continue
            </Button>
          ) : null}

          {"access" in inv && inv.access === "set_up" && inv.setupToken ? (
            phase === "start" ? (
              <Button className="w-full" onClick={() => setPhase("setup")} data-invite-set-up>
                Get started
              </Button>
            ) : phase === "setup" ? (
              <SetupInviteStep
                token={inv.setupToken}
                onInvalid={() => toast.error("Ask your handler for a new link")}
                onSignedIn={(u) => {
                  setUser(u);
                  setPhase("password");
                }}
              />
            ) : phase === "password" ? (
              <form onSubmit={savePassword} className="space-y-4">
                <input type="email" name="email" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
                <div>
                  <Label htmlFor="h-password">Pick a password</Label>
                  <PasswordInput
                    id="h-password"
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1.5 h-12 text-base"
                  />
                </div>
                <Button type="submit" className="w-full" loading={busy}>
                  Continue
                </Button>
              </form>
            ) : (
              <p className="text-center text-sm text-muted-foreground">Opening your meet…</p>
            )
          ) : null}

          {"access" in inv && inv.access === "other" ? (
            <div className="space-y-2">
              <p className="text-center text-sm text-muted-foreground">You're signed in. Add this meet to your account?</p>
              <Button className="w-full" loading={busy} onClick={() => void takeOver()} data-invite-claim>
                Add it to my account
              </Button>
            </div>
          ) : null}

          {"access" in inv && inv.access === "not_yours" ? (
            <p className="text-center text-sm text-muted-foreground">
              This invitation is for another account. Sign out and open the link again, or ask {inv.handlerFirst ?? "your handler"} for help.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
