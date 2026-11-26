/**
 * The fact store, read (server only, no other dependencies): what the shared
 * modules need from Athlete Intelligence (the competition context, the
 * gameplan draft, the client brief). Kept apart from intel.server.ts so those
 * modules never pull the upload, link and question code (or anything it
 * imports) into a bundle that doesn't need it.
 */
import type { Fact } from "./types";

type Db = any;

export function rowToFact(r: any): Fact {
  return {
    id: r.id,
    client_id: r.client_id,
    competition_id: r.competition_id ?? null,
    source_id: r.source_id ?? null,
    kind: r.kind,
    lift: r.lift ?? null,
    date: r.date ? String(r.date).slice(0, 10) : null,
    data: r.data ?? {},
    quote: r.quote ?? null,
    location: r.location ?? null,
    confidence: r.confidence ?? "medium",
    scope: r.scope ?? "athlete",
    provider: r.provider ?? "unknown",
    provider_name: r.provider_name ?? null,
    basis: r.basis ?? "source",
    status: r.status ?? "active",
    dedupe_key: r.dedupe_key,
    received_at: r.received_at ?? r.created_at ?? new Date().toISOString(),
  };
}

const DEAD = new Set(["deleted", "replaced"]);

/** The facts that stand on a live source (or none: the coach's own), in the given statuses. */
export async function loadFacts(sb: Db, clientId: string, statuses: Array<"active" | "superseded" | "dismissed"> = ["active"]): Promise<Fact[]> {
  const [{ data: srcs }, rows] = await Promise.all([
    sb.from("athlete_intel_sources").select("id, status").eq("client_id", clientId).limit(2000),
    pageAll(sb.from("athlete_intel_facts").select("*").eq("client_id", clientId).in("status", statuses).order("created_at")),
  ]);
  const dead = new Set(((srcs ?? []) as any[]).filter((s) => DEAD.has(s.status)).map((s) => s.id));
  return rows
    .filter((r: any) => !r.source_id || !dead.has(r.source_id) || ((r.also_sources ?? []) as string[]).some((id) => !dead.has(id)))
    .map(rowToFact);
}

async function pageAll(q: any, cap = 8000): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
