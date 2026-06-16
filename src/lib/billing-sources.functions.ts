import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BillingSource =
  | "trainerize_legacy"
  | "jfeffect_stripe"
  | "manual_external"
  | "complimentary"
  | "none";

type AccessSource =
  | "legacy_coaching"
  | "new_stripe_coaching"
  | "membership"
  | "complimentary"
  | "manual_admin";

type AccessStatus = "active" | "paused" | "past_due" | "ending" | "ended";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

async function audit(
  supabase: any,
  args: {
    client_id: string | null;
    admin_id: string;
    event_type: string;
    previous_value?: any;
    new_value?: any;
    reason?: string | null;
  },
) {
  await supabase.from("billing_audit_log").insert({
    client_id: args.client_id,
    admin_id: args.admin_id,
    event_type: args.event_type,
    previous_value: args.previous_value ?? null,
    new_value: args.new_value ?? null,
    reason: args.reason ?? null,
  });
}

export const listClientsWithBillingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { billingSource?: BillingSource | "all"; accessStatus?: AccessStatus | "all"; search?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    let query = supabase
      .from("clients")
      .select(
        "id, full_name, email, billing_source, billing_source_locked, billing_source_set_at, stripe_customer_id, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (data.billingSource && data.billingSource !== "all") {
      query = query.eq("billing_source", data.billingSource);
    }
    if (data.search && data.search.trim()) {
      const term = `%${data.search.trim()}%`;
      query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.id);
    if (ids.length === 0) return { clients: [] };

    const { data: entitlements } = await supabase
      .from("client_access_entitlements")
      .select("client_id, access_source, access_tier, status, effective_start, effective_end")
      .in("client_id", ids);

    const { data: legacy } = await supabase
      .from("legacy_billing_records")
      .select("client_id, plan_name, amount_cents, currency, billing_interval, next_billing_at, status, last_verified_at")
      .in("client_id", ids);

    const entMap = new Map<string, any[]>();
    for (const e of entitlements ?? []) {
      const list = entMap.get(e.client_id) ?? [];
      list.push(e);
      entMap.set(e.client_id, list);
    }
    const legMap = new Map<string, any>();
    for (const l of legacy ?? []) legMap.set(l.client_id, l);

    let filtered = rows ?? [];
    if (data.accessStatus && data.accessStatus !== "all") {
      filtered = filtered.filter((r: any) =>
        (entMap.get(r.id) ?? []).some((e) => e.status === data.accessStatus),
      );
    }

    return {
      clients: filtered.map((r: any) => ({
        ...r,
        entitlements: entMap.get(r.id) ?? [],
        legacy_billing: legMap.get(r.id) ?? null,
      })),
    };
  });

export const getClientBillingDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: client, error } = await supabase
      .from("clients")
      .select(
        "id, full_name, email, phone, billing_source, billing_source_locked, billing_source_set_at, billing_source_notes, stripe_customer_id, stripe_link, status",
      )
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client not found");

    const { data: legacy } = await supabase
      .from("legacy_billing_records")
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();

    const { data: entitlements } = await supabase
      .from("client_access_entitlements")
      .select("*")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });

    const { data: reviews } = await supabase
      .from("billing_migration_reviews")
      .select("*")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });

    const { data: auditRows } = await supabase
      .from("billing_audit_log")
      .select("id, event_type, previous_value, new_value, reason, created_at, admin_id")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      client,
      legacy_billing: legacy ?? null,
      entitlements: entitlements ?? [],
      migration_reviews: reviews ?? [],
      audit_log: auditRows ?? [],
    };
  });

export const setClientBillingSourceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string;
    billingSource: BillingSource;
    lock?: boolean;
    notes?: string | null;
    reason?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: existing } = await supabase
      .from("clients")
      .select("billing_source, billing_source_locked")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!existing) throw new Error("Client not found");

    if (
      existing.billing_source === "trainerize_legacy" &&
      existing.billing_source_locked &&
      data.billingSource !== "trainerize_legacy"
    ) {
      const { data: review } = await supabase
        .from("billing_migration_reviews")
        .select("id")
        .eq("client_id", data.clientId)
        .eq("status", "completed")
        .maybeSingle();
      if (!review) {
        throw new Error(
          "This client is locked as Trainerize Legacy. Complete an authorized billing migration review before changing the billing source.",
        );
      }
    }

    const { error } = await supabase
      .from("clients")
      .update({
        billing_source: data.billingSource,
        billing_source_set_by: userId,
        billing_source_set_at: new Date().toISOString(),
        billing_source_locked: data.lock ?? false,
        billing_source_notes: data.notes ?? null,
      })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: data.clientId,
      admin_id: userId,
      event_type: "billing_source_changed",
      previous_value: { billing_source: existing.billing_source },
      new_value: { billing_source: data.billingSource, locked: data.lock ?? false },
      reason: data.reason ?? null,
    });

    return { ok: true };
  });

