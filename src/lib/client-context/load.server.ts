/**
 * Reading a client's context for the AI (Nov 25 2026): one place every Cleo
 * path, check-in recap and message in the coach's voice reads it from, with
 * whatever session it's given (the service role after the caller's access was
 * checked; a client's own session sees only their own client-facing row, RLS
 * hides the coach-only tables). Best-effort: a table that can't be read is
 * left out, never guessed. Server only.
 */
import { lifestyleText, normalizeLifestyle, normalizeRelationship, type ContextFact, type Lifestyle, type Relationship } from "@/lib/client-context/lifestyle";

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

export async function loadLifestyle(sb: any, clientId: string): Promise<Lifestyle | null> {
  const row = await safe<any>(() => sb.from("client_lifestyle").select("*").eq("client_id", clientId).maybeSingle(), null);
  return row ? normalizeLifestyle(row) : null;
}

export async function loadRelationship(sb: any, clientId: string): Promise<Relationship | null> {
  const row = await safe<any>(() => sb.from("client_relationships").select("labels, custom_label, note").eq("client_id", clientId).maybeSingle(), null);
  if (!row) return null;
  const r = normalizeRelationship(row);
  return r.labels.length || r.custom ? r : null;
}

export async function loadContextFacts(sb: any, clientId: string, opts: { all?: boolean } = {}): Promise<ContextFact[]> {
  let q = sb.from("client_context_facts").select("id, category, fact, source, status, valid_until, created_at").eq("client_id", clientId);
  if (!opts.all) q = q.eq("status", "active");
  const rows = await safe<any[]>(() => q.order("created_at", { ascending: false }).limit(opts.all ? 200 : 40), []);
  return rows.map((r) => ({ id: r.id, category: r.category, fact: String(r.fact ?? ""), source: r.source, status: r.status, valid_until: r.valid_until ?? null, created_at: r.created_at }));
}

/**
 * The context as prompt text.
 * - `coach`: coach-facing work (Cleo's planning, the coach's own conversations):
 *   lifestyle, the coach's private facts (labelled never to be quoted) and,
 *   with `relationship`, the relationship as tone-only context.
 * - `client_facing`: anything a client reads (a check-in reply, a program's
 *   notes): their own client-facing profile only, never a private fact or label.
 */
export async function clientContextText(sb: any, clientId: string, audience: "coach" | "client_facing", opts: { relationship?: boolean; today?: string } = {}): Promise<string | null> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const [lifestyle, facts, relationship] = await Promise.all([
    loadLifestyle(sb, clientId),
    audience === "coach" ? loadContextFacts(sb, clientId) : Promise.resolve([] as ContextFact[]),
    audience === "coach" && opts.relationship ? loadRelationship(sb, clientId) : Promise.resolve(null),
  ]);
  return lifestyleText(lifestyle, { facts, today, relationship });
}
