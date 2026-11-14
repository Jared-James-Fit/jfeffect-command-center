import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { authorHandle, useProgram } from "@/lib/athlete-programs";
import {
  programOwnership,
  originLabel,
  type EndFacts,
  type ProgramOwnership,
} from "@/lib/my-program";
import { useClientVisibleBlocks, useProgramRoadmap } from "@/components/workouts/program-roadmap";
import type { ProgramRoadmap } from "@/lib/training-roadmap";

const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

export type ProgramOriginInfo = ProgramOwnership & {
  /** "JF Effect plan", "Built by you", "Your copy of @jane's program" */
  label: string;
  /** the JF Effect plan it was started from (to open its page) */
  planId: string | null;
  /** the member's own program it was started from, while it still exists (to edit it) */
  programId: string | null;
};

/**
 * Where the program the roadmap shows came from, and whether the signed-in
 * member may manage it (they own every block of it). Reads the plan or the
 * program it was started from, each once.
 */
export function useProgramOrigin(
  roadmap: ProgramRoadmap | null,
  blocks: any[] | undefined,
  userId: string | null | undefined,
): ProgramOriginInfo {
  const blockIds = useMemo(() => roadmap?.blocks.map((b) => b.id) ?? [], [roadmap]);
  const own = useMemo(
    () => programOwnership(blocks ?? [], blockIds, userId),
    [blocks, blockIds, userId],
  );
  const templateId = own.origin.kind === "jf" ? own.origin.templateId : null;
  const programId = own.origin.kind === "own" ? own.origin.programId : null;

  const { data: plan } = useQuery({
    queryKey: ["member-plan-by-template", templateId],
    enabled: !!templateId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plans")
        .select("id, name, public_title")
        .eq("source_template_id", templateId!)
        .eq("status", "Published")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as { id: string; name: string; public_title: string | null } | null;
    },
  });
  const { data: program } = useProgram(programId);

  return {
    ...own,
    label: originLabel(own.origin.kind, {
      copiedFrom: program?.forked_from?.author ? authorHandle(program.forked_from.author) : null,
    }),
    planId: plan?.id ?? null,
    programId: program?.is_mine ? program.id : null,
  };
}

/** The member's own program on their calendar, as the roadmap reads it (the Programs hub). */
export function useMyCurrentProgram(
  clientId: string | null | undefined,
  userId: string | null | undefined,
) {
  const { data: blocks, isLoading } = useClientVisibleBlocks(clientId ?? "");
  const roadmap = useProgramRoadmap(clientId ?? "", blocks);
  const origin = useProgramOrigin(roadmap, blocks, userId);
  return { roadmap, origin, isLoading: !!clientId && isLoading };
}

/**
 * End a program (member_program_end): `preview` says what will happen, `end`
 * does it. Ending touches the calendar, today, Home and analytics, so every
 * query refreshes after.
 */
export function useEndProgram() {
  const qc = useQueryClient();
  const preview = useMutation({
    mutationFn: async (blockId: string): Promise<EndFacts> => {
      const { data, error } = await rpc("member_program_end", {
        _block_id: blockId,
        _confirm: false,
      });
      if (error) throw error;
      return data as EndFacts;
    },
  });
  const end = useMutation({
    mutationFn: async (blockId: string): Promise<EndFacts> => {
      const { data, error } = await rpc("member_program_end", {
        _block_id: blockId,
        _confirm: true,
      });
      if (error) throw error;
      return data as EndFacts;
    },
    // the ended program's days leave the list at once (its placeholder, then
    // what's left), never shown as still on the calendar while it refetches
    onSuccess: () => {
      void qc.resetQueries({ queryKey: ["my-workouts"] });
      void qc.invalidateQueries();
    },
  });
  return { preview, end };
}
