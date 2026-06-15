import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GlobalSearchHit = {
  kind: "client" | "coach" | "account" | "program";
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

    const [clientsRes, coachesRes, membersRes, tplRes] = await Promise.all([
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
        .select("id, full_name, first_name, last_name, email, phone, notes")
        .or(
          [
            `full_name.ilike.${like}`,
            `first_name.ilike.${like}`,
            `last_name.ilike.${like}`,
            `email.ilike.${like}`,
            `phone.ilike.${like}`,
            `notes.ilike.${like}`,
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
        notes: a.notes,
      });
      hits.push({
        kind: "account",
        id: a.id,
        label: a.full_name || `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || a.email || "Account",
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

    return hits;
  });