export const upsertLegacyBillingRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string;
    trainerize_customer_ref?: string | null;
    trainerize_subscription_ref?: string | null;
    plan_name?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
    billing_interval?: string | null;
    next_billing_at?: string | null;
    status?: "active" | "past_due" | "paused" | "cancelled" | "unknown";
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: existing } = await supabase
      .from("legacy_billing_records")
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();

    const payload: any = {
      client_id: data.clientId,
      trainerize_customer_ref: data.trainerize_customer_ref ?? null,
      trainerize_subscription_ref: data.trainerize_subscription_ref ?? null,
      plan_name: data.plan_name ?? null,
      amount_cents: data.amount_cents ?? null,
      currency: (data.currency ?? "usd").toLowerCase(),
      billing_interval: data.billing_interval ?? null,
      next_billing_at: data.next_billing_at ?? null,
      status: data.status ?? "unknown",
      notes: data.notes ?? null,
    };

    if (existing) {
      const { error } = await supabase
        .from("legacy_billing_records")
        .update(payload)
        .eq("client_id", data.clientId);
      if (error) throw new Error(error.message);
    } else {
      payload.created_by = userId;
      const { error } = await supabase.from("legacy_billing_records").insert(payload);
      if (error) throw new Error(error.message);
    }

    await audit(supabase, {
      client_id: data.clientId,
      admin_id: userId,
      event_type: existing ? "legacy_billing_updated" : "legacy_billing_created",
      previous_value: existing ?? null,
      new_value: payload,
    });

    return { ok: true };
  });

export const verifyLegacyBillingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; status?: "active" | "past_due" | "paused" | "cancelled" | "unknown" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const update: any = {
      last_verified_at: new Date().toISOString(),
      last_verified_by: userId,
    };
    if (data.status) update.status = data.status;

    const { error } = await supabase
      .from("legacy_billing_records")
      .update(update)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: data.clientId,
      admin_id: userId,
      event_type: "legacy_billing_verified",
      new_value: update,
    });
    return { ok: true };
  });

export const grantAppAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string;
    accessSource: AccessSource;
    accessTier?: string | null;
    billingSource: BillingSource;
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const insertRow = {
      client_id: data.clientId,
      access_source: data.accessSource,
      access_tier: data.accessTier ?? null,
      status: "active" as const,
      billing_source: data.billingSource,
      granted_by: userId,
      notes: data.notes ?? null,
    };
    const { data: row, error } = await supabase
      .from("client_access_entitlements")
      .insert(insertRow)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: data.clientId,
      admin_id: userId,
      event_type: "access_granted",
      new_value: row,
    });
    return { entitlement: row };
  });

export const updateAccessStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { entitlementId: string; status: AccessStatus; reason?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: existing } = await supabase
      .from("client_access_entitlements")
      .select("*")
      .eq("id", data.entitlementId)
      .maybeSingle();
    if (!existing) throw new Error("Entitlement not found");

    const update: any = { status: data.status };
    if (data.status === "ended" || data.status === "ending") {
      update.effective_end = new Date().toISOString();
    }

    const { error } = await supabase
      .from("client_access_entitlements")
      .update(update)
      .eq("id", data.entitlementId);
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: existing.client_id,
      admin_id: userId,
      event_type: "access_status_changed",
      previous_value: { status: existing.status },
      new_value: update,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

