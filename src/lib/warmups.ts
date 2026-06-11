import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export type WarmupItem = {
  name: string;
  sets?: string;
  reps?: string;
  notes?: string;
};

export type WarmupSection = {
  title: string;
  items: WarmupItem[];
};

export type WarmupProtocol = {
  id: string;
  name: string;
  category: string;
  target_lift?: string | null;
  estimated_minutes?: number | null;
  sections: WarmupSection[];
  notes?: string | null;
  internal_notes?: string | null;
  visible_to_client: boolean;
  is_default_general: boolean;
  is_default_powerlifting: boolean;
  archived: boolean;
};

export type PlLiftGroup = "squat" | "bench" | "deadlift";

/**
 * Heuristic powerlifting lift detection by exercise name.
 * Used as the fallback when exercises.pl_lift_group isn't set yet.
 */
export function detectLiftGroup(name: string): PlLiftGroup | null {
  const n = (name || "").toLowerCase();
  if (/\bbench\b|larsen|spoto|press[- ]?around|close[- ]?grip/.test(n) && !/\bleg press|overhead\b/.test(n)) return "bench";
  if (/\bdeadlift|deficit pull|block pull|rack pull|sumo\b/.test(n)) return "deadlift";
  if (/\bsquat\b|pin squat|pause squat|tempo squat|high[- ]?bar|low[- ]?bar/.test(n)) return "squat";
  return null;
}

export function detectLiftsInWorkout(
  rows: Array<{ exercises?: { name?: string | null; pl_lift_group?: string | null } | null }>,
): Set<PlLiftGroup> {
  const out = new Set<PlLiftGroup>();
  for (const r of rows) {
    const ex = r.exercises;
    if (!ex) continue;
    const tag = (ex.pl_lift_group as PlLiftGroup | null) ?? detectLiftGroup(ex.name || "");
    if (tag) out.add(tag);
  }
  return out;
}

const SECTION_BY_LIFT: Record<PlLiftGroup, string> = {
  squat: "Pre-Squat / Legs",
  bench: "Pre-Bench / Push",
  deadlift: "Pre-Deadlift / Pull",
};

/** Filter SBD template sections to only those relevant to the workout's lifts. */
export function filterPowerliftingSections(
  protocol: WarmupProtocol,
  lifts: Set<PlLiftGroup>,
): WarmupSection[] {
  if (lifts.size === 0) return protocol.sections;
  const wantedTitles = new Set<string>([
    "Before Session",
    "End of Session",
    ...[...lifts].map((l) => SECTION_BY_LIFT[l]),
  ]);
  const kept = protocol.sections.filter((s) => wantedTitles.has(s.title));
  return kept.length ? kept : protocol.sections;
}

/**
 * Resolve which warm-up protocol applies for a given workout day.
 * Priority: client > block > pl_day override > exercise > default (auto pl/general).
 */
export async function resolveWarmupForDay(opts: {
  dayId: string;
  blockId: string | null;
  clientId: string;
  warmupMode?: string | null;
  dayProtocolId?: string | null;
  exerciseRows: Array<{ exercise_id?: string | null; exercises?: { name?: string | null; pl_lift_group?: string | null; warmup_protocol_id?: string | null } | null }>;
}): Promise<{ protocol: WarmupProtocol | null; lifts: Set<PlLiftGroup>; source: string }> {
  const lifts = detectLiftsInWorkout(opts.exerciseRows);

  if (opts.warmupMode === "none") {
    return { protocol: null, lifts, source: "none" };
  }

  // 1) Client-specific (highest priority)
  const { data: client } = await sb
    .from("clients")
    .select("warmup_protocol_id")
    .eq("id", opts.clientId)
    .maybeSingle();
  if (client?.warmup_protocol_id) {
    const p = await fetchProtocol(client.warmup_protocol_id);
    if (p) return { protocol: p, lifts, source: "client" };
  }

  // 2) Block-specific
  if (opts.blockId) {
    const { data: block } = await sb
      .from("pl_blocks")
      .select("warmup_protocol_id")
      .eq("id", opts.blockId)
      .maybeSingle();
    if (block?.warmup_protocol_id) {
      const p = await fetchProtocol(block.warmup_protocol_id);
      if (p) return { protocol: p, lifts, source: "block" };
    }
  }

  // 3) Per-day overrides
  if (opts.warmupMode === "custom" && opts.dayProtocolId) {
    const p = await fetchProtocol(opts.dayProtocolId);
    if (p) return { protocol: p, lifts, source: "day" };
  }
  if (opts.warmupMode === "general" || opts.warmupMode === "powerlifting") {
    const p = await fetchDefault(opts.warmupMode === "powerlifting" ? "pl" : "general");
    if (p) return { protocol: p, lifts, source: "day-mode" };
  }

  // 4) Exercise-specific (first exercise with a custom protocol wins)
  for (const r of opts.exerciseRows) {
    const pid = r.exercises?.warmup_protocol_id;
    if (pid) {
      const p = await fetchProtocol(pid);
      if (p) return { protocol: p, lifts, source: "exercise" };
    }
  }

  // 5) Default — auto-detect from lifts → PL default, else general
  if (lifts.size > 0) {
    const p = await fetchDefault("pl");
    if (p) return { protocol: p, lifts, source: "auto-pl" };
  }
  const p = await fetchDefault("general");
  return { protocol: p, lifts, source: "auto-general" };
}

async function fetchProtocol(id: string): Promise<WarmupProtocol | null> {
  const { data } = await sb.from("warmup_protocols").select("*").eq("id", id).eq("archived", false).maybeSingle();
  if (!data) return null;
  return normalize(data);
}

async function fetchDefault(kind: "general" | "pl"): Promise<WarmupProtocol | null> {
  const col = kind === "pl" ? "is_default_powerlifting" : "is_default_general";
  const { data } = await sb
    .from("warmup_protocols")
    .select("*")
    .eq(col, true)
    .eq("archived", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return normalize(data);
}

function normalize(row: any): WarmupProtocol {
  let sections: WarmupSection[] = [];
  try {
    sections = Array.isArray(row.sections) ? row.sections : JSON.parse(row.sections || "[]");
  } catch {
    sections = [];
  }
  return { ...row, sections } as WarmupProtocol;
}

export async function listWarmupProtocols(opts: { includeArchived?: boolean } = {}): Promise<WarmupProtocol[]> {
  let q = sb.from("warmup_protocols").select("*").order("name");
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data } = await q;
  return (data ?? []).map(normalize);
}

export const WARMUP_CATEGORIES = [
  { value: "general", label: "General Warm-Up" },
  { value: "squat", label: "Squat Warm-Up" },
  { value: "bench", label: "Bench Warm-Up" },
  { value: "deadlift", label: "Deadlift Warm-Up" },
  { value: "sbd", label: "SBD Warm-Up" },
  { value: "upper", label: "Upper Body" },
  { value: "lower", label: "Lower Body" },
  { value: "full", label: "Full Body" },
  { value: "mobility", label: "Mobility" },
  { value: "cool_down", label: "Cool Down" },
  { value: "custom", label: "Custom" },
] as const;