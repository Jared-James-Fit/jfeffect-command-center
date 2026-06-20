import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { isSubscriptionActive, type AccountType } from "@/lib/membership";

export type MemberAccessSummary = {
  loading: boolean;
  member: any | null;
  accountType: AccountType | null;
  status: string | null;
  subscriptionStatus: string | null;
  subscriptionActive: boolean;
  granted: Set<string>;
  hasAccess: (key: string) => boolean;
};

export function useMemberAccess(): MemberAccessSummary {
  const fn = useServerFn(getCurrentMember);
  const { data, isLoading } = useQuery({
    queryKey: ["current-member-access"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const member = data?.member ?? null;
  const access = data?.access ?? [];
  const now = Date.now();
  const granted = new Set<string>(
    (access as any[])
      .filter((a) => a.active && (!a.expires_at || Date.parse(a.expires_at) > now))
      .map((a) => a.access_level_key as string),
  );
  // Admin manual override: kill switch wins, then override grants access
  // regardless of Stripe/subscription status.
  const manualDisabled = member?.manual_access_disabled === true;
  const manualOverride = member?.manual_access_override === true && !manualDisabled;
  const subscriptionActive = !manualDisabled
    && (manualOverride || isSubscriptionActive(member?.status));
  return {
    loading: isLoading,
    member,
    accountType: (member?.account_type ?? null) as AccountType | null,
    status: member?.status ?? null,
    subscriptionStatus: member?.subscription_status ?? null,
    subscriptionActive,
    granted,
    // Manual override grants every access key (admin has explicitly enabled
    // access regardless of Stripe). Otherwise require an active subscription
    // AND a matching granted access level.
    hasAccess: (key: string) =>
      !manualDisabled && (manualOverride || (subscriptionActive && granted.has(key))),
  };
}