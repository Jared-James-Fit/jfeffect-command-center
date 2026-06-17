import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * POST /api/public/bulk-exercise-import
 *
 * Bulk upserts exercises by name. External-caller endpoint protected by a
 * shared bearer secret (env: IMPORT_SECRET). Uses the service role client
 * — bypasses RLS — so the bearer check is the ONLY thing standing between
 * the caller and write access. Never log or echo the secret.
 */

const ExerciseSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(100).nullable().optional(),
  muscle_group: z.string().max(100).nullable().optional(),
  equipment: z.string().max(100).nullable().optional(),
  difficulty: z.string().max(50).nullable().optional(),
  default_load_unit: z.string().max(10).nullable().optional(),
  cues: z.string().max(4000).nullable().optional(),
  common_mistakes: z.string().max(4000).nullable().optional(),
  video_url: z.string().url().max(1000).nullable().optional(),
  vimeo_embed_url: z.string().url().max(1000).nullable().optional(),
  video_provider: z.string().max(50).nullable().optional(),
  video_migration_status: z.string().max(50).nullable().optional(),
  youtube_fallback_allowed: z.boolean().optional(),
});

const BodySchema = z.object({
  exercises: z.array(ExerciseSchema).min(1).max(1000),
});

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/bulk-exercise-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.IMPORT_SECRET;
        if (!expected) {
          return new Response("Server misconfigured", { status: 500 });
        }
        const auth = request.headers.get("authorization") ?? "";
        const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!provided || !timingSafeEqualStr(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(payload);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid payload", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const rows = parsed.data.exercises.map((e) => ({
          name: e.name,
          category: e.category ?? null,
          muscle_group: e.muscle_group ?? null,
          equipment: e.equipment ?? null,
          difficulty: e.difficulty ?? null,
          default_load_unit: e.default_load_unit ?? null,
          cues: e.cues ?? null,
          common_mistakes: e.common_mistakes ?? null,
          video_url: e.video_url ?? null,
          vimeo_embed_url: e.vimeo_embed_url ?? null,
          video_provider: e.video_provider ?? null,
          video_migration_status: e.video_migration_status ?? null,
          youtube_fallback_allowed: e.youtube_fallback_allowed ?? false,
          updated_at: new Date().toISOString(),
        }));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("exercises")
          .upsert(rows, { onConflict: "name" })
          .select("id");

        if (error) {
          console.error("[bulk-exercise-import] upsert failed", error.message);
          return Response.json(
            { error: "Upsert failed", message: error.message },
            { status: 500 },
          );
        }

        return Response.json({ ok: true, count: data?.length ?? 0 });
      },
    },
  },
});