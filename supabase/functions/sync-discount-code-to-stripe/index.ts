import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type StripeMode = "test" | "live";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function formEncode(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        add(`${key}[${childKey}]`, childValue);
      }
      return;
    }
    usp.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return usp.toString();
}

function stripeKeyForMode(mode: StripeMode): string | null {
  if (mode === "test") {
    const testKey = Deno.env.get("STRIPE_SECRET_KEY_TEST");
    if (testKey?.startsWith("sk_test_")) return testKey;
    const defaultKey = Deno.env.get("STRIPE_SECRET_KEY");
    return defaultKey?.startsWith("sk_test_") ? defaultKey : null;
  }
  const liveKey = Deno.env.get("STRIPE_SECRET_KEY");
  return liveKey?.startsWith("sk_live_") || liveKey?.startsWith("rk_live_") ? liveKey : null;
}

function jwtRole(token: string): string | null {
  try {
    let part = token.split(".")[1];
    if (!part) return null;
    part = part.replace(/-/g, "+").replace(/_/g, "/");
    part = part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(part));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

async function stripeFetch(path: string, init: { apiKey: string; method?: string; body?: string; idempotencyKey?: string }) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `Stripe error (${response.status})`);
  return payload;
}

function buildCouponParams(row: Record<string, any>, couponId: string) {
  const params: Record<string, unknown> = {
    id: couponId,
    name: row.internal_name,
    duration: row.subscription_duration,
    metadata: {
      discount_code_id: row.id,
      public_code: row.public_code,
      category: row.category,
    },
  };

  if (row.discount_type === "percentage") {
    params.percent_off = Number(row.discount_value);
  } else {
    params.amount_off = Math.round(Number(row.discount_value) * 100);
    params.currency = "usd";
  }
  if (row.subscription_duration === "repeating" && row.duration_months) params.duration_in_months = row.duration_months;
  if (row.total_usage_limit) params.max_redemptions = row.total_usage_limit;
  if (row.expires_at) params.redeem_by = Math.floor(new Date(row.expires_at).getTime() / 1000);

  return params;
}

function buildPromotionCodeParams(row: Record<string, any>, couponId: string) {
  const params: Record<string, unknown> = {
    coupon: couponId,
    code: row.public_code,
    active: row.status === "active",
    metadata: {
      discount_code_id: row.id,
      public_code: row.public_code,
      category: row.category,
    },
  };
  if (row.expires_at) params.expires_at = Math.floor(new Date(row.expires_at).getTime() / 1000);
  if (row.total_usage_limit) params.max_redemptions = row.total_usage_limit;

  const restrictions: Record<string, unknown> = {};
  if (row.new_customers_only) restrictions.first_time_transaction = true;
  if (row.min_purchase_cents && row.min_purchase_cents > 0) {
    restrictions.minimum_amount = row.min_purchase_cents;
    restrictions.minimum_amount_currency = "usd";
  }
  if (Object.keys(restrictions).length > 0) params.restrictions = restrictions;

  return params;
}

async function ensureStripeCoupon(apiKey: string, row: Record<string, any>, couponId: string) {
  try {
    const existing = await stripeFetch(`/coupons/${encodeURIComponent(couponId)}`, { apiKey });
    if (existing?.id) return existing.id as string;
  } catch {
    // Coupon does not exist yet.
  }

  const params = buildCouponParams(row, couponId);
  delete params.coupon;
  const created = await stripeFetch("/coupons", {
    method: "POST",
    apiKey,
    body: formEncode(params),
    idempotencyKey: `coupon:${couponId}`,
  });
  return created.id as string;
}

async function ensureStripePromotionCode(apiKey: string, row: Record<string, any>, couponId: string, existingId: string | null) {
  if (existingId) {
    try {
      const updated = await stripeFetch(`/promotion_codes/${encodeURIComponent(existingId)}`, {
        method: "POST",
        apiKey,
        body: formEncode({
          active: row.status === "active",
          metadata: { discount_code_id: row.id, public_code: row.public_code, category: row.category },
        }),
      });
      return updated.id as string;
    } catch (error) {
      if (!/no such promotion_code/i.test((error as Error).message)) throw error;
    }
  }

  const search = await stripeFetch(
    `/promotion_codes?code=${encodeURIComponent(row.public_code)}&coupon=${encodeURIComponent(couponId)}&limit=1`,
    { apiKey },
  );
  if (Array.isArray(search?.data) && search.data[0]?.id) return search.data[0].id as string;

  const created = await stripeFetch("/promotion_codes", {
    method: "POST",
    apiKey,
    body: formEncode(buildPromotionCodeParams(row, couponId)),
    idempotencyKey: `promo:${row.id}:${couponId}`,
  });
  return created.id as string;
}

