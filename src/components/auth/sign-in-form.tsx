import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const LAST_EMAIL_KEY = "jf:last-email";

function readLastEmail() {
  try { return localStorage.getItem(LAST_EMAIL_KEY) ?? ""; } catch { return ""; }
}
function writeLastEmail(v: string) {
  try { localStorage.setItem(LAST_EMAIL_KEY, v); } catch { /* storage unavailable */ }
}

/** Plain-English version of whatever the auth server said. */
export function friendlySignInError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "That email or password isn't right. Check them and try again.";
  }
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the link.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute, then try again.";
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to")) return "Can't reach the server. Check your connection and try again.";
  return message?.trim() || "Couldn't sign you in. Please try again.";
}

/**
 * Sign-in form: grouped Email / Password rows like iOS Settings, one big
 * button, inline errors. Autofill/password-manager friendly, remembers the
 * last email, Enter moves email → password → submits.
 */
export function SignInForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const [email, setEmail] = useState(() => readLastEmail());
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Land the cursor where it saves a tap — but never pop the phone keyboard
  // open on its own (it would cover the form on small screens).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return;
    (email ? passwordRef : emailRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const normalized = email.trim().toLowerCase();
    if (!normalized) { fail("Enter your email."); emailRef.current?.focus(); return; }
    if (!password) { fail("Enter your password."); passwordRef.current?.focus(); return; }
    setError(null);
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (authError) { fail(friendlySignInError(authError.message)); return; }
      if (!data.session?.user) { fail("Sign-in didn't finish. Please try again."); return; }
      writeLastEmail(normalized);
      onSignedIn?.();
      // Keep the button busy: the page swaps to the splash as soon as the
      // session + role resolve, so there's no flash of the form.
    } catch (err: any) {
      fail(friendlySignInError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const rowClass = "flex min-h-[54px] items-center gap-3 px-4";
  const labelClass = "w-[78px] shrink-0 text-[15px] font-medium";
  const inputClass =
    "min-w-0 flex-1 bg-transparent py-3 text-[17px] outline-none placeholder:text-muted-foreground/60";

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <div
        key={shake}
        className={cn(
          "overflow-hidden rounded-2xl bg-card ring-1 ring-border/80 transition-shadow focus-within:ring-2 focus-within:ring-primary/40",
          shake > 0 && "jf-auth-shake",
        )}
      >
        <label className={rowClass}>
          <span className={labelClass}>Email</span>
          <input
            ref={emailRef}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !password) { e.preventDefault(); passwordRef.current?.focus(); }
            }}
            className={inputClass}
          />
        </label>
        <div className="mx-4 h-px bg-border/80" />
        <label className={rowClass}>
          <span className={labelClass}>Password</span>
          <input
            ref={passwordRef}
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Required"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition active:scale-90 hover:text-foreground"
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </label>
      </div>

      {/* Reserve two lines so the screen doesn't jump when an error appears. */}
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
        className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary text-[17px] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)] transition active:scale-[0.985] disabled:opacity-80"
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          "Sign In"
        )}
      </button>

      <div className="mt-4 text-center">
        <Link
          to="/recover"
          className="inline-block py-2 text-[15px] font-medium text-primary active:opacity-60"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
