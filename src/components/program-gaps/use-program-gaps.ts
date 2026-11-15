import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { buildProgramGaps, EMPTY_PROGRAM_GAPS, type ClientProgramGaps, type ProgramGapsData } from "@/lib/program-gaps";

/** Every read of missing program data starts with this key: invalidate it after editing a program. */
export const PROGRAM_GAPS_KEY = ["program-gaps"] as const;

/**
 * Missing program data for the signed-in coach's clients (an admin: every
 * coaching client), or one client's: one database read (`program_gaps`),
 * decided by program-gaps.ts. Messages, the Brief, the Training tab and the
 * Missing program data page all read it, so they always agree.
 */
export function useProgramGaps({ clientId = null, enabled = true, fresh = false }: { clientId?: string | null; enabled?: boolean; fresh?: boolean } = {}) {
  const { role } = useAuth();
  const allowed = role === "admin" || role === "coach";
  const query = useQuery({
    queryKey: [...PROGRAM_GAPS_KEY, clientId ?? "all"],
    enabled: enabled && allowed,
    staleTime: fresh ? 0 : 60_000,
    refetchOnMount: fresh ? "always" : true,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ClientProgramGaps[]> => {
      const { data, error } = await (supabase as any).rpc("program_gaps", clientId ? { _client: clientId } : {});
      if (error) throw error;
      return buildProgramGaps((data as ProgramGapsData | null) ?? EMPTY_PROGRAM_GAPS);
    },
  });
  const byClient = useMemo(() => new Map((query.data ?? []).map((g) => [g.clientId, g])), [query.data]);
  return { ...query, gaps: query.data ?? [], byClient, allowed };
}