async function syncOneMode(row: Record<string, any>, mode: StripeMode) {
  const apiKey = stripeKeyForMode(mode);
  if (!apiKey) return null;

  const couponId = `${mode === "test" ? "tst" : "lv"}_${String(row.id).replace(/-/g, "").slice(0, 24)}`;
  const ensuredCouponId = await ensureStripeCoupon(apiKey, row, couponId);
  const existingPromoId = mode === "test" ? row.stripe_test_promotion_code_id ?? null : row.stripe_live_promotion_code_id ?? null;
  const promoId = await ensureStripePromotionCode(apiKey, row, ensuredCouponId, existingPromoId);
  return { couponId: ensuredCouponId, promoId };
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") ?? "";
    const gatewayApiKey = request.headers.get("apikey") ?? "";

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    const isServiceRequest = bearer === serviceKey || gatewayApiKey === serviceKey || jwtRole(bearer) === "service_role";
    console.log("[sync-discount-code-to-stripe] auth", {
      hasAuthorization: Boolean(authorization),
      role: jwtRole(bearer),
      isServiceRequest,
    });
    let actorId: string | null = null;
    let actorEmail: string | null = null;

    if (!isServiceRequest) {
      const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data: authData, error: authError } = await authClient.auth.getUser();
      if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

      const { data: isAdmin, error: roleError } = await adminClient.rpc("has_role", {
        _user_id: authData.user.id,
        _role: "admin",
      });
      if (roleError || !isAdmin) return json({ error: "Forbidden" }, 403);
      actorId = authData.user.id;
      actorEmail = authData.user.email ?? null;
    }

    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : null;
    const publicCode = typeof body.public_code === "string" ? body.public_code : null;
    const modes = Array.isArray(body.modes) && body.modes.length > 0 ? body.modes.filter((mode: unknown) => mode === "test" || mode === "live") : ["test", "live"];
    if ((!id && !publicCode) || modes.length === 0) return json({ error: "Provide id or public_code and at least one mode" }, 400);

    let query = adminClient.from("discount_codes").select("*").limit(1).single();
    query = id ? query.eq("id", id) : query.eq("public_code", publicCode);
    const { data: row, error: rowError } = await query;
    if (rowError || !row) return json({ error: "Discount code not found" }, 404);

    const update: Record<string, unknown> = {
      stripe_last_sync_at: new Date().toISOString(),
      stripe_last_sync_error: null,
    };
    const results: Array<{ mode: StripeMode; ok: boolean; error?: string; couponId?: string; promoId?: string }> = [];

    for (const mode of modes as StripeMode[]) {
      try {
        const output = await syncOneMode(row, mode);
        if (!output) {
          results.push({ mode, ok: false, error: `No ${mode}-mode Stripe key configured` });
          continue;
        }
        if (mode === "test") {
          update.stripe_test_coupon_id = output.couponId;
          update.stripe_test_promotion_code_id = output.promoId;
          update.stripe_test_mode_synced = true;
        } else {
          update.stripe_live_coupon_id = output.couponId;
          update.stripe_live_promotion_code_id = output.promoId;
          update.stripe_live_mode_synced = true;
        }
        results.push({ mode, ok: true, couponId: output.couponId, promoId: output.promoId });
      } catch (error) {
        results.push({ mode, ok: false, error: (error as Error).message });
      }
    }

    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) update.stripe_last_sync_error = failures.map((result) => `[${result.mode}] ${result.error}`).join(" | ");
    update.stripe_active = Boolean(update.stripe_live_promotion_code_id) && row.status === "active";

    const { error: updateError } = await adminClient.from("discount_codes").update(update).eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    await adminClient.from("discount_code_audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action: "code_synced_to_stripe",
      code_id: row.id,
      code_public: row.public_code,
      metadata: { results, source: "edge_function" },
    });

    return json({ ok: failures.length === 0, results, applied: update });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});