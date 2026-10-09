import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { AuthSplash } from "@/components/auth-splash";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "JF Effect — Private Coaching OS" }] }),
  validateSearch: z.object({ next: z.string().optional() }),
  component: AuthPage,
});

function AuthPage() {
  const { user, role, viewOnly, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();

  useEffect(() => {
    if (!loading && user && role) {
      const fallback = role === "member" ? "/m" : role === "client" ? "/portal" : viewOnly ? "/finance" : "/admin";
      // Only honor in-app relative paths to prevent open-redirect.
      const safeNext =
        next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      if (safeNext) {
        navigate({ to: safeNext, replace: true });
      } else {
        navigate({ to: fallback, replace: true });
      }
    }
  }, [user, role, viewOnly, loading, navigate, next]);

  // Avoid flashing the login form while the session is still restoring,
  // or while an authenticated user with a resolved role is being routed.
  if (loading || (user && role)) {
    return <AuthSplash />;
  }

  // A successful password login can establish the Supabase session before a
  // role lookup finishes. If role resolution ultimately fails, never strand
  // the user on an endless splash — give them a clear retry path while
  // preserving the authenticated session.
  if (user && !role) {
    return (
      <AuthShell>
        <div className="text-center">
          <AuthLogo size={64} />
          <h1 className="mt-6 text-[24px] font-semibold tracking-tight">Finishing your sign-in</h1>
          <p className="mx-auto mt-2 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
            Your password was accepted, but your account access didn't finish loading.
          </p>
          <div className="mt-7 space-y-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-gradient-primary text-[17px] font-semibold text-primary-foreground transition active:scale-[0.985]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="h-12 w-full rounded-2xl text-[15px] font-medium text-muted-foreground transition active:opacity-60"
            >
              Sign out
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={
        <p className="text-[13px] text-muted-foreground">
          New here?{" "}
          <Link to="/membership" className="font-medium text-primary active:opacity-60">
            Join JF Membership
          </Link>
        </p>
      }
    >
      <div className="text-center">
        <AuthLogo />
        <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-[-0.02em]">Welcome back</h1>
        <p className="mt-1.5 text-[16px] text-muted-foreground">Sign in to JF Effect</p>
      </div>
      <div className="mt-8">
        <SignInForm />
      </div>
    </AuthShell>
  );
}
