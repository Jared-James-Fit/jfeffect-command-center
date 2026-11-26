/**
 * App Review demo data (admin only): prepare / remove synthetic training for the two demo logins.
 * The rules and the made-up content are in app-review-demo.ts (pure, tested). This file never
 * creates a user or touches a login's credentials: the two logins are made by Jared and found by email.
 *
 * A program is started the way a coach assigns one (`pl_assign_template_to_client`, run as the
 * signed-in admin, who it authorizes) from a live library plan, so the workout screens, history
 * and analytics all read it normally. Logged sets, finished workouts, a check-in and a cardio plan
 * are inserted for it. Every row created is written to app_review_demo_records as it is made, and
 * removal deletes only those ids (results and finished workouts before the program, which the
 * history guard requires).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEMO_DELETE_ORDER,
  DEMO_LOGGED_WORKOUTS,
  DEMO_SETTINGS_KEY,
  chunk,
  dateOnly,
  daysAgoAt,
  demoCardio,
  demoCheckIn,
  demoCompletion,
  demoRefusal,
  demoSets,
  escapeIlike,
  groupByTable,
  parseDemoConfig,
  summarize,
  type DemoAccountKey,
  type DemoRow,
  type DemoTable,
  type DemoTarget,
} from "@/lib/app-review-demo";

type Counts = Record<string, number>;
export type DemoAccountStatus = { key: DemoAccountKey; email: string; found: boolean; tier: string | null; hasLogin: boolean; counts: Counts; summary: string; note: string | null };
export type DemoStatus = { accounts: DemoAccountStatus[] };

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function loadConfig(db: any) {
  const { data } = await db.from("app_settings").select("value").eq("key", DEMO_SETTINGS_KEY).maybeSingle();
  return parseDemoConfig((data as any)?.value);
}

async function findTarget(db: any, email: string): Promise<DemoTarget | null> {
  const { data, error } = await db
    .from("clients")
    .select("id, user_id, service_tier, archived, email, preferred_weight_unit")
    .ilike("email", escapeIlike(email))
    .order("created_at", { ascending: true })
    .limit(2);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  // two records for one address is not a demo login: refuse rather than guess
  if (rows.length > 1) throw new Error(`More than one client record uses ${email}. Fix that first; nothing was changed.`);
  return rows[0] ?? null;
}

async function registered(db: any, key: DemoAccountKey): Promise<Array<{ table_name: string; record_id: string }>> {
  const out: Array<{ table_name: string; record_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("app_review_demo_records").select("table_name, record_id").eq("account_key", key).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function countOf(db: any, table: string, clientId: string): Promise<number> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function accountStatus(db: any, key: DemoAccountKey, email: string): Promise<DemoAccountStatus> {
  const target = await findTarget(db, email);
  const rows = await registered(db, key);
  const counts: Counts = {};
  for (const r of rows) counts[r.table_name] = (counts[r.table_name] ?? 0) + 1;
  return {
    key,
    email,
    found: !!target,
    tier: target?.service_tier ?? null,
    hasLogin: !!target?.user_id,
    counts,
    summary: summarize({ counts }),
    note: demoRefusal(key, email, target, { programs: 0, checkIns: 0, cardio: 0 }, rows.length),
  };
}

export const getAppReviewDemoStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DemoStatus> => {
    await assertAdmin(context);
    const db = await admin();
    const cfg = await loadConfig(db);
    return {
      accounts: [await accountStatus(db, "client", cfg.clientEmail), await accountStatus(db, "member", cfg.memberEmail)],
    };
  });

async function register(db: any, key: DemoAccountKey, email: string, table: DemoTable, ids: string[]) {
  for (const part of chunk(ids, 500)) {
    const { error } = await db
      .from("app_review_demo_records")
      .upsert(part.map((record_id) => ({ account_key: key, account_email: email, table_name: table, record_id })), { onConflict: "table_name,record_id", ignoreDuplicates: true });
    if (error) throw new Error(`Could not record the demo data: ${error.message}`);
  }
}

async function insertAll(db: any, table: DemoTable, rows: Array<Record<string, unknown>>, key: DemoAccountKey, email: string): Promise<string[]> {
  const ids: string[] = [];
  for (const part of chunk(rows, 200)) {
    const { data, error } = await db.from(table).insert(part).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const got = ((data ?? []) as any[]).map((r) => r.id as string);
    // listed the moment they exist, so a failure later still leaves them removable
    await register(db, key, email, table, got);
    ids.push(...got);
  }
  return ids;
}

/** A live library plan to copy as the demo program (any will do: its content is JF Effect's own). */
async function pickTemplate(db: any): Promise<{ templateId: string; days: number } | null> {
  const { data } = await db
    .from("member_plans")
    .select("source_template_id, days_per_week, weeks")
    .eq("status", "Published")
    .eq("membership_status", "live")
    .not("source_template_id", "is", null)
    .order("days_per_week", { ascending: true })
    .order("weeks", { ascending: true })
    .limit(1);
  const p = (data ?? [])[0] as any;
  return p ? { templateId: p.source_template_id as string, days: Number(p.days_per_week) || 0 } : null;
}

