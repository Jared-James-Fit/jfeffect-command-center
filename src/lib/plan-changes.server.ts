/**
 * The plan change log (Nov 24 2026; plan-changes.ts holds the rules): each
 * quality read hands its plan's fingerprint here, this compares it with the
 * shape seen last time (`plan_quality_baselines`, server only), logs what
 * changed and how big it was, and keeps the new shape. It never writes a
 * prescription, only the snapshot and the log, and it's best effort: with the
 * table missing or a write refused, the read carries on with the changes it
 * can see from the plan's own history.
 */
import { diffFingerprints, sameFingerprint, trimChanges, type ChangeDomain, type Fingerprint, type PlanChange } from "@/lib/plan-changes";

/** What changed since the shape last seen (logged for 90 days), or [] when there's no record. */
export async function trackPlanChanges(sb: any, clientId: string, domain: ChangeDomain, next: Fingerprint, today: string, o: { comparable?: (prev: Fingerprint) => boolean } = {}): Promise<PlanChange[]> {
  try {
    const { data, error } = await sb.from("plan_quality_baselines").select("fingerprint, changes").eq("client_id", clientId).eq("domain", domain).maybeSingle();
    if (error) throw error;
    const prev = (data?.fingerprint ?? null) as Fingerprint | null;
    const logged = (Array.isArray(data?.changes) ? data.changes : []) as PlanChange[];
    if (prev && sameFingerprint(prev, next)) return trimChanges(logged, today);
    const fresh = prev && prev.v === next.v && (!o.comparable || o.comparable(prev)) ? diffFingerprints(domain, prev, next, today) : [];
    const changes = trimChanges([...fresh, ...logged], today);
    const { error: we } = await sb
      .from("plan_quality_baselines")
      .upsert({ client_id: clientId, domain, fingerprint: next, changes, seen_at: new Date().toISOString() }, { onConflict: "client_id,domain" });
    if (we) throw we;
    return changes;
  } catch (e: any) {
    console.warn("[plan-changes] change log unavailable", e?.message ?? e);
    return [];
  }
}
