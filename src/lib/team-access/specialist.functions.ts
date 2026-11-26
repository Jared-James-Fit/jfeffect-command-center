/**
 * What a specialist (a game day coach, a performance specialist) reads and
 * writes. Every function asks the database first, with the caller's own
 * login, whether they may see that athlete's category right now
 * (assertSpecialistCan → specialist_can_view), then reads with the service
 * role only the columns that category allows: never a coach's notes, a
 * program's notes, messages, nutrition, check-ins or recovery.
 *
 * Notes a specialist writes are theirs: private unless they share one with
 * the athlete, never read by any admin, coach or Cleo path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CategoryFlags, SpecialistPreset } from "@/lib/team-access/presets";

const Uuid = z.string().uuid();

export type SpecialistMe = {
  userId: string;
  preset: SpecialistPreset;
  title: string;
  displayName: string | null;
  phone: string | null;
  timeZone: string | null;
  headshotUrl: string | null;
  status: "active" | "suspended";
  /** what's still needed before they see anything */
  needs: Array<"display_name" | "phone" | "time_zone" | "headshot" | "confidentiality">;
};

export type SpecialistAthlete = {
  clientId: string;
  name: string;
  firstName: string;
} & CategoryFlags;

async function myRecord(ctx: any): Promise<SpecialistMe | null> {
  const { data } = await ctx.supabase
    .from("team_specialists")
    .select(
      "user_id, preset, title, status, display_name, phone, time_zone, headshot_path, confidentiality_at",
    )
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) return null;
  const needs: SpecialistMe["needs"] = [];
  if (!data.display_name) needs.push("display_name");
  if (!data.phone) needs.push("phone");
  if (!data.time_zone) needs.push("time_zone");
  if (!data.headshot_path) needs.push("headshot");
  if (!data.confidentiality_at) needs.push("confidentiality");
  let headshotUrl: string | null = null;
  if (data.headshot_path) {
    const { data: signed } = await ctx.supabase.storage
      .from("avatars")
      .createSignedUrl(data.headshot_path, 3600);
    headshotUrl = signed?.signedUrl ?? null;
  }
  return {
    userId: data.user_id,
    preset: data.preset,
    title: data.title,
    displayName: data.display_name,
    phone: data.phone,
    timeZone: data.time_zone,
    headshotUrl,
    status: data.status,
    needs,
  };
}

/** The specialist's own record and their athletes (empty until their profile is done). */
export const getSpecialistHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ me: SpecialistMe | null; athletes: SpecialistAthlete[] }> => {
      const ctx = context as any;
      const me = await myRecord(ctx);
      if (!me) return { me: null, athletes: [] };
      if (me.status !== "active" || me.needs.length) return { me, athletes: [] };
      const { data: rows, error } = await ctx.supabase.rpc("specialist_my_athletes");
      if (error) throw new Error("Couldn't load your athletes.");
      const list = (rows ?? []) as Array<{ client_id: string } & CategoryFlags>;
      if (!list.length) return { me, athletes: [] };
      const { serviceDb } = await import("@/lib/team-access/access.server");
      const db = await serviceDb();
      const { data: clients } = await db
        .from("clients")
        .select("id, full_name, first_name, preferred_name")
        .in(
          "id",
          list.map((r) => r.client_id),
        );
      const byId = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
      const athletes = list.map((r) => {
        const c = byId.get(r.client_id);
        const name = (
          c?.full_name ||
          [c?.first_name].filter(Boolean).join(" ") ||
          "Athlete"
        ).trim();
        const firstName = (
          c?.preferred_name ||
          c?.first_name ||
          name.split(" ")[0] ||
          "Athlete"
        ).trim();
        return {
          clientId: r.client_id,
          name,
          firstName,
          footage: !!r.footage,
          training: !!r.training,
          performance: !!r.performance,
        };
      });
      return { me, athletes: athletes.sort((a, b) => a.name.localeCompare(b.name)) };
    },
  );

const ProfileInput = z.object({
  displayName: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(7).max(30),
  timeZone: z.string().trim().min(3).max(64),
  /** a photo they uploaded to their own folder in the avatars bucket */
  headshotPath: z.string().trim().min(3).max(300).nullable().optional(),
  agree: z.boolean().optional(),
});

