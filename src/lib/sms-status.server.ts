/**
 * Server-only: read back what Twilio did with each text and what the month
 * actually cost. Runs from the 10-minute SMS tick (hooks/sms-reminders) and the
 * cost dashboard's Refresh.
 *
 * No status webhook: the app reaches Twilio through the Lovable connector, so
 * it can't check Twilio's request signature, and an unsigned public endpoint
 * would let anyone rewrite delivery records. Instead each recent text is looked
 * up a few times at most (6 checks, last 3 days), and the month's totals once
 * an hour.
 */
import { markOptedOut, twilioConfigured, twilioFetch } from "@/lib/sms-gateway.server";
import { TWILIO_UNSUBSCRIBED } from "@/lib/sms-policy";

type Db = any;

const FINAL = new Set(["delivered", "undelivered", "failed", "canceled", "read"]);
export const MAX_STATUS_CHECKS = 6;
/** A claim this old that never heard back from Twilio: the outcome is unknown. */
const STALE_CLAIM_MS = 15 * 60_000;

export async function pollSmsStatuses(admin: Db, limit = 40) {
  const result = { checked: 0, updated: 0, stale: 0, optedOut: 0, errors: 0 };

  // A worker that died between the claim and Twilio's answer: count it as
  // failed but keep its key, so it's never retried (it may have gone out).
  const { data: stale } = await admin
    .from("sms_log")
    .update({ status: "failed", error: "unknown_outcome", twilio_status: "unknown" })
    .eq("status", "queued")
    .lt("created_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
    .select("id");
  result.stale = (stale ?? []).length;

  if (!twilioConfigured()) return result;
  const now = Date.now();
  const { data: rows, error } = await admin
    .from("sms_log")
    .select("id, twilio_sid, client_id, app_member_id, status_checks, price_usd, twilio_status")
    .not("twilio_sid", "is", null)
    .lt("status_checks", MAX_STATUS_CHECKS)
    .gte("created_at", new Date(now - 3 * 86_400_000).toISOString())
    .lte("created_at", new Date(now - 2 * 60_000).toISOString())
    .or("price_usd.is.null,twilio_status.is.null,twilio_status.in.(accepted,queued,sending,sent,scheduled)")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  for (const r of (rows ?? []) as any[]) {
    result.checked++;
    try {
      const res = await twilioFetch(`/Messages/${encodeURIComponent(r.twilio_sid)}.json`);
      const patch: Record<string, unknown> = {
        status_checks: (r.status_checks ?? 0) + 1,
        status_checked_at: new Date().toISOString(),
      };
      if (res.ok) {
        const d = res.data ?? {};
        const price = d.price == null || d.price === "" ? null : Math.abs(Number(d.price));
        if (d.status) patch.twilio_status = String(d.status);
        if (price != null && Number.isFinite(price)) patch.price_usd = price;
        if (d.price_unit) patch.price_unit = String(d.price_unit);
        if (d.error_code != null) patch.error_code = Number(d.error_code) || null;
        const segs = Number(d.num_segments);
        if (Number.isFinite(segs) && segs > 0) patch.segments = segs;
        // Done looking once it's final and priced.
        if (FINAL.has(String(d.status)) && price != null) patch.status_checks = MAX_STATUS_CHECKS;
        if (Number(d.error_code) === TWILIO_UNSUBSCRIBED) {
          await markOptedOut(admin, { clientId: r.client_id, memberId: r.app_member_id });
          result.optedOut++;
        }
        result.updated++;
      } else {
        result.errors++;
      }
      await admin.from("sms_log").update(patch).eq("id", r.id);
    } catch {
      result.errors++;
      await admin.from("sms_log").update({ status_checks: (r.status_checks ?? 0) + 1, status_checked_at: new Date().toISOString() }).eq("id", r.id);
    }
  }
  return result;
}

export type TwilioUsage = {
  month: string;
  fetched_at: string;
  total?: number | null;
  total_usd?: string | null;
  sms_count?: number | null;
  sms_price?: number | null;
  price_unit?: string | null;
  error?: string | null;
};

function firstRecord(data: any): any | null {
  const rec = Array.isArray(data?.usage_records) ? data.usage_records[0] : null;
  return rec ?? null;
}

/**
 * This month's real Twilio bill so far (every charge: texts, carrier fees, the
 * phone number). Cached on sms_settings.twilio_usage; read at most once an hour
 * unless forced.
 */
export async function refreshTwilioUsage(admin: Db, opts: { force?: boolean; maxAgeMinutes?: number } = {}) {
  const { data: s } = await admin.from("sms_settings").select("id, twilio_usage").eq("singleton", true).maybeSingle();
  if (!s?.id) return null;
  const month = new Date().toISOString().slice(0, 7);
  const prev = (s.twilio_usage ?? null) as TwilioUsage | null;
  const maxAge = (opts.maxAgeMinutes ?? 60) * 60_000;
  if (!opts.force && prev?.month === month && Date.now() - new Date(prev.fetched_at).getTime() < maxAge) return prev;
  if (!twilioConfigured()) return prev;

  const [total, sms] = await Promise.all([
    twilioFetch("/Usage/Records/ThisMonth.json?Category=totalprice").catch(() => null),
    twilioFetch("/Usage/Records/ThisMonth.json?Category=sms").catch(() => null),
  ]);
  const tRec = total?.ok ? firstRecord(total.data) : null;
  const sRec = sms?.ok ? firstRecord(sms.data) : null;
  const keep = prev?.month === month ? prev : null;
  let next: TwilioUsage;
  if (tRec) {
    const amount = Math.abs(Number(tRec.price ?? tRec.usage ?? 0));
    const unit = String(tRec.price_unit ?? "usd").toUpperCase();
    next = {
      month,
      fetched_at: new Date().toISOString(),
      total: Number.isFinite(amount) ? amount : null,
      total_usd: unit === "USD" && Number.isFinite(amount) ? amount.toFixed(4) : null,
      price_unit: unit,
      sms_count: sRec ? Number(sRec.count) || 0 : keep?.sms_count ?? null,
      sms_price: sRec ? Math.abs(Number(sRec.price) || 0) : keep?.sms_price ?? null,
      error: null,
    };
  } else {
    next = {
      ...(keep ?? { month }),
      month,
      fetched_at: new Date().toISOString(),
      error: total ? `twilio_${total.status}` : "unreachable",
    };
  }
  await admin.from("sms_settings").update({ twilio_usage: next }).eq("id", s.id);
  return next;
}
