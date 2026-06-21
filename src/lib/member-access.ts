import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { isSubscriptionActive, type AccountType } from "@/lib/membership";
import { isMemberAccessActive } from "@/lib/memberAccess";

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

  // Use the canonical access helper as the single source of truth.
  // isMemberAccessActive respects: kill switch, manual override, grace period,
  // hard expiry date, and subscription status — in that priority order.
  const canonicalAccess = isMemberAccessActive(member);

  // subscriptionActive is kept for backwards-compat with components that read it,
  // but hasAccess now uses the canonical helper.
  const subscriptionActive = isSubscriptionActive(member?.status);

  return {
    loading: isLoading,
    member,
    accountType: (member?.account_type ?? null) as AccountType | null,
    status: member?.status ?? null,
    subscriptionStatus: member?.subscription_status ?? null,
    subscriptionActive,
    granted,
    // Canonical access: respects manual overrides, grace periods, hard expiry.
    // Manual override grants every key; otherwise require canonical access AND
    // a matching granted access level.
    hasAccess: (key: string) => {
      if (!canonicalAccess) return false;
      // If admin manually overrode access, grant all keys without checking rows.
      if (member?.manual_access_override === true && member?.manual_access_disabled !== true) return true;
      return granted.has(key);
    },
  };
}