/** The specialist finishes (or changes) their own profile. */
export const saveSpecialistProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProfileInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const me = await myRecord(ctx);
    if (!me) throw new Error("This isn't a specialist account.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timeZone });
    } catch {
      throw new Error("Pick a time zone from the list.");
    }
    if (data.headshotPath && !data.headshotPath.startsWith(`${ctx.userId}/`)) {
      throw new Error("That photo isn't yours.");
    }
    const { normalizePhone } = await import("@/lib/sms-policy");
    const phone = normalizePhone(data.phone);
    if (!phone) throw new Error("Enter a phone number with its area code.");
    const { CONFIDENTIALITY_TEXT } = await import("@/lib/team-access/presets");
    const { serviceDb } = await import("@/lib/team-access/access.server");
    const db = await serviceDb();
    const patch: Record<string, unknown> = {
      display_name: data.displayName,
      phone,
      time_zone: data.timeZone,
    };
    if (data.headshotPath) patch.headshot_path = data.headshotPath;
    if (me.needs.includes("confidentiality")) {
      if (data.agree !== true)
        throw new Error("Tick the box to keep athletes' information private.");
      patch.confidentiality_text = CONFIDENTIALITY_TEXT;
      patch.confidentiality_at = new Date().toISOString();
    }
    const stillNeedsHeadshot = me.needs.includes("headshot") && !data.headshotPath;
    if (!stillNeedsHeadshot) patch.profile_completed_at = new Date().toISOString();
    const { error } = await db.from("team_specialists").update(patch).eq("user_id", ctx.userId);
    if (error) throw new Error("Couldn't save your profile. Try again.");
    await db.from("profiles").update({ full_name: data.displayName, phone }).eq("id", ctx.userId);
    return { ok: true };
  });

/* ---------- Footage ---------- */

export type FootageResponse = {
  items: import("@/lib/team-access/footage").FootageItem[];
  thumbs: Record<string, string>;
  watched: string[];
};

export const getSpecialistFootage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: Uuid }).parse(i))
  .handler(async ({ data, context }): Promise<FootageResponse> => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb, signPaths, readAll, chunks } =
      await import("@/lib/team-access/access.server");
    await assertSpecialistCan(ctx, data.clientId, "footage");
    const db = await serviceDb();
    const [videos, hidden] = await Promise.all([
      readAll((from, to) =>
        db
          .from("pl_set_videos")
          .select(
            "id, created_at, set_index, warmup_id, result_id, row_id, day_id, exercise_name, workout_title, duration_s, thumbnail_path",
          )
          .eq("client_id", data.clientId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      db.from("specialist_hidden_videos").select("set_video_id").eq("client_id", data.clientId),
    ]);
    const hiddenIds = new Set(((hidden.data ?? []) as any[]).map((h) => h.set_video_id));
    const list = (videos as any[]).filter((v) => !hiddenIds.has(v.id)).slice(0, 400);

    const resultIds = [...new Set(list.map((v) => v.result_id).filter(Boolean))] as string[];
    const rowIds = [...new Set(list.map((v) => v.row_id).filter(Boolean))] as string[];
    const dayIds = [...new Set(list.map((v) => v.day_id).filter(Boolean))] as string[];
    const results = new Map<string, any>();
    for (const part of chunks(resultIds)) {
      const { data: rs } = await db
        .from("pl_row_results")
        .select(
          "id, completed_at, entered_value, entered_unit, normalized_kg, actual_reps, actual_rpe, actual_rir, mean_concentric_velocity_mps, velocity_excluded, velocity_quality, load_type, is_bodyweight, client_id",
        )
        .in("id", part);
      for (const r of (rs ?? []) as any[]) if (r.client_id === data.clientId) results.set(r.id, r);
    }
    const rows = new Map<string, any>();
    for (const part of chunks(rowIds)) {
      const { data: rs } = await db
        .from("pl_exercise_rows")
        .select(
          "id, rpe, rir, reps_text, sets, purpose_label, exercise_name_override, exercises(name, is_competition_lift, competition_lift_type, movement_family, equipment)",
        )
        .in("id", part);
      for (const r of (rs ?? []) as any[]) rows.set(r.id, r);
    }
    const days = new Map<string, string | null>();
    for (const part of chunks(dayIds)) {
      const { data: ds } = await db.from("pl_days").select("id, scheduled_date").in("id", part);
      for (const d of (ds ?? []) as any[]) days.set(d.id, d.scheduled_date ?? null);
    }
    // the set's name in its workout ("Top set", "Backoff 2"), as the coach chat says it
    const setNames = new Map<string, string>();
    await Promise.all(
      dayIds.slice(0, 80).map(async (dayId) => {
        const { data: names } = await db.rpc("pl_day_set_names", { _day: dayId });
        for (const n of (names ?? []) as any[])
          if (n.set_name) setNames.set(`${n.row_id}:${n.set_index}`, n.set_name);
      }),
    );

    const { footageItem, sortFootage } = await import("@/lib/team-access/footage");
    const items = sortFootage(
      list.map((v) => {
        const row = v.row_id ? rows.get(v.row_id) : null;
        return footageItem({
          id: v.id,
          created_at: v.created_at,
          set_index: v.set_index,
          warmup: !!v.warmup_id || v.set_index === 0,
          set_name:
            v.row_id && v.set_index ? (setNames.get(`${v.row_id}:${v.set_index}`) ?? null) : null,
          exercise_name: v.exercise_name,
          workout_title: v.workout_title,
          duration_s: v.duration_s,
          day_date: v.day_id ? (days.get(v.day_id) ?? null) : null,
          result: v.result_id ? (results.get(v.result_id) ?? null) : null,
          row: row
            ? {
                rpe: row.rpe,
                rir: row.rir,
                reps_text: row.reps_text,
                sets: row.sets,
                purpose_label: row.purpose_label,
                exercise_name_override: row.exercise_name_override,
              }
            : null,
          exercise: row?.exercises ?? null,
        });
      }),
    );
    const thumbPaths = list.map((v) => v.thumbnail_path).filter(Boolean) as string[];
    const signed = await signPaths(db, thumbPaths);
    const thumbs: Record<string, string> = {};
    for (const v of list)
      if (v.thumbnail_path && signed.has(v.thumbnail_path))
        thumbs[v.id] = signed.get(v.thumbnail_path)!;
    const { data: views } = await db
      .from("specialist_video_views")
      .select("set_video_id")
      .eq("user_id", ctx.userId)
      .in("set_video_id", list.map((v) => v.id).slice(0, 400));
    return { items, thumbs, watched: ((views ?? []) as any[]).map((w) => w.set_video_id) };
  });

