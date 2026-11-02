/**
 * Program Intelligence data on the coach's page: the records (read with the
 * coach's own session, so the database decides access), the report built from
 * them on the phone, the brain override, the athlete's memory and AI runs.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildGeneratorIntel, type GeneratorIntel } from "@/lib/program-intel/intelligence";
import { loadIntelRecords } from "@/lib/program-intel/load";
import { buildIntelReport } from "@/lib/program-intel/report";
import type { Brain, EquipmentProfile, Finding, IntelRecords, IntelReport, IntelScopeRequest, ObservationKind, ObservationStatus, RawObservation } from "@/lib/program-intel/types";

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
  kind: "interpret" | "strategy" | "generate";
  stage?: string | null;
  progress?: { stages: Array<{ key: string; label: string; status: "pending" | "running" | "done" | "skipped" | "error"; detail?: string }>; current: string | null } | null;
  strategy_job_id?: string | null;
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
        .select("id, kind, status, stage, progress, strategy_job_id, brain, scope, instructions, options, result, block_id, error, model, data_hash, created_at, finished_at")
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

/** Everything Generate Next Program knows, built on the phone from the full history (instant; the worker rebuilds the same). */
export function useGeneratorIntel(records: IntelRecords | undefined, override: Brain | null): GeneratorIntel | null {
  return useMemo(() => (records ? buildGeneratorIntel(records, { brainOverride: override }) : null), [records, override]);
}

/** The equipment the coach confirmed for this client (persisted; the generator treats it as authoritative). */
export function useSaveEquipmentProfile(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profile: EquipmentProfile | null) => {
      const { error } = await sb.from("program_intel_profiles").upsert({ client_id: clientId, equipment_profile: profile ? { ...profile, confirmedAt: new Date().toISOString() } : null }, { onConflict: "client_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["program-intel-records", clientId] });
    },
  });
}

/** A run's snapshot (setup, brief, sources, model) for the strategy review and the context inspector. */
export function useJobContext(jobId: string | null) {
  return useQuery<any>({
    queryKey: ["program-intel-job-context", jobId],
    enabled: !!jobId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("program_intel_jobs").select("id, context").eq("id", jobId).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.context ?? null;
    },
  });
}

export type JobCall = { id: string; stage: string; model: string; prompt_chars: number; response_chars: number; est_input_tokens: number | null; input_tokens: number | null; output_tokens: number | null; duration_ms: number | null; ok: boolean; error: string | null; created_at: string };
export function useJobCalls(jobIds: string[]) {
  return useQuery<JobCall[]>({
    queryKey: ["program-intel-job-calls", jobIds.join(",")],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from("program_intel_job_calls")
        .select("id, stage, model, prompt_chars, response_chars, est_input_tokens, input_tokens, output_tokens, duration_ms, ok, error, created_at")
        .in("job_id", jobIds)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as JobCall[];
    },
  });
}

/** One call's exact prompt and reply (loaded only when the coach opens it). */
export async function fetchJobCallText(id: string): Promise<{ system_prompt: string; prompt: string; response: string | null } | null> {
  const { data } = await sb.from("program_intel_job_calls").select("system_prompt, prompt, response").eq("id", id).maybeSingle();
  return data ?? null;
}

/** Confirm or dismiss what came of a generated program (stored as an outcome observation). */
export function useRecordOutcome(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (x: { key: string; statement: string; evidence: string[]; confidence: "fact" | "hypothesis"; status: ObservationStatus; kind?: ObservationKind; blockId?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await sb.from("program_intel_observations").insert({
        client_id: clientId,
        kind: x.kind ?? "outcome",
        category: "outcome",
        statement: x.statement.slice(0, 1000),
        confidence: x.confidence,
        status: x.status,
        source: "analysis",
        evidence: x.evidence,
        finding_key: x.key.slice(0, 200),
        block_id: x.blockId ?? null,
        reviewed_by: auth.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["program-intel-observations", clientId] });
      void qc.invalidateQueries({ queryKey: ["program-intel-records", clientId] });
    },
  });
}
