import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";
import { friendlySignInError } from "@/components/auth/sign-in-form";
import { cn } from "@/lib/utils";
import { checkFreeSignup, freeSignupRedirect, type FreeSignupInput } from "@/lib/free-signup";

const POINTS = [
  "Coach-written programs, or build your own",
  "Log every set, track PRs and progress",
  "One crew: share wins, follow athletes, copy their programs",
];

/**
 * A free JF Effect account: name, email, password. Supabase emails a
 * confirmation link (to /welcome, scanner-safe); confirming it makes the
 * free member (member_free_join, by the database trigger and again by the
 * page). No card, no trial, no plan to pick.
 */
export function FreeSignup() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FreeSignupInput>({ firstName: "", email: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof FreeSignupInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (error) setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = checkFreeSignup(form);
    if (problem) {
      setError(problem.message);
      ({ firstName: nameRef, email: emailRef, password: passwordRef })[
        problem.field
      ].current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const email = form.email.trim().toLowerCase();
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: freeSignupRedirect(window.location.origin),
          data: { full_name: form.firstName.trim(), jf_signup: "free" },
        },
      });
      if (err) {
        const m = err.message.toLowerCase();
        setError(
          m.includes("registered") || m.includes("exists")
            ? "You already have an account with this email. Sign in instead."
            : friendlySignInError(err.message),
        );
        return;
      }
      // An email that already has an account comes back with no identities (and no email goes out).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError("You already have an account with this email. Sign in, or reset your password.");
        return;
      }
      if (data.session) {
        // email confirmation is off on this project: they're in now
        await (supabase as any).rpc("member_free_join").catch(() => null);
        navigate({ href: "/app", replace: true });
        return;
      }
      setSentTo(email);
    } catch (e: any) {
      setError(friendlySignInError(e?.message));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sentTo) return;
    setResent(false);
    const { error: err } = await supabase.auth.resend({
      type: "signup",
      email: sentTo,
      options: { emailRedirectTo: freeSignupRedirect(window.location.origin) },
    });
    if (err) setError(friendlySignInError(err.message));
    else setResent(true);
  };

  if (sentTo) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-muted">
            <MailCheck className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
            Check your email
          </h1>
          <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
            We sent a link to <span className="font-medium text-foreground">{sentTo}</span>. Tap it
            to finish making your account.
          </p>
          <div className="mt-7 space-y-2">
            <button
              type="button"
              onClick={resend}
              className="h-12 w-full rounded-2xl bg-secondary text-[15px] font-semibold transition active:scale-[0.985]"
            >
              {resent ? "Sent again" : "Send it again"}
            </button>
            <Link
              to="/auth"
              className="flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-medium text-muted-foreground"
            >
              Back to sign in
            </Link>
          </div>
          {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
          <p className="mt-6 text-[13px] text-muted-foreground">
            Not there? Check spam, or make sure the email is right.
          </p>
        </div>
      </AuthShell>
    );
  }

  const rowClass = "flex min-h-[54px] items-center gap-3 px-4";
  const labelClass = "w-[78px] shrink-0 text-[15px] font-medium";
  const inputClass =
    "min-w-0 flex-1 bg-transparent py-3 text-[17px] outline-none placeholder:text-muted-foreground/60";

  return (
    <AuthShell
      footer={
        <p className="text-[13px] text-muted-foreground">
          Have an account?{" "}
          <Link to="/auth" className="font-medium text-primary active:opacity-60">
            Sign in
          </Link>
        </p>
      }
    >
      <div className="text-center">
        <AuthLogo />
        <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
          Train with JF Effect
        </h1>
        <p className="mt-1.5 text-[16px] text-muted-foreground">Free. No card.</p>
      </div>

      <ul className="mx-auto mt-6 max-w-[330px] space-y-2">
        {POINTS.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-[14px] leading-snug">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} noValidate className="mt-7 w-full">
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border/80 focus-within:ring-2 focus-within:ring-primary/40">
          <label className={rowClass}>
            <span className={labelClass}>Name</span>
            <input
              ref={nameRef}
              name="given-name"
              autoComplete="given-name"
              enterKeyHint="next"
              placeholder="First name"
              value={form.firstName}
              onChange={set("firstName")}
              className={inputClass}
            />
          </label>
          <div className="mx-4 h-px bg-border/80" />
          <label className={rowClass}>
            <span className={labelClass}>Email</span>
            <input
              ref={emailRef}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="you@example.com"
              value={form.email}
              onChange={set("email")}
              className={inputClass}
            />
          </label>
          <div className="mx-4 h-px bg-border/80" />
          <label className={rowClass}>
            <span className={labelClass}>Password</span>
            <input
              ref={passwordRef}
              name="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="8 or more characters"
              value={form.password}
              onChange={set("password")}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground"
            >
              {show ? (
                <EyeOff className="h-[18px] w-[18px]" />
              ) : (
                <Eye className="h-[18px] w-[18px]" />
              )}
            </button>
          </label>
        </div>

        <div aria-live="polite" className="min-h-[46px] pt-2.5">
          {error && (
            <p className="text-center text-[13px] leading-snug text-destructive">
              <AlertCircle className="-mt-0.5 mr-1 inline h-3.5 w-3.5 align-middle" aria-hidden />
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className={cn(
            "flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground transition active:scale-[0.985]",
            busy && "opacity-80",
          )}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Creating your account" />
          ) : (
            "Create free account"
          )}
        </button>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
          By joining you agree to the{" "}
          <Link to="/terms" className="underline underline-offset-2">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      <p className="mt-8 text-center text-[13px] text-muted-foreground">
        Want a coach to write your program?{" "}
        <Link to="/coaching" className="font-medium text-foreground underline underline-offset-2">
          Apply for coaching
        </Link>
      </p>
    </AuthShell>
  );
}