/** The clip itself, on a short-lived link, after checking again. */
export const getSpecialistVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ videoId: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb, signPaths } =
      await import("@/lib/team-access/access.server");
    const db = await serviceDb();
    const { data: v } = await db
      .from("pl_set_videos")
      .select("id, client_id, storage_path, feed_path, thumbnail_path, mime, deleted_at")
      .eq("id", data.videoId)
      .maybeSingle();
    // one answer whether the clip doesn't exist or isn't theirs
    if (!v || v.deleted_at) throw new Error("You don't have access to this athlete's footage.");
    await assertSpecialistCan(ctx, v.client_id, "footage");
    const { data: hid } = await db
      .from("specialist_hidden_videos")
      .select("set_video_id")
      .eq("set_video_id", v.id)
      .maybeSingle();
    if (hid) throw new Error("You don't have access to this athlete's footage.");
    const signed = await signPaths(
      db,
      [v.storage_path, v.feed_path, v.thumbnail_path].filter(Boolean),
    );
    const original = v.storage_path ? (signed.get(v.storage_path) ?? null) : null;
    if (!original) throw new Error("This clip isn't available right now.");
    return {
      url: original,
      // the lighter copy plays sooner on a phone; the original is there for frame-by-frame
      fastUrl: v.feed_path ? (signed.get(v.feed_path) ?? null) : null,
      poster: v.thumbnail_path ? (signed.get(v.thumbnail_path) ?? null) : null,
      mime: v.mime ?? null,
    };
  });

export const markFootageWatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ videoId: Uuid, watched: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb } = await import("@/lib/team-access/access.server");
    const db = await serviceDb();
    const { data: v } = await db
      .from("pl_set_videos")
      .select("client_id")
      .eq("id", data.videoId)
      .maybeSingle();
    if (!v) throw new Error("You don't have access to this athlete's footage.");
    await assertSpecialistCan(ctx, v.client_id, "footage");
    if (data.watched) {
      await db
        .from("specialist_video_views")
        .upsert(
          { user_id: ctx.userId, set_video_id: data.videoId },
          { onConflict: "user_id,set_video_id" },
        );
    } else {
      await db
        .from("specialist_video_views")
        .delete()
        .eq("user_id", ctx.userId)
        .eq("set_video_id", data.videoId);
    }
    return { ok: true };
  });