async function seedAccount(context: any, db: any, key: DemoAccountKey, email: string, now: Date): Promise<{ email: string; status: "seeded" | "already" | "refused"; message: string }> {
  const target = await findTarget(db, email);
  const rows = await registered(db, key);
  let own = { programs: 0, checkIns: 0, cardio: 0 };
  if (target) {
    own = {
      programs: await countOf(db, "pl_blocks", target.id),
      checkIns: await countOf(db, "messenger_checkins", target.id),
      cardio: await countOf(db, "cardio_targets", target.id),
    };
  }
  const refusal = demoRefusal(key, email, target, own, rows.length);
  if (refusal) return { email, status: "refused", message: refusal };
  if (rows.length) return { email, status: "already", message: `${email} already has the demo data (${summarize({ counts: counts(rows) })}). Remove it first to start over.` };

  const t = target as DemoTarget & { preferred_weight_unit?: string | null };
  const unit: "lb" | "kg" = t.preferred_weight_unit === "kg" ? "kg" : "lb";
  const template = await pickTemplate(db);
  if (!template) return { email, status: "refused", message: "There is no live library plan to copy as the demo program. Publish one in Admin → Member plans first." };

  // 1. the program, as a coach would assign it: started three weeks ago so a few workouts are behind
  const start = dateOnly(daysAgoAt(now, 21));
  const label = key === "client" ? "Demo program (App Review)" : "Demo plan (App Review)";
  const { data: res, error: rpcErr } = await context.supabase.rpc("pl_assign_template_to_client", {
    p_template_id: template.templateId,
    p_client_id: t.id,
    p_placement: { mode: "standalone_block" },
    p_name: label,
    p_client_visible: true,
    p_start_date: start,
    p_end_date: null,
    p_selected_block_ids: null,
    p_start_from_block_id: null,
  });
  if (rpcErr) throw new Error(`Could not start the demo program: ${rpcErr.message}`);
  const made = (res ?? {}) as { block_id?: string; prep_id?: string };
  const blockQuery = db.from("pl_blocks").select("id").eq("client_id", t.id);
  const { data: blocks, error: blockErr } = made.prep_id
    ? await blockQuery.eq("prep_id", made.prep_id)
    : await blockQuery.eq("id", made.block_id ?? "00000000-0000-0000-0000-000000000000");
  if (blockErr) throw new Error(blockErr.message);
  const blockIds = ((blocks ?? []) as any[]).map((b) => b.id as string);
  if (made.prep_id) await register(db, key, email, "pl_preps", [made.prep_id]);
  await register(db, key, email, "pl_blocks", blockIds);
  if (!blockIds.length) throw new Error("The demo program was not created.");
  // a plan the member started themselves reads as theirs (as the library's own Start does)
  if (key === "member" && t.user_id) {
    await db.from("pl_blocks").update({ created_by: t.user_id } as any).in("id", blockIds);
    if (made.prep_id) await db.from("pl_preps").update({ created_by: t.user_id } as any).eq("id", made.prep_id);
  }

  // 2. the first workouts of the first block, logged on past dates
  const { data: weeks } = await db.from("pl_weeks").select("id, week_index").eq("block_id", blockIds[0]).order("week_index", { ascending: true }).limit(1);
  const weekId = (weeks ?? [])[0]?.id as string | undefined;
  const { data: days } = weekId
    ? await db.from("pl_days").select("id, day_index").eq("week_id", weekId).is("deleted_at", null).order("day_index", { ascending: true }).limit(DEMO_LOGGED_WORKOUTS)
    : { data: [] as any[] };
  const dayList = ((days ?? []) as any[]).map((d) => d.id as string);
  const sets: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  for (let i = 0; i < dayList.length; i++) {
    const at = daysAgoAt(now, 17 - i * 2);
    const { data: exRows } = await db
      .from("pl_exercise_rows")
      .select("id, sets, reps_text, load_lb, load_kg, measurement_type, duration_seconds")
      .eq("day_id", dayList[i])
      .order("sort_order", { ascending: true });
    sets.push(...demoSets((exRows ?? []) as DemoRow[], { clientId: t.id, unit, completedAt: at }));
    completions.push(demoCompletion({ dayId: dayList[i], clientId: t.id, completedAt: at }));
  }
  if (sets.length) await insertAll(db, "pl_row_results", sets, key, email);
  if (completions.length) await insertAll(db, "pl_day_completions", completions, key, email);

  // 3. a check-in and a cardio plan for the coaching client
  if (key === "client") {
    await insertAll(db, "messenger_checkins", [demoCheckIn({ clientId: t.id, submittedAt: daysAgoAt(now, 3) })], key, email);
    await insertAll(db, "cardio_targets", [demoCardio({ clientId: t.id, startDate: dateOnly(daysAgoAt(now, 14)) })], key, email);
  }

  const done = await registered(db, key);
  return { email, status: "seeded", message: `${email}: ${summarize({ counts: counts(done) })}.` };
}

