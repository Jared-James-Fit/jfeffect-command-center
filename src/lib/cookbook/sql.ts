/**
 * The cookbook migration, generated from library.ts (never hand-edited:
 * cookbook-library.test.ts fails when the file and the definitions disagree).
 *
 *   npx tsx scripts/cookbook/write-migration.ts
 *
 * What it does, in order, each step safe to run twice:
 *   1. backs up every audited recipe row, as it was, into
 *      recipes_cookbook_backup_20261115 (closed to the app: RLS, no policies);
 *   2. rewrites the 31 audited recipes the new cookbook keeps, in place (same
 *      id, so their views stay with them), only while the body is still the
 *      audited text;
 *   3. adds the one new recipe (a fixed id, only if it isn't there);
 *   4. archives the other 128 audited recipes (status Archived: hidden from
 *      the cookbook, kept for the coach, who can publish any of them again),
 *      again only while each is still exactly as audited.
 * Recipes anyone published after the audit are never touched. Nothing is
 * deleted.
 */

import { AUDITED_RECIPES } from "./audit-2026-11";
import { COOKBOOK, recipeBody, recipeMacros, recipeTags, type CookbookRecipe } from "./library";

export const COOKBOOK_MIGRATION = "supabase/migrations/20270326091000_cookbook_bodybuilding_library.sql";
export const BACKUP_TABLE = "public.recipes_cookbook_backup_20261115";

const auditedIds = new Set(AUDITED_RECIPES.map(([id]) => id));

export function keptRecipes(): CookbookRecipe[] {
  return COOKBOOK.filter((r) => auditedIds.has(r.id));
}
export function newRecipes(): CookbookRecipe[] {
  return COOKBOOK.filter((r) => !auditedIds.has(r.id));
}
export function archivedAudit(): ReadonlyArray<readonly [string, string, string]> {
  const kept = new Set(COOKBOOK.map((r) => r.id));
  return AUDITED_RECIPES.filter(([id]) => !kept.has(id));
}

/** A dollar-quoted literal (no recipe text contains the tag). */
function lit(text: string): string {
  if (text.includes("$cb$")) throw new Error("recipe text contains $cb$");
  return `$cb$${text}$cb$`;
}

function arr(tags: string[]): string {
  return `ARRAY[${tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
}

function md5Of(id: string): string {
  const row = AUDITED_RECIPES.find(([rid]) => rid === id);
  if (!row) throw new Error(`not audited: ${id}`);
  return row[1];
}

export function cookbookSql(): string {
  const out: string[] = [];
  out.push(
    "-- The JF Effect Cookbook, simplified (Nov 15 2026). GENERATED from",
    "-- src/lib/cookbook (library.ts, sql.ts): edit those and run",
    "-- `npx tsx scripts/cookbook/write-migration.ts`, never this file.",
    "--",
    "-- 159 published recipes became 32 simple, high-protein ones (most 10 minutes",
    "-- or less hands-on, a few everyday ingredients, numbers worked out from the",
    "-- ingredients, a cutting and a bulking line on each). 31 of them rewrite an",
    "-- older recipe in place (same id: its views stay), 1 is new, and the other",
    "-- 128 are archived, never deleted. Every audited row is backed up first.",
    "-- Each step only touches a recipe still exactly as audited (md5 of its",
    "-- body), so running this twice, or after the coach edits one, changes",
    "-- nothing it shouldn't.",
    "",
    "-- 1. Backup (closed to the app: RLS on, no policies).",
    `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (LIKE public.recipes);`,
    `ALTER TABLE ${BACKUP_TABLE} ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();`,
    `ALTER TABLE ${BACKUP_TABLE} ENABLE ROW LEVEL SECURITY;`,
    `REVOKE ALL ON ${BACKUP_TABLE} FROM anon, authenticated;`,
    `INSERT INTO ${BACKUP_TABLE}`,
    "SELECT r.*, now() FROM public.recipes r",
    `WHERE r.id IN (${AUDITED_RECIPES.map(([id]) => `'${id}'`).join(",\n  ")})`,
    `  AND NOT EXISTS (SELECT 1 FROM ${BACKUP_TABLE} b WHERE b.id = r.id);`,
    "",
    "-- 2. The recipes the cookbook keeps, rewritten in place.",
  );

  for (const r of keptRecipes()) {
    const m = recipeMacros(r);
    out.push(
      `UPDATE public.recipes SET`,
      `  title = ${lit(r.title)},`,
      `  category = '${r.category}',`,
      `  status = 'Published',`,
      `  access_scope = 'everyone',`,
      `  body = ${lit(recipeBody(r))},`,
      `  tags = ${arr(recipeTags(r))},`,
      `  calories_per_serving = ${m.calories},`,
      `  protein_grams = ${m.protein},`,
      `  prep_time_minutes = ${r.prepMinutes},`,
      `  servings = ${r.servings},`,
      `  published_at = COALESCE(published_at, now()),`,
      `  updated_at = now()`,
      `WHERE id = '${r.id}' AND md5(body) = '${md5Of(r.id)}';`,
      "",
    );
  }

  out.push("-- 3. New recipes.");
  for (const r of newRecipes()) {
    const m = recipeMacros(r);
    out.push(
      "INSERT INTO public.recipes (id, title, category, status, access_scope, body, tags, calories_per_serving, protein_grams, prep_time_minutes, servings, published_at)",
      `SELECT '${r.id}', ${lit(r.title)}, '${r.category}', 'Published', 'everyone', ${lit(recipeBody(r))}, ${arr(recipeTags(r))}, ${m.calories}, ${m.protein}, ${r.prepMinutes}, ${r.servings}, now()`,
      `WHERE NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = '${r.id}');`,
      "",
    );
  }

  out.push("-- 4. Everything else from the audit: archived (the coach can publish any again).");
  out.push(
    "UPDATE public.recipes r SET status = 'Archived', updated_at = now()",
    "FROM (VALUES",
    archivedAudit()
      .map(([id, md5, title]) => `  ('${id}'::uuid, '${md5}') -- ${title.replace(/\n/g, " ")}`)
      .join(",\n"),
    ") AS a(id, body_md5)",
    "WHERE r.id = a.id AND r.status = 'Published' AND md5(r.body) = a.body_md5;",
    "",
  );
  return out.join("\n");
}
