import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import {
  getJoinFunnel,
  listMemberApplications,
  type JoinFunnel,
  type MemberApplicationsList,
} from "@/lib/membership-applications.functions";
import {
  awaitingActivation,
  needsDecision,
  needsFirstReply,
  sortForReview,
  type MemberApplication,
} from "@/lib/membership-apply";
import { NO_FACTS, lifecycleGroup, lifecycleStage, type ApplicantFacts } from "@/lib/applications/lifecycle";

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
  const facts = query.data?.facts ?? {};
  const factsFor = (id: string): ApplicantFacts => facts[id] ?? NO_FACTS;
  // where each one is on the path (lifecycle.ts), from what happened
  const stageOf = (a: MemberApplication) => lifecycleStage(a, factsFor(a.id));
  const group = (a: MemberApplication) => lifecycleGroup(stageOf(a));
  const live = all.filter((a) => !a.archived_at);
  return {
    ...query,
    enabled: role === "admin",
    all,
    factsFor,
    stageOf,
    pending: live.filter(needsDecision),
    firstReply: live.filter(needsFirstReply),
    invited: live.filter((a) => awaitingActivation(a) && group(a) === "invited"),
    /** In the app, not training yet: setup (Onboarding) or no first workout (Ready to start). */
    starting: live.filter((a) => group(a) === "starting"),
    done: all.filter((a) => group(a) === "earlier"),
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
