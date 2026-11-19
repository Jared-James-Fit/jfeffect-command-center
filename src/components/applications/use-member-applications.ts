import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getJoinFunnel, listMemberApplications, type JoinFunnel, type MemberApplicationsList } from "@/lib/membership-applications.functions";
import { awaitingActivation, needsDecision, needsFirstReply, sortForReview } from "@/lib/membership-apply";

export const MEMBER_APPLICATIONS_KEY = ["member-applications"] as const;

/** One read for the Applications screen, the Messages row and Home's card (admin only). */
export function useMemberApplications() {
  const { role } = useAuth();
  const list = useServerFn(listMemberApplications);
  const query = useQuery<MemberApplicationsList>({
    queryKey: MEMBER_APPLICATIONS_KEY,
    queryFn: () => list(),
    enabled: role === "admin",
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const all = sortForReview(query.data?.applications ?? []);
  return {
    ...query,
    enabled: role === "admin",
    all,
    pending: all.filter(needsDecision),
    firstReply: all.filter(needsFirstReply),
    invited: all.filter(awaitingActivation),
    done: all.filter((a) => !needsDecision(a) && !awaitingActivation(a)),
  };
}

export function useJoinFunnel(days: number, enabled = true) {
  const { role } = useAuth();
  const get = useServerFn(getJoinFunnel);
  return useQuery<JoinFunnel>({
    queryKey: ["join-funnel", days],
    queryFn: () => get({ data: { days } }),
    enabled: enabled && role === "admin",
    staleTime: 60_000,
  });
}
