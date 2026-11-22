/**
 * The roadmap's queries, shared by the athlete's card, the coach's card and
 * the dashboard, so a decision in one refreshes the others.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { getClientRoadmapFn, getMyRoadmapFn, roadmapBoardFn } from "@/lib/nutrition-roadmap/roadmap.functions";
import type { BoardRow, CoachRoadmapView, RoadmapView } from "@/lib/nutrition-roadmap/view";

export const myRoadmapKey = (viewAs: string | null) => ["nutrition-roadmap", "me", viewAs ?? "self"] as const;
export const clientRoadmapKey = (clientId: string) => ["nutrition-roadmap", "client", clientId] as const;
export const roadmapBoardKey = ["nutrition-roadmap", "board"] as const;
/** Every roadmap query (invalidate after any decision). */
export const ROADMAP_ROOT = ["nutrition-roadmap"] as const;

export function useMyRoadmap() {
  const read = useServerFn(getMyRoadmapFn);
  const { client } = useClientImpersonation();
  const viewAs = client?.user_id ?? null;
  return useQuery({
    queryKey: myRoadmapKey(viewAs),
    queryFn: () => read({ data: viewAs ? { viewAsUserId: viewAs } : {} }) as Promise<RoadmapView | null>,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useClientRoadmap(clientId: string) {
  const read = useServerFn(getClientRoadmapFn);
  return useQuery({
    queryKey: clientRoadmapKey(clientId),
    queryFn: () => read({ data: { clientId } }) as Promise<CoachRoadmapView>,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useRoadmapBoard() {
  const read = useServerFn(roadmapBoardFn);
  return useQuery({ queryKey: roadmapBoardKey, queryFn: () => read() as Promise<BoardRow[]>, staleTime: 5 * 60_000, retry: 1 });
}
