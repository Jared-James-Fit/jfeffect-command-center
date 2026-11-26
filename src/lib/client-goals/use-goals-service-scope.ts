import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGoalsServiceScopeFn } from "./goals.functions";

/** One authenticated package read shared across the portal's onboarding surfaces. */
export function useGoalsServiceScope(clientId: string | undefined | null) {
  const read = useServerFn(getGoalsServiceScopeFn);
  const q = useQuery({
    queryKey: ["goals-service-scope", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => read({ data: { clientId: clientId! } }),
  });
  return { membership: q.data?.membership, requirements: q.data?.requirements, nutritionOnly: q.data?.nutritionOnly === true, handlingMeets: q.data?.handlingMeets ?? [], ready: !!q.data, error: q.isError, retry: q.refetch };
}
