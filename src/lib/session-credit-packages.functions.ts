import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

// -------- List packages --------
export const listSessionCreditPackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("session_credit_packages")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { ok: true, packages: data ?? [] };
  });

// -------- Create / update / delete --------
const PackageInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  session_count: z.number().int().positive(),
  unit_price_minor: z.number().int().nonnegative(),
  total_price_minor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3).default("CAD"),
  validity_days: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const createSessionCreditPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PackageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: row, error } = await supabase
      .from("session_credit_packages")
      .insert({ ...data, created_by: userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, package: row };
  });

const UpdatePackage = PackageInput.partial().extend({ id: z.string().uuid() });

export const updateSessionCreditPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdatePackage.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { id, ...patch } = data;
    const { data: row, error } = await supabase
      .from("session_credit_packages")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, package: row };
  });

export const deleteSessionCreditPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("session_credit_packages")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Grant a package to a client (writes to session_ledger_events) --------
const GrantPackage = z.object({
  client_id: z.string().uuid(),
  package_id: z.string().uuid(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(2000).optional().nullable(),
});

export const grantSessionCreditPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GrantPackage.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pkg, error: pErr } = await supabase
      .from("session_credit_packages")
      .select("*")
      .eq("id", data.package_id)
      .single();
    if (pErr || !pkg) throw new Error("Package not found");

    const effective = data.effective_date ?? new Date().toISOString().slice(0, 10);
    const expires = pkg.validity_days
      ? new Date(new Date(effective).getTime() + pkg.validity_days * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;

    const { data: ev, error } = await supabase
      .from("session_ledger_events")
      .insert({
        client_id: data.client_id,
        event_type: "granted",
        session_count: pkg.session_count,
        unit_value_minor: pkg.unit_price_minor,
        currency: pkg.currency,
        effective_date: effective,
        expires_at: expires,
        source: "package_grant",
        note: data.note ?? `Granted package: ${pkg.name}`,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("financial_audit_events").insert({
      client_id: data.client_id,
      actor_user_id: userId,
      actor_role: "admin",
      action: "session_credits_granted",
      record_type: "session_ledger_events",
      record_id: ev.id,
      after_state: { package_id: pkg.id, package_name: pkg.name, session_count: pkg.session_count },
      reason: data.note ?? null,
    });

    return { ok: true, event: ev };
  });

// -------- Client session credits summary --------
export const getClientSessionCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ client_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const [eventsRes, balRes] = await Promise.all([
      supabase
        .from("session_ledger_events")
        .select("*")
        .eq("client_id", data.client_id)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.rpc("session_balance", { _client_id: data.client_id }),
    ]);
    return {
      ok: true,
      events: eventsRes.data ?? [],
      balance: balRes.data ?? [],
    };
  });

// -------- Adjust / void --------
const Adjust = z.object({
  client_id: z.string().uuid(),
  delta: z.number().int(),
  note: z.string().min(2).max(2000),
});

export const adjustSessionCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Adjust.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: ev, error } = await supabase
      .from("session_ledger_events")
      .insert({
        client_id: data.client_id,
        event_type: data.delta >= 0 ? "granted" : "adjusted",
        session_count: data.delta,
        source: "admin_adjust",
        note: data.note,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, event: ev };
  });

// -------- Add credits (create package + grant to client in one step) --------
const AddCredits = z.object({
  client_id: z.string().uuid(),
  service_type: z.string().min(1).max(100),
  session_count: z.number().int().positive(),
  cost_per_session_minor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3).default("CAD"),
  validity_days: z.number().int().positive().nullable().optional(),
  payment_note: z.string().max(2000).optional().nullable(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const addClientSessionCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddCredits.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const total = data.cost_per_session_minor * data.session_count;
    const name = `${data.service_type} · ${data.session_count} sessions`;

    const { data: pkg, error: pErr } = await supabase
      .from("session_credit_packages")
      .insert({
        name,
        description: data.service_type,
        session_count: data.session_count,
        unit_price_minor: data.cost_per_session_minor,
        total_price_minor: total,
        currency: data.currency,
        validity_days: data.validity_days ?? null,
        active: false, // ad-hoc per-client package, not part of public catalog
        sort_order: 0,
        created_by: userId,
      })
      .select("*")
      .single();
    if (pErr || !pkg) throw new Error(pErr?.message ?? "Failed to create package");

    const effective = data.effective_date ?? new Date().toISOString().slice(0, 10);
    const expires = pkg.validity_days
      ? new Date(new Date(effective).getTime() + pkg.validity_days * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;

    const { data: ev, error } = await supabase
      .from("session_ledger_events")
      .insert({
        client_id: data.client_id,
        event_type: "granted",
        session_count: pkg.session_count,
        unit_value_minor: pkg.unit_price_minor,
        currency: pkg.currency,
        effective_date: effective,
        expires_at: expires,
        source: "package_grant",
        note: data.payment_note?.trim()
          ? `Granted package: ${data.service_type} — ${data.payment_note.trim()}`
          : `Granted package: ${data.service_type}`,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("financial_audit_events").insert({
      client_id: data.client_id,
      actor_user_id: userId,
      actor_role: "admin",
      action: "session_credits_granted",
      record_type: "session_ledger_events",
      record_id: ev.id,
      after_state: {
        package_id: pkg.id,
        service_type: data.service_type,
        session_count: pkg.session_count,
        unit_price_minor: pkg.unit_price_minor,
        total_price_minor: pkg.total_price_minor,
        currency: pkg.currency,
      },
      reason: data.payment_note ?? null,
    });

    return { ok: true, package: pkg, event: ev };
  });