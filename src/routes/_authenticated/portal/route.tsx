import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { clientNav, clientBottomNav, selfServeNav, selfServeBottomNav } from "@/lib/admin-nav";
import { isCoachingOnlyPath, isLapsedMemberPath, useServiceTier } from "@/lib/service-tier";
import { useMemberAccess } from "@/lib/member-access";
import { MemberSetupGate } from "@/components/member/member-setup-gate";
import { MemberAgreementGate } from "@/components/member/member-agreement";
import { SubscriptionRestrictedBanner } from "@/components/subscription-restricted-banner";
import { ClientPovBanner, PovFrame } from "@/components/client-pov-banner";
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat";
import { BroadcastPopupGate } from "@/components/broadcast-popup-gate";
import { ClientBirthdayCard } from "@/components/client-birthday-card";
import { EventPopupGate } from "@/components/events/event-popup-gate";
import { HomeScreenSetupGate } from "@/components/home-screen-setup-gate";
import { FormPopupGate } from "@/components/form-popup-gate";
import { LegalAcceptanceGate } from "@/components/legal/legal-acceptance-gate";
import { LeagueRecapGate } from "@/components/portal/league-recap";
import { WeightUnitPrompt } from "@/components/portal/weight-unit-prompt";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useCommunityActivity } from "@/lib/community.queries";

const CREW_OWN_BAR = ["/portal/community"] as const;

function PortalLayout() {
  useActivityHeartbeat();
  const { isImpersonating } = useClientImpersonation();
  // Coaching client or JF member: one portal, the coach's screens only for coaching.
  const { isSelfServe } = useServiceTier();
  // No community for this account (not an active client): no centre button.
  const { data: community } = useCommunityActivity(true);
  const bottomNav = useMemo(() => {
    const base = isSelfServe ? selfServeBottomNav : clientBottomNav;
    return community?.enabled === false ? base.filter((i) => i.to !== "/portal/community") : base;
  }, [community?.enabled, isSelfServe]);
  return (
    <>
      <PovFrame />
      <ClientPovBanner />
      {/* Crew draws its own top bar (+ · JF Effect · heart · you), for a coach viewing as a client too (under the banner) */}
      <AppShell items={isSelfServe ? selfServeNav : clientNav} bottomItems={bottomNav} title="JF Effect" moreInHeader simpleHeader ownTopBarOn={CREW_OWN_BAR}>
        {isSelfServe && <MemberGates />}
        {/* Onboarding requirements (profile photo, basic info, training schedule,
            Goals & Setup) are surfaced as a non-blocking checklist on the Home
            page — they must never lock the portal. See
            <SetupChecklistBanner /> in /portal/index.tsx. */}
        <Outlet />
        {/* Popup gates run off the signed-in session, so in coach "View as
            client" they'd show the coach's own popups/legal status — skip. */}
        {!isImpersonating && (
          <>
            <BroadcastPopupGate />
            <EventPopupGate />
            <FormPopupGate />
            <HomeScreenSetupGate />
            <LegalAcceptanceGate />
            {/* lb or kg, asked until answered (lb meanwhile). */}
            <WeightUnitPrompt />
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
function MemberGates() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  const { loading, hasAccess, accountType, status, subscriptionStatus } = useMemberAccess();
  const lapsed = !loading && accountType === "jf_member" && !hasAccess("app_membership");
  useEffect(() => {
    if (isCoachingOnlyPath(pathname)) navigate({ to: "/portal", replace: true });
    else if (lapsed && !isImpersonating && !isLapsedMemberPath(pathname)) navigate({ to: "/portal/membership" as any, replace: true });
  }, [pathname, lapsed, isImpersonating, navigate]);
  return (
    <>
      {lapsed && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <SubscriptionRestrictedBanner status={status} subscriptionStatus={subscriptionStatus} />
        </div>
      )}
      {!isImpersonating && <MemberSetupGate />}
      {/* the Membership Agreement, asked once per launch until accepted */}
      {!isImpersonating && <MemberAgreementGate />}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/portal")({
  component: PortalLayout,
});