/* ---------- Training ---------- */

export const getSpecialistTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: Uuid, blockId: Uuid.nullable().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb, todayIn, readAll, chunks } =
      await import("@/lib/team-access/access.server");
    await assertSpecialistCan(ctx, data.clientId, "training");
    const db = await serviceDb();
    const { data: client } = await db
      .from("clients")
      .select("timezone")
      .eq("id", data.clientId)
      .maybeSingle();
    const today = todayIn(client?.timezone);
    // only what the athlete themselves sees: visible, not archived, never the
    // at-home backup blocks; never coach_notes, goal or block_meta
    const { data: blockRows, error: bErr } = await db
      .from("pl_blocks")
      .select("id, name, start_date, end_date, sort_order, source_template_block_key")
      .eq("client_id", data.clientId)
      .eq("client_visible", true)
      .eq("archived", false);
    if (bErr) throw new Error("Couldn't load the training.");
    const { filterPrimaryProgramBlocks } = await import("@/lib/at-home-backup");
    const blocks = filterPrimaryProgramBlocks((blockRows ?? []) as any[]);
    if (!blocks.length) {
      const { buildTrainingView } = await import("@/lib/team-access/training");
      return buildTrainingView({
        blocks: [],
        weeks: [],
        days: [],
        rows: [],
        results: [],
        doneDayIds: new Set(),
        today,
      });
    }
    const blockIds = blocks.map((b: any) => b.id);
    const weeks = await readAll((from, to) =>
      db
        .from("pl_weeks")
        .select("id, block_id, week_index, start_date, end_date, phase")
        .in("block_id", blockIds)
        .eq("archived", false)
        .is("deleted_at", null)
        .range(from, to),
    );
    const weekIds = (weeks as any[]).map((w) => w.id);
    const days: any[] = [];
    for (const part of chunks(weekIds)) {
      days.push(
        ...(await readAll((from, to) =>
          db
            .from("pl_days")
            .select("id, week_id, day_index, title, subtitle, scheduled_date, is_optional")
            .in("week_id", part)
            .eq("archived", false)
            .is("deleted_at", null)
            .range(from, to),
        )),
      );
    }
    const dayIds = days.map((d) => d.id);
    const { currentBlockId } = await import("@/lib/team-access/training");
    const pick =
      data.blockId && blockIds.includes(data.blockId)
        ? data.blockId
        : currentBlockId(blocks as any, today);
    const pickWeekIds = new Set(
      (weeks as any[]).filter((w) => w.block_id === pick).map((w) => w.id),
    );
    const pickDayIds = days.filter((d) => pickWeekIds.has(d.week_id)).map((d) => d.id);

    const rows: any[] = [];
    for (const part of chunks(pickDayIds)) {
      rows.push(
        ...(await readAll((from, to) =>
          db
            .from("pl_exercise_rows")
            .select(
              "id, day_id, sort_order, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, measurement_type, duration_seconds, purpose_label, movement_family, exercises(name, is_competition_lift, competition_lift_type, movement_family, equipment)",
            )
            .in("day_id", part)
            .range(from, to),
        )),
      );
    }
    const results: any[] = [];
    for (const part of chunks(rows.map((r) => r.id))) {
      results.push(
        ...(await readAll((from, to) =>
          db
            .from("pl_row_results")
            .select(
              "row_id, set_index, actual_reps, actual_load, actual_load_unit, entered_value, entered_unit, actual_rpe, actual_rir, completed_duration_seconds, actual_calories, actual_distance_m, actual_distance_unit, completed_at, client_id",
            )
            .eq("client_id", data.clientId)
            .in("row_id", part)
            .not("completed_at", "is", null)
            .range(from, to),
        )),
      );
    }
    const done = new Set<string>();
    const moved = new Map<string, string>();
    for (const part of chunks(dayIds)) {
      const [{ data: comps }, { data: sched }] = await Promise.all([
        db
          .from("pl_day_completions")
          .select("day_id")
          .eq("client_id", data.clientId)
          .in("day_id", part)
          .not("completed_at", "is", null),
        db
          .from("pl_scheduled_workouts")
          .select("source_day_id, scheduled_date")
          .eq("client_id", data.clientId)
          .in("source_day_id", part),
      ]);
      for (const c of (comps ?? []) as any[]) done.add(c.day_id);
      for (const s of (sched ?? []) as any[]) {
        if (!s.source_day_id || !s.scheduled_date) continue;
        const cur = moved.get(s.source_day_id);
        if (!cur || s.scheduled_date < cur) moved.set(s.source_day_id, s.scheduled_date);
      }
    }
    const { buildTrainingView } = await import("@/lib/team-access/training");
    return buildTrainingView({
      blocks: blocks as any,
      weeks: weeks as any,
      days,
      rows,
      results: results.map(({ client_id: _c, ...r }) => r),
      doneDayIds: done,
      movedDates: moved,
      today,
      blockId: pick,
    });
  });

