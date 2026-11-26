import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AgreementAccessScreen } from "@/components/legal/agreement-access-screen";
import { AppShell } from "@/components/app-shell";
import { clientNav, clientBottomNav, selfServeNav, selfServeBottomNav } from "@/lib/admin-nav";
import { isCoachingOnlyPath, isLapsedMemberPath, useServiceTier } from "@/lib/service-tier";
import { useGoalsServiceScope } from "@/lib/client-goals/use-goals-service-scope";
import { useMemberAccess } from "@/lib/member-access";
import { MemberSetupGate } from "@/components/member/member-setup-gate";
import { MemberAgreementGate } from "@/components/member/member-agreement";
import { SubscriptionRestrictedBanner } from "@/components/subscription-restricted-banner";
import { ClientPovBanner, PovFrame } from "@/components/client-pov-banner";
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat";
import { ClientBirthdayCard } from "@/components/client-birthday-card";
import { HomeScreenSetupGate } from "@/components/home-screen-setup-gate";
import { FormPopupGate } from "@/components/form-popup-gate";
import { LegalAcceptanceGate } from "@/components/legal/legal-acceptance-gate";
import { LeagueRecapGate } from "@/components/portal/league-recap";
import { WeightUnitPrompt } from "@/components/portal/weight-unit-prompt";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { useWarmClientPages } from "@/lib/portal-page-queries";
import { useCommunityActivity } from "@/lib/community.queries";
import { AiCreditsReturn } from "@/components/ai-credits/ai-credits";
import { MembershipPendingGate } from "@/components/member/membership-pending-gate";
import { TutorialGate } from "@/components/tutorials/tutorials";
import { navForShell, useNativeShell } from "@/lib/native-purchases";
import { isNative } from "@/platform";

const CREW_OWN_BAR = ["/portal/community"] as const;

function PortalLayout() {
  const { isImpersonating } = useClientImpersonation();
  const { isSelfServe, loading, noAccount, tier } = useServiceTier();
  if (isImpersonating) return <PortalContent />;
  if (loading || (!tier && !noAccount)) return <AgreementAccessScreen checking={loading} retry={() => window.location.reload()} />;
  if (noAccount) return <MembershipPendingGate />;
  return (
    <LegalAcceptanceGate>
      {isSelfServe ? <MemberAgreementGate><PortalContent /></MemberAgreementGate> : <PortalContent />}
    </LegalAcceptanceGate>
  );
}

function PortalContent() {
  useActivityHeartbeat();
  const { isImpersonating } = useClientImpersonation();
  // Coaching client or JF member: one portal, the coach's screens only for coaching.
  const { isSelfServe, loading: tierLoading, noAccount, clientId } = useServiceTier();
  const serviceScope = useGoalsServiceScope(isSelfServe ? clientId : null);
  const hasHandling = serviceScope.handlingMeets.length > 0;
  const memberItems = hasHandling ? [...selfServeNav.slice(0, 2), ...clientNav.filter(i => i.to === "/portal/competition"), ...selfServeNav.slice(2)] : selfServeNav;
  // Workouts and Nutrition open from the cache: their data is fetched once the app has painted.
  const portalUserId = usePortalUserId();
  useWarmClientPages({ portalUserId, enabled: !isImpersonating && !tierLoading, nutrition: !isSelfServe });
  // No community for this account (not an active client): no centre button.
  const { data: community } = useCommunityActivity(true);
  // the iPhone app's menu has no billing or purchase pages (native-purchases.ts)
  const native = useNativeShell();
  const bottomNav = useMemo(() => {
    const base = isSelfServe ? selfServeBottomNav : clientBottomNav;
    return community?.enabled === false ? base.filter((i) => i.to !== "/portal/community") : base;
  }, [community?.enabled, isSelfServe]);
  // a login with no membership (not approved yet): where they stand, never empty screens
  if (noAccount) return <MembershipPendingGate />;
  return (
    <>
      <PovFrame />
      <ClientPovBanner />
      {/* Crew draws its own top bar (+ · JF Effect · heart · you), for a coach viewing as a client too (under the banner) */}
      <AppShell items={navForShell(isSelfServe ? memberItems : clientNav, native)} bottomItems={bottomNav} title="JF Effect" moreInHeader simpleHeader ownTopBarOn={CREW_OWN_BAR}>
        {isSelfServe && <MemberGates hasHandling={hasHandling} scopeReady={serviceScope.ready} />}
        {/* Onboarding requirements (profile photo, basic info, training schedule,
            Goals & Setup) are surfaced as a non-blocking checklist on the Home
            page — they must never lock the portal. See
            <SetupChecklistBanner /> in /portal/index.tsx. */}
        <Outlet />
        {/* Popup gates run off the signed-in session, so in coach "View as
            client" they'd show the coach's own popups/legal status — skip. */}
        {!isImpersonating && (
          <>
            <FormPopupGate />
            <HomeScreenSetupGate />
            {/* a screen's short tutorial on its first visit, once (server-side), and the hub's replays */}
            <TutorialGate />
            {/* lb or kg, asked until answered (lb meanwhile). */}
            <WeightUnitPrompt />
            {/* back from buying AI credits: add them now and say so */}
            <AiCreditsReturn />
          </>
        )}
        {/* Previous month's League Recap — first week of each month, once. */}
        <LeagueRecapGate />
        {/* Birthday card mounts LAST so its dialog stacks above other portal
            gates (setup prompts, event/form popups). */}
        <ClientBirthdayCard />
      </AppShell>
    </>
  );
}

/**
 * A JF member in the portal: the coach's screens send them home; a lapsed
 * membership opens Membership (billing, account, support stay reachable),
 * with the status banner; first-time setup as before.
 */
function MemberGates({ hasHandling, scopeReady }: { hasHandling: boolean; scopeReady: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  const { loading, hasAccess, accountType, status, subscriptionStatus } = useMemberAccess();
  const lapsed = !loading && accountType === "jf_member" && !hasAccess("app_membership");
  useEffect(() => {
    if (isCoachingOnlyPath(pathname) && !(pathname === "/portal/goals-setup" && hasHandling)) {
      if (pathname !== "/portal/goals-setup" || scopeReady) navigate({ to: "/portal", replace: true });
    }
    // the iPhone app opens no billing page: a lapsed member lands on Account there (native-purchases.ts)
    else if (scopeReady && lapsed && !isImpersonating && !isLapsedMemberPath(pathname) && !(hasHandling && (pathname === "/portal" || pathname === "/portal/competition" || pathname === "/portal/goals-setup")))
      navigate({ to: (isNative() ? "/portal/account" : "/portal/membership") as any, replace: true });
  }, [pathname, lapsed, isImpersonating, navigate, hasHandling, scopeReady]);
  return (
    <>
      {lapsed && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <SubscriptionRestrictedBanner status={status} subscriptionStatus={subscriptionStatus} />
        </div>
      )}
      {!isImpersonating && <MemberSetupGate />}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalLayout,
});