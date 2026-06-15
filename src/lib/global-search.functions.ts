import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GlobalSearchHit = {
  kind:
    | "client"
    | "coach"
    | "account"
    | "program"
    | "exercise"
    | "member_plan"
    | "recipe"
    | "broadcast"
    | "purchase";
  id: string;
  label: string;
  sub?: string | null;
  to: string;
  matchedField?: string | null;
};

const InputSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.number().int().min(1).max(50).optional(),
});

const escape = (s: string) => s.replace(/[\\%_,]/g, (m) => "\\" + m);

function pickMatch(q: string, fields: Record<string, string | null | undefined>) {
  const needle = q.toLowerCase();
  for (const [k, v] of Object.entries(fields)) {
    if (v && v.toLowerCase().includes(needle)) {
      const idx = v.toLowerCase().indexOf(needle);
      const start = Math.max(0, idx - 24);
      const end = Math.min(v.length, idx + q.length + 40);
      const snippet = (start > 0 ? "…" : "") + v.slice(start, end) + (end < v.length ? "…" : "");
      return { field: k, snippet };
    }
  }
  return null;
}

export const globalSearchFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }): Promise<GlobalSearchHit[]> => {
    const { supabase } = context;
    const q = data.q;
    const limit = data.limit ?? 8;
    const like = `%${escape(q)}%`;

    const [clientsRes, coachesRes, membersRes, tplRes, exRes, planRes, recipeRes, bcastRes, purchaseRes] = await Promise.all([
      supabase
        .from("clients")
        .select(
          "id, first_name, last_name, full_name, preferred_name, email, phone, instagram, tags, coach_notes, training_notes, nutrition_notes, lifestyle_notes",
        )
        .or(
          [
            `full_name.ilike.${like}`,
            `first_name.ilike.${like}`,
            `last_name.ilike.${like}`,
            `preferred_name.ilike.${like}`,
            `email.ilike.${like}`,
            `phone.ilike.${like}`,
            `instagram.ilike.${like}`,
            `coach_notes.ilike.${like}`,
            `training_notes.ilike.${like}`,
            `nutrition_notes.ilike.${like}`,
            `lifestyle_notes.ilike.${like}`,
          ].join(","),
        )
        .limit(limit),
      supabase
        .from("coaches")
        .select("id, full_name, email")
        .or([`full_name.ilike.${like}`, `email.ilike.${like}`].join(","))
        .limit(limit),
      supabase
        .from("app_members")
        .select("id, full_name, email, phone, admin_notes")
        .or(
          [
            `full_name.ilike.${like}`,
            `email.ilike.${like}`,
            `phone.ilike.${like}`,
            `admin_notes.ilike.${like}`,
          ].join(","),
        )
        .limit(limit),
      supabase
        .from("pl_templates")
        .select("id, name, description, training_focus, tags")
        .or(
          [
            `name.ilike.${like}`,
            `description.ilike.${like}`,
            `training_focus.ilike.${like}`,
          ].join(","),
        )
        .limit(limit),
      supabase
        .from("exercises")
        .select("id, name, category, primary_muscle")
        .or([`name.ilike.${like}`, `category.ilike.${like}`, `primary_muscle.ilike.${like}`].join(","))
        .limit(limit),
      supabase
        .from("member_plans")
        .select("id, name, summary, tags")
        .or([`name.ilike.${like}`, `summary.ilike.${like}`].join(","))
        .limit(limit),
      supabase
        .from("recipes")
        .select("id, name, summary")
        .or([`name.ilike.${like}`, `summary.ilike.${like}`].join(","))
        .limit(limit),
      supabase
        .from("broadcasts")
        .select("id, title, body")
        .or([`title.ilike.${like}`, `body.ilike.${like}`].join(","))
        .limit(limit),
      supabase
        .from("purchase_records")
        .select("id, customer_email, customer_name, product_name, amount_total")
        .or([
          `customer_email.ilike.${like}`,
          `customer_name.ilike.${like}`,
          `product_name.ilike.${like}`,
        ].join(","))
        .limit(limit),
    ]);

    const hits: GlobalSearchHit[] = [];

    for (const c of clientsRes.data ?? []) {
      const m = pickMatch(q, {
        name: c.full_name ?? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        email: c.email,
        phone: c.phone,
        instagram: c.instagram,
        notes: c.coach_notes,
        training: c.training_notes,
        nutrition: c.nutrition_notes,
        lifestyle: c.lifestyle_notes,
      });
      hits.push({
        kind: "client",
        id: c.id,
        label: c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "Client",
        sub: m?.snippet ?? c.email ?? null,
        to: `/admin/clients/${c.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const c of coachesRes.data ?? []) {
      const m = pickMatch(q, { name: c.full_name, email: c.email });
      hits.push({
        kind: "coach",
        id: c.id,
        label: c.full_name || c.email || "Coach",
        sub: m?.snippet ?? c.email ?? null,
        to: `/admin/coaches/${c.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const a of membersRes.data ?? []) {
      const m = pickMatch(q, {
        name: a.full_name,
        email: a.email,
        phone: a.phone,
        notes: a.admin_notes,
      });
      hits.push({
        kind: "account",
        id: a.id,
        label: a.full_name || a.email || "Account",
        sub: m?.snippet ?? a.email ?? null,
        to: `/admin/members/${a.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const t of tplRes.data ?? []) {
      const m = pickMatch(q, {
        name: t.name,
        description: t.description,
        focus: t.training_focus,
      });
      hits.push({
        kind: "program",
        id: t.id,
        label: t.name || "Program",
        sub: m?.snippet ?? t.training_focus ?? null,
        to: `/admin/program-library/${t.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const e of exRes.data ?? []) {
      const m = pickMatch(q, { name: e.name, category: e.category, muscle: e.primary_muscle });
      hits.push({
        kind: "exercise",
        id: e.id,
        label: e.name || "Exercise",
        sub: m?.snippet ?? e.category ?? e.primary_muscle ?? null,
        to: `/admin/exercises?focus=${e.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const p of planRes.data ?? []) {
      const m = pickMatch(q, { name: p.name, summary: p.summary });
      hits.push({
        kind: "member_plan",
        id: p.id,
        label: p.name || "Member Plan",
        sub: m?.snippet ?? p.summary ?? null,
        to: `/admin/member-plans/${p.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const r of recipeRes.data ?? []) {
      const m = pickMatch(q, { name: r.name, summary: r.summary });
      hits.push({
        kind: "recipe",
        id: r.id,
        label: r.name || "Recipe",
        sub: m?.snippet ?? r.summary ?? null,
        to: `/admin/recipes?focus=${r.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const b of bcastRes.data ?? []) {
      const m = pickMatch(q, { title: b.title, body: b.body });
      hits.push({
        kind: "broadcast",
        id: b.id,
        label: b.title || "Broadcast",
        sub: m?.snippet ?? null,
        to: `/admin/broadcasts/${b.id}`,
        matchedField: m?.field ?? null,
      });
    }

    for (const p of purchaseRes.data ?? []) {
      const m = pickMatch(q, {
        email: p.customer_email,
        name: p.customer_name,
        product: p.product_name,
      });
      const sub = [p.customer_name || p.customer_email, p.product_name]
        .filter(Boolean)
        .join(" · ");
      hits.push({
        kind: "purchase",
        id: p.id,
        label: p.product_name || p.customer_name || p.customer_email || "Purchase",
        sub: m?.snippet ?? sub ?? null,
        to: `/admin/purchases/${p.id}`,
        matchedField: m?.field ?? null,
      });
    }

    return hits;
  });