/* ---------- Performance ---------- */

export const getSpecialistPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb, todayIn, readAll } =
      await import("@/lib/team-access/access.server");
    await assertSpecialistCan(ctx, data.clientId, "performance");
    const db = await serviceDb();
    const { data: client } = await db
      .from("clients")
      .select("timezone")
      .eq("id", data.clientId)
      .maybeSingle();
    const today = todayIn(client?.timezone);
    const { CLIENT_RESULT_SELECT, mapClientResultRow } =
      await import("@/lib/analytics/client-result-row");
    const raw = await readAll((from, to) =>
      db
        .from("pl_row_results")
        .select(CLIENT_RESULT_SELECT)
        .eq("client_id", data.clientId)
        .not("actual_reps", "is", null)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    const { neutralizeObviousLoadOutliers } = await import("@/lib/analytics/load-sanity");
    // the athlete's own exercise notes never leave the server
    const results = neutralizeObviousLoadOutliers(
      (raw as any[]).map((r) => ({ ...mapClientResultRow(r), exercise_note: null })),
    );

    const { data: athlete } = await db
      .from("powerlifting_athletes")
      .select("id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    const { data: meetRows } = await db
      .from("athlete_powerlifting_results")
      .select(
        "meet_date, meet_name, federation, place, weight_class_kg, squat_kg, bench_kg, deadlift_kg, total_kg, bodyweight_kg, attempts",
      )
      .or(
        athlete
          ? `client_id.eq.${data.clientId},athlete_id.eq.${athlete.id}`
          : `client_id.eq.${data.clientId}`,
      )
      .not("meet_date", "is", null)
      .order("meet_date", { ascending: false })
      .limit(60);

    // the next meet: their competition plan's, else a meet prep's
    let upcoming: import("@/lib/team-access/performance").UpcomingMeet | null = null;
    const { data: comps } = await db
      .from("competitions")
      .select(
        "name, meet_date, federation, weight_class, location, status, is_primary, internal_test",
      )
      .eq("client_id", data.clientId)
      .gte("meet_date", today)
      .order("meet_date", { ascending: true })
      .limit(10);
    const comp = ((comps ?? []) as any[]).find(
      (c) =>
        !c.internal_test &&
        !["cancelled", "canceled", "completed", "finished"].includes(
          String(c.status ?? "").toLowerCase(),
        ),
    );
    if (comp?.meet_date) {
      upcoming = {
        name: comp.name || "Next meet",
        date: String(comp.meet_date).slice(0, 10),
        federation: comp.federation ?? null,
        weightClass: comp.weight_class ?? null,
        location: comp.location ?? null,
      };
    } else {
      const { data: preps } = await db
        .from("pl_preps")
        .select(
          "event_name, title, event_date, federation, weight_class, event_location, archived, client_visible",
        )
        .eq("client_id", data.clientId)
        .eq("archived", false)
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .limit(1);
      const p = ((preps ?? []) as any[])[0];
      if (p?.event_date && p.client_visible !== false) {
        upcoming = {
          name: p.event_name || p.title || "Next meet",
          date: String(p.event_date).slice(0, 10),
          federation: p.federation ?? null,
          weightClass: p.weight_class ?? null,
          location: p.event_location ?? null,
        };
      }
    }
    const { buildPerformanceView } = await import("@/lib/team-access/performance");
    return buildPerformanceView({
      results: results as any,
      meetRows: (meetRows ?? []) as any,
      upcoming,
      today,
    });
  });

/* ---------- Notes ---------- */

const TargetKind = z.enum(["set_video", "set", "session"]);

