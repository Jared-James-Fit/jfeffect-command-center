/**
 * Program Intelligence data on the coach's page: the records (read with the
 * coach's own session, so the database decides access), the report built from
 * them on the phone, the brain override, the athlete's memory and AI runs.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadIntelRecords } from "@/lib/program-intel/load";
import { buildIntelReport } from "@/lib/program-intel/report";
import type { Brain, Finding, IntelRecords, IntelReport, IntelScopeRequest, ObservationStatus, RawObservation } from "@/lib/program-intel/types";

const sb = supabase as any;

export function scopeKey(s: IntelScopeRequest): string {
  return s.kind === "dates" ? `dates:${s.from}:${s.to}` : s.kind === "blocks" ? `blocks:${s.blockIds.join(",")}` : s.kind;
}

export function useIntelRecords(clientId: string, scope: IntelScopeRequest) {
  return useQuery<IntelRecords>({
    queryKey: ["program-intel-records", clientId, scopeKey(scope)],
    queryFn: () => loadIntelRecords(sb, clientId, scope),
    staleTime: 60_000,
    enabled: !!clientId && (scope.kind !== "dates" || (!!scope.from && !!scope.to && scope.from <= scope.to)),
  });
}

export function useBrainOverride(clientId: string) {
  const qc = useQueryClient();
  const q = useQuery<Brain | null>({
    queryKey: ["program-intel-profile", clientId],
    queryFn: async () => {
      const { data, error } = await sb.from("program_intel_profiles").select("brain_override").eq("client_id", clientId).maybeSingle();
      if (error) return null;
      return (data?.brain_override as Brain | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const set = useMutation({
    mutationFn: async (brain: Brain | null) => {
      const { error } = await sb.from("program_intel_profiles").upsert({ client_id: clientId, brain_override: brain }, { onConflict: "client_id" });
      if (error) throw new Error(error.message);
      return brain;
    },
    onSuccess: (brain) => qc.setQueryData(["program-intel-profile", clientId], brain),
  });
  return { override: q.data ?? null, loading: q.isLoading, set };
}

export function useIntelReport(records: IntelRecords | undefined, override: Brain | null): IntelReport | null {
  return useMemo(() => (records ? buildIntelReport(records, { brainOverride: override }) : null), [records, override]);
}

export function useObservations(clientId: string) {
  return useQuery<RawObservation[]>({
    queryKey: ["program-intel-observations", clientId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("program_intel_observations")
        .select("id, kind, category, statement, corrected_statement, confidence, status, source, evidence, block_id, decision_id, created_at, reviewed_at, finding_key, job_id")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as RawObservation[];
    },
    staleTime: 30_000,
  });
}

export function useReviewObservation(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (x: { id: string; status: ObservationStatus; corrected?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await sb
        .from("program_intel_observations")
        .update({ status: x.status, corrected_statement: x.status === "corrected" ? (x.corrected ?? null) : null, reviewed_by: auth.user?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", x.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
      void qc.invalidateQueries({ queryKey: ["program-intel-records", clientId] });
    },
  });
}

/** Keep a finding (or the coach's own note) in the athlete's memory. */
export function useSaveObservation(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (x: { finding?: Finding; statement?: string; confidence?: "fact" | "hypothesis"; category?: string | null; dataHash?: string | null }) => {
      const row = x.finding
        ? {
            client_id: clientId,
            kind: "observation",
            category: x.finding.subject.slice(0, 60),
            statement: `${x.finding.title}. ${x.finding.detail}`.slice(0, 1000),
            confidence: x.finding.kind === "fact" ? "fact" : "hypothesis",
            status: "approved",
            source: "analysis",
            evidence: x.finding.evidence,
            finding_key: x.finding.id,
            data_hash: x.dataHash ?? null,
          }
        : {
            client_id: clientId,
            kind: "observation",
            category: x.category ?? "coach",
            statement: (x.statement ?? "").trim().slice(0, 1000),
            confidence: x.confidence ?? "hypothesis",
            status: "approved",
            source: "coach",
            evidence: [],
          };
      const { error } = await sb.from("program_intel_observations").insert(row);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
      void qc.invalidateQueries({ queryKey: ["program-intel-records", clientId] });
    },
  });
}

export type IntelJob = {
  id: string;
  kind: "interpret" | "generate";
  status: "pending" | "running" | "ready" | "error" | "discarded" | "assigned";
  brain: Brain;
  scope: IntelScopeRequest;
  instructions: string | null;
  options: Record<string, unknown>;
  result: any;
  block_id: string | null;
  error: string | null;
  model: string | null;
  data_hash: string | null;
  created_at: string;
  finished_at: string | null;
};

export function useIntelJobs(clientId: string) {
  return useQuery<IntelJob[]>({
    queryKey: ["program-intel-jobs", clientId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("program_intel_jobs")
        .select("id, kind, status, brain, scope, instructions, options, result, block_id, error, model, data_hash, created_at, finished_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as IntelJob[];
    },
    // while anything is being written, look again every few seconds
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => j.status === "pending" || j.status === "running") ? 4000 : false),
  });
}

/** An export or copy, logged so every report can be traced (fire and forget). */
export function logIntelExport(x: { id: string; clientId: string; action: string; privacySafe: boolean; scope: unknown; brain: string; dataHash: string }) {
  void sb
    .from("program_intel_exports")
    .insert({ id: x.id, client_id: x.clientId, action: x.action, privacy_safe: x.privacySafe, scope: x.scope, brain: x.brain, data_hash: x.dataHash })
    .then(() => undefined, () => undefined);
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }
}
