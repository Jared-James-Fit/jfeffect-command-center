import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  createQueryPersister,
  QUERY_PERSIST_BUSTER,
  QUERY_PERSIST_MAX_AGE,
  shouldPersistQueryKey,
} from "@/lib/query-persister";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ClientImpersonationProvider } from "@/lib/client-impersonation";
import { TeamImpersonationProvider } from "@/lib/team-impersonation";
import { ProgressDrawer } from "@/components/progress-drawer";
import { GlobalHighlight } from "@/components/global-highlight";
import { MediaViewerProvider, MediaViewerRoot } from "@/components/media-viewer";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../integrations/supabase/client";
import { saveLastRoute } from "@/lib/route-persistence";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
// Side-effect import: registers the global beforeinstallprompt listener early
// so the install prompt can be captured before the user reaches /install.
import "@/hooks/use-pwa-install";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { initNativeShell } from "@/platform/native-init";
import { initChunkRecovery } from "@/lib/chunk-recovery";
import { PwaUpdateToast } from "@/components/pwa/pwa-update-toast";
import { OnlineOfflineBanner } from "@/components/pwa/online-offline-banner";
// Side-effect import: registers durable-queue handlers for cross-feature
// offline writes (bodyweight, water, …) so pending items can drain at boot.
import "@/lib/offline/data-handlers";
import "@/lib/offline/workout-completion-sync";
// HTML5 drag-and-drop polyfill for touch devices. Loaded only in the browser
// because the package touches `document` at module scope and crashes SSR.
if (typeof document !== "undefined") {
  // @ts-expect-error - no types shipped
  import("drag-drop-touch");
}

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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "JF Effect | Personal Trainer Selkirk MB & Online Fitness Coaching" },
      { name: "description", content: "JF Effect — personal training in Selkirk, MB and online fitness coaching for Selkirk, Winnipeg, and beyond. Strength, fat loss, muscle building, and powerlifting coaching by Jared James Fit." },
      { name: "author", content: "Jared James Fit | JF Effect" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "JF Effect" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "geo.region", content: "CA-MB" },
      { name: "geo.placename", content: "Selkirk, Manitoba" },
      { name: "geo.position", content: "50.1436;-96.8839" },
      { name: "ICBM", content: "50.1436, -96.8839" },
      { property: "og:title", content: "JF Effect | Personal Trainer Selkirk MB & Online Fitness Coaching" },
      { property: "og:description", content: "Personal training in Selkirk, MB and online fitness coaching for Selkirk, Winnipeg, and beyond. Strength, fat loss, muscle building, and powerlifting by Jared James Fit." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "JF Effect" },
      { property: "og:locale", content: "en_CA" },
      { property: "og:url", content: "https://jfeffect.com" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JF Effect | Personal Trainer Selkirk MB & Online Fitness Coaching" },
      { name: "twitter:description", content: "Personal training in Selkirk, MB and online fitness coaching for Selkirk, Winnipeg, and beyond. Strength, fat loss, muscle building, and powerlifting by Jared James Fit." },
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
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": ["LocalBusiness", "SportsActivityLocation", "HealthAndBeautyBusiness"],
          "@id": "https://jfeffect.com/#business",
          name: "JF Effect",
          alternateName: "Jared James Fit",
          description: "Personal training in Selkirk, MB and online fitness coaching for Selkirk, Winnipeg, and Manitoba. Specializing in strength, fat loss, muscle building, and powerlifting.",
          url: "https://jfeffect.com",
          logo: "https://jfeffect.com/logo.png",
          image: "https://jfeffect.com/logo.png",
          telephone: "+1-204-229-4913",
          email: "jared@jfeffect.com",
          address: {
            "@type": "PostalAddress",
            streetAddress: "Iron Image Gym",
            addressLocality: "Selkirk",
            addressRegion: "MB",
            postalCode: "R1A",
            addressCountry: "CA",
          },
          geo: {
            "@type": "GeoCoordinates",
            latitude: 50.1436,
            longitude: -96.8839,
          },
          areaServed: [
            { "@type": "City", name: "Selkirk", containedInPlace: { "@type": "State", name: "Manitoba" } },
            { "@type": "City", name: "Winnipeg", containedInPlace: { "@type": "State", name: "Manitoba" } },
            { "@type": "State", name: "Manitoba" },
          ],
          serviceType: ["Personal Training", "Online Fitness Coaching", "Powerlifting Coaching", "Nutrition Coaching"],
          founder: { "@type": "Person", name: "Jared James McIntyre", jobTitle: "Personal Trainer & Online Fitness Coach", sameAs: ["https://jaredjamesfit.com"] },
          sameAs: ["https://jaredjamesfit.com"],
          openingHoursSpecification: [
            { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday"], opens: "06:00", closes: "21:00" },
            { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday","Sunday"], opens: "08:00", closes: "18:00" },
          ],
          priceRange: "$$",
          contactPoint: [{
            "@type": "ContactPoint",
            telephone: "+1-204-229-4913",
            contactType: "customer support",
            areaServed: "CA-MB",
            availableLanguage: ["English"],
          }],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "JF Effect",
          url: "https://jfeffect.com",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * Tracks the current authenticated pathname and persists it to localStorage
 * so the app can restore the user's last location after a full PWA restart.
 * Renders nothing — pure side effect.
 */
function RouteTracker() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    const { pathname } = location;
    if (pathname === lastPathRef.current) return;
    lastPathRef.current = pathname;
    saveLastRoute(user.id, pathname);
  }, [user?.id, loading, location.pathname]);

  return null;
}

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

  useEffect(() => {
    // Dev-only: app shell is mounted and visible.
    void import("@/lib/perf-timing").then((m) => m.logPerf("app shell visible"));
    // Install one-time recovery for failed/outdated chunk loads (post-deploy).
    initChunkRecovery();
    registerServiceWorker();
    void initNativeShell();
  }, []);

  // Build the localStorage persister once on the client. On the server we
  // fall back to the plain QueryClientProvider so SSR never touches window.
  const persister = useMemo(() => createQueryPersister(), []);

  const inner = (
    <AuthProvider>
      <ClientImpersonationProvider>
        <TeamImpersonationProvider>
          <MediaViewerProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <RouteTracker />
            <Toaster position="top-right" theme="dark" richColors />
            <ProgressDrawer />
            <GlobalHighlight />
            <OnlineOfflineBanner />
            <PwaUpdateToast />
            {/* Single global media viewer — portalled above every overlay. */}
            <MediaViewerRoot />
          </MediaViewerProvider>
        </TeamImpersonationProvider>
      </ClientImpersonationProvider>
    </AuthProvider>
  );

  if (persister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: QUERY_PERSIST_MAX_AGE,
          buster: QUERY_PERSIST_BUSTER,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) =>
              q.state.status === "success" && shouldPersistQueryKey(q.queryKey),
          },
        }}
      >
        {inner}
      </PersistQueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>
  );
}

