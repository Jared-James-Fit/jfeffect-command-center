import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { readStoredSession } from "@/lib/session-hint";
import { DashboardSplash } from "@/components/dashboard-splash";
import { SignedInAppContext } from "@/components/route-pending";
import { NavigationProgress } from "@/components/navigation-progress";
import { ClientProfileOverlayMount } from "@/components/clients/profile/client-profile-overlay";
import { MemberProfileOverlayMount } from "@/components/members/member-profile-overlay";
import { ThemeAnnouncementGate } from "@/components/whats-new/theme-announcement";
import { ThemeAccountSync } from "@/lib/theme-account-sync";
import { CoachingAgreementProvider } from "@/components/coaching-agreement/agreement-provider";

// Module-level warm session: once the guard has validated a user this app
// lifetime, in-app revalidations (router.invalidate after mutations, error
// retries, auth events) resolve fast and never bounce the user to /auth on
// a transient network blip. A genuinely signed-out session still returns
// null from getSession (no throw) and redirects as before.
let warmUser: User | null = null;

function hasPersistedAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(window.localStorage).some(
      (key) =>
        key.startsWith("sb-") &&
        key.endsWith("-auth-token") &&
        !!window.localStorage.getItem(key),
    );
  } catch {
    return false;
  }
}

function isTerminalRefreshError(error: unknown): boolean {
  const candidate = error as { status?: number; name?: string; message?: string } | null;
  const status = Number(candidate?.status ?? 0);
  const message = String(candidate?.message ?? "");
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    /refresh token.*(invalid|expired|not found|already used)/i.test(message)
  );
}

// A tab switch must not wait on Supabase: this runs before every navigation,
// and when getSession stalls (a token refresh on a weak signal, the auth lock
// held by another read) past the router's pendingMs, the whole app swapped to
// the full-screen splash between two pages. Already validated this app
// lifetime, same person, token good for a while yet: go straight through.
// Sign-out removes the stored session, so it still lands on /auth below.
const FAST_PASS_MARGIN_MS = 60_000;

function warmUserStillSignedIn(): User | null {
  if (!warmUser) return null;
  const stored = readStoredSession();
  if (!stored || stored.userId !== warmUser.id) return null;
  if (stored.expiresAt !== null && stored.expiresAt - Date.now() < FAST_PASS_MARGIN_MS) return null;
  return warmUser;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const fast = warmUserStillSignedIn();
    if (fast) return { user: fast };
    // Resilient session read for PWA cold launches on flaky networks.
    // A transient failure here (offline moment, slow Supabase response on
    // resume) was bubbling up as the router's default error fallback —
    // the "Something went wrong loading this page" screen users saw on
    // app open. Retry briefly, and on terminal failure fall through to
    // the auth redirect instead of throwing.
    const isRevalidation = warmUser !== null;
    // A genuine signed-out visitor still exits on the first null result below.
    // Returning PWA sessions get up to three quick recovery reads.
    const maxAttempts = 3;
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null = null;
    let threw = false;
    let refreshRejected = false;

    // On a PWA cold launch, a still-valid persisted session can briefly read as
    // null while browser storage / Supabase auth restoration settles. Only
    // retry a null result when local storage actually contains a Supabase auth
    // token; genuinely signed-out visitors still redirect immediately.
    const hasPersistedSessionHint = hasPersistedAuthSession();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        session = data.session;
        if (session?.user) break;

        const shouldRetryNull =
          hasPersistedSessionHint &&
          attempt < maxAttempts - 1;
        if (!shouldRetryNull) break;

        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      } catch (err) {
        if (attempt === maxAttempts - 1) {
          console.warn("[auth] getSession failed during route guard", err);
          threw = true;
          session = null;
          break;
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    // iOS can resume a standalone PWA after JavaScript was suspended right
    // as the access token expired. If storage still contains the Supabase
    // refresh session, explicitly ask Supabase to recover it before treating
    // a transient null read as a logout.
    if (!session?.user && hasPersistedSessionHint) {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session?.user) {
          session = data.session;
        } else if (error) {
          refreshRejected = isTerminalRefreshError(error);
          if (!refreshRejected) {
            console.warn("[auth] refreshSession transiently failed during route recovery", error);
          }
        }
      } catch (err) {
        refreshRejected = isTerminalRefreshError(err);
        if (!refreshRejected) {
          console.warn("[auth] refreshSession failed during route recovery", err);
        }
      }
    }

    if (!session?.user) {
      // Never let a single resume/revalidation blip log out a previously
      // validated user while the persisted refresh session is still present.
      // Explicit Sign Out removes that storage first, so it still redirects.
      if (
        !refreshRejected &&
        isRevalidation &&
        warmUser &&
        (threw || hasPersistedAuthSession())
      ) {
        return { user: warmUser };
      }
      const next = location.href;
      throw redirect({
        to: "/auth",
        search: next && next !== "/" ? { next } : undefined,
      });
    }
    warmUser = session.user;
    return { user: session.user };
  },
  pendingComponent: () => <DashboardSplash />,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    // Coaching Agreement: status, the launch popup and the signing flow. It sits above every
    // signed-in page so the popup shows once per app open wherever the client lands.
    <CoachingAgreementProvider>
      <NavigationProgress />
      <SignedInAppContext.Provider value>
        <Outlet />
      </SignedInAppContext.Provider>
      <ClientProfileOverlayMount />
      <MemberProfileOverlayMount />
      <ThemeAnnouncementGate />
      <ThemeAccountSync />
    </CoachingAgreementProvider>
  );
}