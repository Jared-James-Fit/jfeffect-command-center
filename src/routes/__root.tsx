import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import { ClientImpersonationProvider } from "@/lib/client-impersonation";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        const uid = session?.user?.id ?? null;
        setUserId(uid);
        if (!uid) return;
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid);
        if (cancelled) return;
        const roles = (roleRows ?? []).map((r: any) => r.role as string);
        setRole(
          roles.includes("admin") ? "admin"
          : roles.includes("coach") ? "coach"
          : roles.includes("client") ? "client"
          : null,
        );
      } catch {
        // ignore — diagnostic role is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isStaff = role === "admin" || role === "coach";
  const errorId = useMemo(
    () => `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    [error],
  );
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportLovableError(error, {
      boundary: "tanstack_root_error_component",
      errorId,
      route: pathname + search,
      role,
      userId,
    });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", {
      errorId,
      route: pathname + search,
      role,
      userId,
      message: error?.message,
      stack: error?.stack,
    });
  }, [error, errorId, pathname, search, role, userId]);

  const diagnostics = [
    `Error ID: ${errorId}`,
    `When: ${new Date().toISOString()}`,
    `Route: ${pathname}${search}`,
    `Role: ${role ?? "anonymous"}`,
    `User: ${userId ?? "—"}`,
    `Message: ${error?.message ?? String(error)}`,
    `UserAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "—"}`,
    "",
    "Stack:",
    error?.stack ?? "(no stack)",
  ].join("\n");

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = diagnostics;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      ta.remove();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            This page didn't load
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isStaff
              ? "Something crashed. Diagnostics below — copy them if you need to share with support."
              : "Something went wrong on our end. You can try again or head back home."}
          </p>
          {isStaff && (
            <p className="mt-1 text-xs text-muted-foreground">
              Error ID: <span className="font-mono">{errorId}</span>
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => { if (typeof window !== "undefined") window.history.back(); }}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go back
          </button>
          <a
            href={isStaff ? "/admin" : "/portal"}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Dashboard
          </a>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>

        {isStaff && (
          <div className="mt-6 rounded-md border border-border bg-card p-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Admin diagnostics
              </div>
              <button
                onClick={copyDiagnostics}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
              >
                {copied ? "Copied!" : "Copy details"}
              </button>
            </div>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-[11px] leading-snug text-foreground">
{diagnostics}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "JF Effect" },
      { name: "description", content: "A modern web app for fitness coaches to manage clients, leads, and business operations." },
      { name: "author", content: "Lovable" },
      { name: "theme-color", content: "#0F172A" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "JF Effect" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "JF Effect" },
      { property: "og:description", content: "A modern web app for fitness coaches to manage clients, leads, and business operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "JF Effect" },
      { name: "twitter:description", content: "A modern web app for fitness coaches to manage clients, leads, and business operations." },
      { property: "og:image", content: "https://jfeffect.com/logo.png" },
      { name: "twitter:image", content: "https://jfeffect.com/logo.png" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ClientImpersonationProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <PageTransition>
            <Outlet />
          </PageTransition>
          <Toaster position="top-right" theme="dark" richColors />
        </ClientImpersonationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function PageTransition({ children }: { children: ReactNode }) {
  // Re-key on top-level path segment so we get a subtle fade between
  // major sections without animating every search-param change.
  const segment = useRouterState({
    select: (s) => "/" + (s.location.pathname.split("/")[1] ?? ""),
  });
  return (
    <div key={segment} className="page-enter">
      {children}
    </div>
  );
}