export const inviteLegacyClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId?: string | null;
    full_name: string;
    email: string;
    phone?: string | null;
    accessTier?: string | null;
    legacyBilling?: {
      trainerize_customer_ref?: string | null;
      trainerize_subscription_ref?: string | null;
      plan_name?: string | null;
      amount_cents?: number | null;
      currency?: string | null;
      billing_interval?: string | null;
      next_billing_at?: string | null;
      status?: "active" | "past_due" | "paused" | "cancelled" | "unknown";
      notes?: string | null;
    } | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    let clientId = data.clientId ?? null;
    if (!clientId) {
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          full_name: data.full_name,
          email: data.email.toLowerCase(),
          phone: data.phone ?? null,
          billing_source: "trainerize_legacy",
          billing_source_locked: true,
          billing_source_set_by: userId,
          billing_source_set_at: new Date().toISOString(),
          source: "legacy_import",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      clientId = created.id;
    } else {
      const { error } = await supabase
        .from("clients")
        .update({
          billing_source: "trainerize_legacy",
          billing_source_locked: true,
          billing_source_set_by: userId,
          billing_source_set_at: new Date().toISOString(),
        })
        .eq("id", clientId);
      if (error) throw new Error(error.message);
    }

    if (data.legacyBilling) {
      const lb = data.legacyBilling;
      await supabase.from("legacy_billing_records").upsert(
        {
          client_id: clientId,
          trainerize_customer_ref: lb.trainerize_customer_ref ?? null,
          trainerize_subscription_ref: lb.trainerize_subscription_ref ?? null,
          plan_name: lb.plan_name ?? null,
          amount_cents: lb.amount_cents ?? null,
          currency: (lb.currency ?? "usd").toLowerCase(),
          billing_interval: lb.billing_interval ?? null,
          next_billing_at: lb.next_billing_at ?? null,
          status: lb.status ?? "unknown",
          notes: lb.notes ?? null,
          created_by: userId,
        },
        { onConflict: "client_id" },
      );
    }

    await supabase.from("client_access_entitlements").insert({
      client_id: clientId,
      access_source: "legacy_coaching",
      access_tier: data.accessTier ?? null,
      status: "active",
      billing_source: "trainerize_legacy",
      granted_by: userId,
      notes: "Legacy Trainerize coaching - billing remains in JF Effect Trainerize.",
    });

    await audit(supabase, {
      client_id: clientId,
      admin_id: userId,
      event_type: "legacy_client_imported",
      new_value: { full_name: data.full_name, email: data.email },
    });

    return { clientId, ok: true };
  });

export const openMigrationReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; notes?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const defaultChecklist = {
      identity_confirmed: false,
      current_plan_confirmed: false,
      current_price_confirmed: false,
      current_interval_confirmed: false,
      next_billing_date_confirmed: false,
      payment_method_strategy_confirmed: false,
      client_authorization_confirmed: false,
      new_product_confirmed: false,
      new_price_confirmed: false,
      duplicate_prevention_confirmed: false,
      old_cancellation_timing_confirmed: false,
      new_activation_confirmed: false,
      first_new_charge_confirmed: false,
      old_subscription_stopped_confirmed: false,
    };

    const { data: row, error } = await supabase
      .from("billing_migration_reviews")
      .insert({
        client_id: data.clientId,
        status: "draft",
        checklist: defaultChecklist,
        notes: data.notes ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: data.clientId,
      admin_id: userId,
      event_type: "migration_review_opened",
      new_value: { id: row.id },
    });
    return { review: row };
  });

export const updateMigrationReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    reviewId: string;
    checklist?: Record<string, boolean>;
    status?: "draft" | "in_review" | "authorized" | "cancelled";
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const update: any = {};
    if (data.checklist) update.checklist = data.checklist;
    if (data.status) {
      update.status = data.status;
      if (data.status === "authorized") {
        update.authorized_by = userId;
        update.authorized_at = new Date().toISOString();
      }
    }
    if (data.notes !== undefined) update.notes = data.notes;

    const { data: row, error } = await supabase
      .from("billing_migration_reviews")
      .update(update)
      .eq("id", data.reviewId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await audit(supabase, {
      client_id: row.client_id,
      admin_id: userId,
      event_type: "migration_review_updated",
      new_value: update,
    });
    return { review: row };
  });

export const getBillingDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: counts } = await supabase
      .from("clients")
      .select("billing_source");

    const sourceCounts: Record<string, number> = {
      trainerize_legacy: 0,
      jfeffect_stripe: 0,
      manual_external: 0,
      complimentary: 0,
      none: 0,
    };
    for (const row of counts ?? []) {
      const k = (row as any).billing_source as string;
      if (k in sourceCounts) sourceCounts[k]++;
    }

    const { data: legacy } = await supabase
      .from("legacy_billing_records")
      .select("amount_cents, currency, status, last_verified_at");

    const legacy_total_cents_estimated =
      (legacy ?? []).reduce((s: number, r: any) => s + (r.amount_cents ?? 0), 0);
    const legacy_active_count = (legacy ?? []).filter((r: any) => r.status === "active").length;

    return {
      source_counts: sourceCounts,
      legacy: {
        total_cents_estimated: legacy_total_cents_estimated,
        active_count: legacy_active_count,
        records_total: (legacy ?? []).length,
        label: "Legacy external billing - estimated, not Stripe-verified",
      },
      jfeffect_stripe_label: "Verified through JF Effect Stripe",
    };
  });