/** (server) Is this target one of this athlete's, and which category does a note on it need? */
async function checkTarget(
  db: any,
  clientId: string,
  kind: "set_video" | "set" | "session",
  targetId: string,
): Promise<"footage" | "training"> {
  if (kind === "set_video") {
    const { data } = await db
      .from("pl_set_videos")
      .select("client_id, deleted_at")
      .eq("id", targetId)
      .maybeSingle();
    if (!data || data.client_id !== clientId || data.deleted_at)
      throw new Error("That clip isn't this athlete's.");
    return "footage";
  }
  if (kind === "set") {
    const { data } = await db
      .from("pl_row_results")
      .select("client_id")
      .eq("id", targetId)
      .maybeSingle();
    if (!data || data.client_id !== clientId) throw new Error("That set isn't this athlete's.");
    return "training";
  }
  const { data } = await db
    .from("pl_days")
    .select("id, pl_weeks!inner(pl_blocks!inner(client_id))")
    .eq("id", targetId)
    .maybeSingle();
  if (!data || (data as any).pl_weeks?.pl_blocks?.client_id !== clientId)
    throw new Error("That session isn't this athlete's.");
  return "training";
}

export type MyNote = {
  id: string;
  targetKind: "set_video" | "set" | "session";
  targetId: string;
  body: string;
  visibility: "private" | "shared";
  createdAt: string;
  updatedAt: string;
};

/** The specialist's own notes about one athlete (optionally one target). */
export const listMyNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ clientId: Uuid, targetKind: TargetKind.optional(), targetId: Uuid.optional() })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<MyNote[]> => {
    const ctx = context as any;
    // their own rows, read with their own login (RLS: author only)
    let q = ctx.supabase
      .from("specialist_notes")
      .select("id, target_kind, target_id, body, visibility, created_at, updated_at")
      .eq("author_user_id", ctx.userId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.targetKind) q = q.eq("target_kind", data.targetKind);
    if (data.targetId) q = q.eq("target_id", data.targetId);
    const { data: rows, error } = await q;
    if (error) throw new Error("Couldn't load your notes.");
    return ((rows ?? []) as any[]).map((n) => ({
      id: n.id,
      targetKind: n.target_kind,
      targetId: n.target_id,
      body: n.body,
      visibility: n.visibility,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
  });

const NoteInput = z.object({
  id: Uuid.optional(),
  clientId: Uuid,
  targetKind: TargetKind,
  targetId: Uuid,
  body: z.string().trim().min(1, "Write something first.").max(2000),
  visibility: z.enum(["private", "shared"]),
});

/** Write or edit one of the specialist's own notes. Never notifies anyone. */
export const saveMyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => NoteInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { assertSpecialistCan, serviceDb } = await import("@/lib/team-access/access.server");
    const db = await serviceDb();
    const category = await checkTarget(db, data.clientId, data.targetKind, data.targetId);
    await assertSpecialistCan(ctx, data.clientId, category);
    if (data.id) {
      const { data: cur } = await db
        .from("specialist_notes")
        .select("author_user_id, client_id, target_kind, target_id")
        .eq("id", data.id)
        .maybeSingle();
      if (
        !cur ||
        cur.author_user_id !== ctx.userId ||
        cur.client_id !== data.clientId ||
        cur.target_kind !== data.targetKind ||
        cur.target_id !== data.targetId
      ) {
        throw new Error("That note isn't yours.");
      }
      const { error } = await db
        .from("specialist_notes")
        .update({ body: data.body, visibility: data.visibility })
        .eq("id", data.id);
      if (error) throw new Error("Couldn't save the note.");
      return { id: data.id };
    }
    const { data: row, error } = await db
      .from("specialist_notes")
      .insert({
        client_id: data.clientId,
        author_user_id: ctx.userId,
        target_kind: data.targetKind,
        target_id: data.targetId,
        body: data.body,
        visibility: data.visibility,
      })
      .select("id")
      .single();
    if (error) throw new Error("Couldn't save the note.");
    return { id: row.id as string };
  });

export const deleteMyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { serviceDb } = await import("@/lib/team-access/access.server");
    const db = await serviceDb();
    // an author may always take their own note down, even after their access ended
    const { error } = await db
      .from("specialist_notes")
      .delete()
      .eq("id", data.id)
      .eq("author_user_id", ctx.userId);
    if (error) throw new Error("Couldn't delete the note.");
    return { ok: true };
  });
