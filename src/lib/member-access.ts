import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { isSubscriptionActive, type AccountType } from "@/lib/membership";

export type MemberAccessSummary = {
  loading: boolean;
  member: any | null;
  accountType: AccountType | null;
  status: string | null;
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
  const subscriptionActive = isSubscriptionActive(member?.status);
  return {
    loading: isLoading,
    member,
    accountType: (member?.account_type ?? null) as AccountType | null,
    status: member?.status ?? null,
    subscriptionActive,
    granted,
    hasAccess: (key: string) => subscriptionActive && granted.has(key),
  };
}