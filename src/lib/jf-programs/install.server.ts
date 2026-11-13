/**
 * Puts the 12 JF Effect library programs (and the six exercises they need that
 * the library lacked) into the database: the same rows, under the same fixed
 * ids, as supabase/migrations/20270314090000_jf_effect_program_library.sql,
 * for databases where that file isn't run by hand (it's 1.5 MB).
 *
 * Preview first: without `apply` it only says what it would add. With it, it
 * adds what's missing and nothing else (insert-if-absent by id, never an
 * update), so a second run adds nothing and a coach's edits to a program are
 * never overwritten. It never touches a client's program, logs or any other
 * template. Called by the jf-library-install hook (vault secret).
 */
import { NEW_EXERCISES } from "./catalog";
import { buildLibrary, payloadSummary } from "./build";

type Admin = any;

export type InstallReport = {
  applied: boolean;
  exercises: { name: string; id: string; action: "added" | "would add" | "already added" | "uses existing" }[];
  templates: ({ id: string; name: string; action: "added" | "would add" | "already in the library" } & ReturnType<typeof payloadSummary>)[];
  totals: ReturnType<typeof payloadSummary> & { programs: number };
};

function unwrap<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? res.error}`);
  return res.data;
}

export async function installJfLibrary(admin: Admin, opts: { apply?: boolean } = {}): Promise<InstallReport> {
  const apply = opts.apply === true;

  // 1. The six new exercises: reuse any live exercise of the same name, else add ours.
  const idMap = new Map<string, string>();
  const exercises: InstallReport["exercises"] = [];
  for (const e of Object.values(NEW_EXERCISES)) {
    const found = unwrap<any[]>(
      await admin.from("exercises").select("id, name, archived, created_at").ilike("name", e.name).order("created_at"),
      `look up ${e.name}`,
    );
    const live = (found ?? []).filter((r) => !r.archived && String(r.name).toLowerCase() === e.name.toLowerCase());
    const use = live.find((r) => r.id === e.id) ?? live[0];
    if (use) {
      idMap.set(e.id, use.id);
      exercises.push({ name: e.name, id: use.id, action: use.id === e.id ? "already added" : "uses existing" });
      continue;
    }
    if (apply) {
      unwrap(
        await admin.from("exercises").upsert(
          {
            id: e.id,
            name: e.name,
            category: e.category,
            muscle_group: e.muscle_group,
            primary_muscle_group: e.primary_muscle_group,
            equipment: e.equipment,
            cues: e.cues,
            primary_movement_pattern: e.pattern,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
        `add ${e.name}`,
      );
    }
    exercises.push({ name: e.name, id: e.id, action: apply ? "added" : "would add" });
  }

  // 2. The 12 programs: only the ones not already there, owned by the admin login.
  const lib = buildLibrary();
  const existing = new Set(
    unwrap<any[]>(await admin.from("pl_templates").select("id").in("id", lib.map((t) => t.id)), "read the library").map((r) => r.id),
  );
  const owner = unwrap<any[]>(
    await admin.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1),
    "find the admin",
  )?.[0]?.user_id ?? null;
  if (apply && !owner) throw new Error("no admin login to own the programs");

  const templates: InstallReport["templates"] = [];
  for (const t of lib) {
    let json = JSON.stringify(t.payload);
    for (const [from, to] of idMap) if (from !== to) json = json.split(from).join(to);
    const payload = JSON.parse(json);
    if (existing.has(t.id)) {
      templates.push({ id: t.id, name: t.name, action: "already in the library", ...payloadSummary(payload) });
      continue;
    }
    if (apply) {
      unwrap(
        await admin.from("pl_templates").upsert(
          {
            id: t.id,
            name: t.name,
            template_type: t.template_type,
            training_style: t.training_style,
            training_focus: t.training_focus,
            tags: t.tags,
            status: t.status,
            weeks: t.weeks,
            days_per_week: t.days_per_week,
            est_duration_min: t.est_duration_min,
            goal: t.goal,
            description: t.description,
            notes: t.notes,
            payload,
            archived: false,
            owner_role: "admin",
            owner_user_id: owner,
            created_by: owner,
            visibility: "team",
            payload_revision: 1,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
        `add ${t.name}`,
      );
    }
    templates.push({ id: t.id, name: t.name, action: apply ? "added" : "would add", ...payloadSummary(payload) });
  }

  // 3. After applying, read every program back and count what's really stored.
  if (apply) {
    const stored = unwrap<any[]>(
      await admin.from("pl_templates").select("id, payload").in("id", lib.map((t) => t.id)),
      "read the programs back",
    );
    const byId = new Map(stored.map((r) => [r.id, r.payload]));
    for (const row of templates) {
      const p = byId.get(row.id);
      if (!p) throw new Error(`${row.name} isn't in the library after adding it`);
      Object.assign(row, payloadSummary(p));
    }
  }

  const totals = templates.reduce(
    (a, t) => ({
      programs: a.programs + 1,
      blocks: a.blocks + t.blocks,
      weeks: a.weeks + t.weeks,
      coreDays: a.coreDays + t.coreDays,
      optionalDays: a.optionalDays + t.optionalDays,
      rows: a.rows + t.rows,
    }),
    { programs: 0, blocks: 0, weeks: 0, coreDays: 0, optionalDays: 0, rows: 0 },
  );
  return { applied: apply, exercises, templates, totals };
}