function counts(rows: Array<{ table_name: string }>): Counts {
  const c: Counts = {};
  for (const r of rows) c[r.table_name] = (c[r.table_name] ?? 0) + 1;
  return c;
}

export const prepareAppReviewDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const cfg = await loadConfig(db);
    const now = new Date();
    const results = [];
    for (const [key, email] of [["client", cfg.clientEmail], ["member", cfg.memberEmail]] as const) {
      try {
        results.push(await seedAccount(context, db, key, email, now));
      } catch (e: any) {
        // what was written before the failure is already listed, so Remove demo data clears it
        results.push({ email, status: "refused" as const, message: `${email}: ${e?.message ?? "failed"}. What was already added can be taken away with Remove demo data.` });
      }
    }
    return { results };
  });

export const removeAppReviewDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const removed: Counts = {};
    for (const key of ["client", "member"] as const) {
      const grouped = groupByTable(await registered(db, key));
      // children first: logged sets and finished workouts, then the program (the history guard refuses the other way round)
      for (const table of DEMO_DELETE_ORDER) {
        for (const part of chunk(grouped[table], 200)) {
          const { error } = await db.from(table).delete().in("id", part);
          if (error) throw new Error(`Could not remove ${table}: ${error.message}. Nothing else was touched; try again.`);
          await db.from("app_review_demo_records").delete().eq("table_name", table).in("record_id", part);
          removed[table] = (removed[table] ?? 0) + part.length;
        }
      }
    }
    return { removed, summary: summarize({ counts: removed }) };
  });
