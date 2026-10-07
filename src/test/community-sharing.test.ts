import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTION_MAX,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  REACTIONS,
  checkMediaFile,
  checkVideoDuration,
  featuredLift,
  formatTopSet,
  formatWorkoutDuration,
  isPrMoment,
  nextFeedCursor,
  pickCardStats,
  postTimeLabel,
  buildShareCardFields,
  formatExerciseBest,
  sessionLine,
  trainingSinceLabel,
  isTrainingNow,
  lockInTimeLabel,
  SERIES_LABEL,
  compactNumber,
  winsHabitsLine,
  winsStatTiles,
  winsWeekLabel,
  type WinsStats,
  LOCK_IN_CAPTIONS,
  type CommunityExercise,
  type CommunityFeedPage,
  type WorkoutShareStats,
} from "@/lib/community";
import { availableTemplates, exportType, wrapLines } from "@/lib/workout-share-card";

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("supabase/migrations/20261006090000_community_sharing.sql");

const base: WorkoutShareStats = {
  workout_title: "Primary SBD",
  completed_at: "2026-10-06T14:00:00Z",
  duration_min: 74,
  working_sets: 18,
  tonnage_kg: 12000,
  top_lift: { exercise_name: "Squat", reps: 3, load_kg: 220 },
  pr_count: 0,
  prs: [],
};

describe("share card data", () => {
  it("formats duration like a person would say it", () => {
    expect(formatWorkoutDuration(74)).toBe("1h 14m");
    expect(formatWorkoutDuration(60)).toBe("1h");
    expect(formatWorkoutDuration(48)).toBe("48m");
    expect(formatWorkoutDuration(0)).toBeNull();
    expect(formatWorkoutDuration(null)).toBeNull();
  });

  it("shows at most three numbers: time, working sets, PRs", () => {
    const withPrs = pickCardStats({ ...base, pr_count: 2 }, "kg");
    expect(withPrs.map((s) => s.label)).toEqual(["Time", "Working sets", "PRs"]);
    expect(withPrs.length).toBeLessThanOrEqual(3);
  });

  it("falls back to volume only when there is no duration, and never overflows", () => {
    const noTime = pickCardStats({ ...base, duration_min: null }, "kg");
    expect(noTime.map((s) => s.label)).toEqual(["Working sets", "Volume"]);
    const everything = pickCardStats({ ...base, pr_count: 3 }, "lb");
    expect(everything.length).toBe(3);
  });

  it("omits stats that are empty instead of printing zeros", () => {
    const bare = pickCardStats({ ...base, duration_min: null, working_sets: 0, tonnage_kg: 0 }, "kg");
    expect(bare).toEqual([]);
  });

  it("features the PR when there is one, otherwise the primary lift", () => {
    expect(featuredLift(base)).toEqual({ name: "Squat", detail: { reps: 3, load_kg: 220 }, pr: null });
    const pr = featuredLift({
      ...base,
      pr_count: 1,
      prs: [{ exercise_name: "Competition Bench Press", reps: 5, load_kg: 120, scope: "atpr" }],
    });
    expect(pr).toEqual({ name: "Competition Bench Press", detail: { reps: 5, load_kg: 120 }, pr: "atpr" });
    expect(isPrMoment(base)).toBe(false);
    expect(isPrMoment({ ...base, prs: [{ exercise_name: "x", reps: 1, load_kg: 1, scope: "block_pr" }] })).toBe(true);
    expect(featuredLift({ ...base, top_lift: null })).toBeNull();
  });

  it("formats a top set with the athlete's unit", () => {
    expect(formatTopSet({ reps: 3, load_kg: 220 }, "kg")).toBe("220 kg × 3");
    expect(formatTopSet({ reps: 5, load_kg: 100 }, "lb")).toBe("220.5 lb × 5");
  });
});

describe("reactions", () => {
  it("is a small fixed set with no scoring attached", () => {
    expect(REACTIONS.map((r) => r.emoji)).toEqual(["🔥", "💪", "👏", "❤️"]);
    expect(Object.keys(REACTIONS[0]).sort()).toEqual(["emoji", "key", "label"]);
  });
});

describe("media rules", () => {
  it("accepts photos and short videos, rejects everything else", () => {
    expect(checkMediaFile({ type: "image/jpeg", size: 9_000_000 })).toEqual({ ok: true, kind: "image" });
    expect(checkMediaFile({ type: "video/mp4", size: 10_000_000 })).toEqual({ ok: true, kind: "video" });
    expect(checkMediaFile({ type: "video/mp4", size: MAX_VIDEO_BYTES + 1 }).ok).toBe(false);
    expect(checkMediaFile({ type: "application/pdf", size: 10 }).ok).toBe(false);
  });

  it("caps video length", () => {
    expect(checkVideoDuration(MAX_VIDEO_SECONDS).ok).toBe(true);
    expect(checkVideoDuration(MAX_VIDEO_SECONDS + 1).ok).toBe(false);
  });
});

describe("feed helpers", () => {
  const now = new Date("2026-10-06T12:00:00");
  it("labels time compactly", () => {
    expect(postTimeLabel("2026-10-06T11:59:40", now)).toBe("now");
    expect(postTimeLabel("2026-10-06T11:48:00", now)).toBe("12m");
    expect(postTimeLabel("2026-10-06T09:00:00", now)).toBe("3h");
    expect(postTimeLabel("2026-10-05T08:00:00", now)).toBe("Yesterday");
  });

  it("pages by keyset cursor and stops when the server says there is no more", () => {
    const post = (id: string, at: string) => ({ id, created_at: at }) as any;
    const page: CommunityFeedPage = { posts: [post("a", "2026-10-06T10:00:00Z"), post("b", "2026-10-06T09:00:00Z")], has_more: true };
    expect(nextFeedCursor(page)).toEqual({ at: "2026-10-06T09:00:00Z", id: "b" });
    expect(nextFeedCursor({ ...page, has_more: false })).toBeNull();
    expect(nextFeedCursor({ posts: [], has_more: true })).toBeNull();
  });
});

describe("card text wrapping", () => {
  // 10px per character, so 100px fits 10 chars.
  const ctx: any = { measureText: (t: string) => ({ width: t.length * 10 }), font: "" };
  it("wraps on words", () => {
    expect(wrapLines(ctx, "finally starting to move again", 150, 3)).toEqual(["finally", "starting to", "move again"]);
  });
  it("ellipsizes instead of overflowing the line budget", () => {
    const lines = wrapLines(ctx, "one two three four five six seven eight nine ten", 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  it("never drops a single very long word", () => {
    expect(wrapLines(ctx, "supercalifragilistic", 50, 2)[0]).toContain("supercal");
  });
  it("caption limit matches the database check", () => {
    expect(migration).toContain(`char_length(caption) <= ${CAPTION_MAX}`);
  });
});

describe("community_sharing migration contract", () => {
  it("references the canonical completion and stores only social data", () => {
    expect(migration).toMatch(/completion_id uuid NOT NULL REFERENCES public\.pl_day_completions\(id\)/);
    expect(migration).toContain("community_posts_one_per_completion UNIQUE (completion_id)");
    const table = migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS public.community_posts"), migration.indexOf("CREATE TABLE IF NOT EXISTS public.community_reactions"));
    for (const workoutColumn of ["duration", "tonnage", "sets", "reps", "load_kg", "pr_count"]) {
      expect(table).not.toContain(workoutColumn);
    }
  });

  it("derives workout numbers from the same record functions the recap uses", () => {
    expect(migration).toContain("public.client_rep_records(pc.client_id)");
    expect(migration).toContain("public.client_load_records(pc.client_id)");
    expect(migration).toContain("public.client_qualifying_sets(pc.client_id)");
  });

  it("publishes nothing automatically: writes only through the owner-checked RPC", () => {
    expect(migration).not.toMatch(/CREATE POLICY\s+\S+\s+ON public\.community_posts FOR (INSERT|UPDATE|ALL)/);
    expect(migration).toMatch(/c\.user_id = uid/); // author must own the completion
    expect(migration).toContain("pc.completed_at IS NOT NULL");
    expect(migration).not.toMatch(/CREATE TRIGGER/i); // no trigger can post on completion
  });

  it("keeps private posts private, from staff too, including their media", () => {
    const sel = migration.slice(migration.indexOf("community_posts_select"), migration.indexOf("community_posts_delete"));
    expect(sel).toContain("author_user_id = auth.uid() OR (visibility = 'community'");
    expect(sel).not.toContain("is_community_staff");
    const mediaRead = migration.slice(migration.indexOf('"community media read"'));
    expect(mediaRead).toContain("p.visibility = 'community'");
  });

  it("limits reactions to one per person from the fixed set", () => {
    expect(migration).toContain("PRIMARY KEY (post_id, user_id)");
    expect(migration).toContain("CHECK (emoji IN ('fire', 'muscle', 'clap', 'heart'))");
  });

  it("stays out of the XP / league systems", () => {
    expect(migration).not.toMatch(/athlete_xp_events|league_/);
  });

  it("revokes anonymous access on every RPC", () => {
    const grants = migration.match(/REVOKE ALL ON FUNCTION public\.community_\w+\([^)]*\) FROM PUBLIC, anon/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(7);
  });
});

describe("sharing stays optional", () => {
  const summary = read("src/components/workout-submission-summary.tsx");
  const composer = read("src/components/community/share-composer.tsx");
  const dayView = read("src/components/workout-day/WorkoutDayView.tsx");

  it("only opens when the athlete taps Share workout", () => {
    expect(summary).toContain("useState(false);\n  const [shareMounted");
    expect(summary).toContain("Share workout");
    expect(summary).toContain("setShareOpen(true)");
    expect(summary).not.toMatch(/useEffect\([^)]*setShareOpen\(true\)/);
  });

  it("is not offered to memberships or to a coach in View-as-client", () => {
    expect(dayView).toContain("isClientWorkout && !isImpersonating && completion?.completed_at");
  });

  it("keeps community posting and external sharing independent", () => {
    // external share never touches the post RPC, and posting never calls navigator.share
    const external = composer.slice(composer.indexOf("/* ---- external share"), composer.indexOf("/* ---- community post"));
    expect(external).not.toContain("saveCommunityPost");
    expect(external).not.toContain("uploadPicked");
    const post = composer.slice(composer.indexOf("const post = async"), composer.indexOf("// Fit the card"));
    expect(post).not.toContain("shareCardImage");
    expect(post).not.toContain("copyImageToClipboard");
    expect(post).not.toContain("navigator.share");
  });

  it("does not request camera or library until a button is tapped", () => {
    expect(composer).not.toContain("getUserMedia");
    expect(composer).toContain("fileRef.current?.click()");
    expect(composer).toContain('accept="image/*,video/*"');
  });

  it("does not upload on selection, only on Post", () => {
    const onPick = composer.slice(composer.indexOf("const onPick"), composer.indexOf("const removeMedia"));
    expect(onPick).not.toContain("uploadPicked");
  });

  it("never prompts after a workout (no auto-open, no nagging copy)", () => {
    expect(summary).not.toMatch(/setShareOpen\(true\)\s*;?\s*\n?\s*(}|\))\s*,\s*\d+\)/);
    expect(composer).not.toMatch(/POST-WORKOUT PHOTO NOW|Are you sure you don't want to share/i);
  });
});

const migration2 = read("supabase/migrations/20261006150000_community_platform.sql");

describe("share templates", () => {
  it("leads with the PR card when there is a record, otherwise the photo or the stats", () => {
    expect(availableTemplates({ isPr: true, exercises: [{ name: "x", detail: "y", pr: true }], volume: "1 kg", media: null })[0]).toBe("pr");
    expect(availableTemplates({ isPr: false, exercises: [{ name: "x", detail: "y", pr: false }], volume: null, media: {} as any })[0]).toBe("photo");
    expect(availableTemplates({ isPr: false, exercises: [{ name: "x", detail: "y", pr: false }], volume: null, media: null })[0]).toBe("stats");
  });
  it("always offers the sticker, and volume only when weight was moved", () => {
    const t = availableTemplates({ isPr: false, exercises: [], volume: null, media: null });
    expect(t).toContain("sticker");
    expect(t).not.toContain("volume");
    expect(availableTemplates({ isPr: false, exercises: [], volume: "12,450 kg", media: null })).toContain("volume");
  });
  it("keeps the sticker transparent", () => {
    expect(exportType("sticker")).toBe("image/png");
    expect(exportType("stats")).toBe("image/jpeg");
  });
});

describe("card fields from canonical stats", () => {
  const ex = (o: Partial<CommunityExercise>): CommunityExercise => ({ name: "Squat", sets: 3, best_load_kg: null, best_reps: null, max_reps: null, max_seconds: null, pr: null, ...o });
  it("describes each lift by its best set, reps or hold", () => {
    expect(formatExerciseBest(ex({ best_load_kg: 220, best_reps: 3 }), "kg")).toBe("220 kg × 3");
    expect(formatExerciseBest(ex({ max_reps: 12 }), "kg")).toBe("12 reps");
    expect(formatExerciseBest(ex({ max_seconds: 75 }), "kg")).toBe("1:15");
    expect(formatExerciseBest(ex({ max_seconds: 45 }), "kg")).toBe("45s");
    expect(formatExerciseBest(ex({ sets: 1 }), "kg")).toBe("1 set");
  });
  it("only claims a session count once it means something", () => {
    expect(sessionLine({ month_sessions: 1 })).toBeNull();
    expect(sessionLine({ month_sessions: 12 })).toBe("Session 12 this month");
    expect(sessionLine({})).toBeNull();
  });
  it("builds every card field from one source", () => {
    const f = buildShareCardFields({
      stats: { ...base, month_sessions: 5, pr_count: 1, prs: [{ exercise_name: "Bench", reps: 5, load_kg: 120, scope: "atpr" }], exercises: [ex({ best_load_kg: 220, best_reps: 3, pr: "block_pr" }), ex({ name: "Skipped", sets: 0 })] },
      unit: "kg",
      athleteName: "Jared",
      dateLabel: "Tue, Oct 6",
    });
    expect(f.isPr).toBe(true);
    expect(f.lift).toEqual({ name: "Bench", detail: "120 kg × 5", prLabel: "ALL-TIME PR" });
    expect(f.exercises).toEqual([{ name: "Squat", detail: "220 kg × 3", pr: true }]);
    expect(f.volume).toBe("12,000 kg");
    expect(f.sessionLine).toBe("Session 5 this month");
  });
  it("labels profile tenure", () => {
    expect(trainingSinceLabel(null)).toBeNull();
    expect(trainingSinceLabel("2026-06-03T00:00:00Z")).toMatch(/^Training since /);
  });
});

describe("community platform migration contract", () => {
  it("keeps 'seen' state server-side and never touches XP or the league", () => {
    expect(migration2).toContain("CREATE TABLE IF NOT EXISTS public.community_seen");
    expect(migration2).not.toMatch(/athlete_xp_events|league_month/);
  });
  it("derives the workout breakdown from the canonical record functions", () => {
    expect(migration2).toContain("public.client_rep_records(pc.client_id)");
    expect(migration2).toContain("public.client_load_records(pc.client_id)");
    expect(migration2).toContain("public.client_qualifying_sets(pc.client_id)");
  });
  it("shows a detail only when the post is visible to the viewer", () => {
    const detail = migration2.slice(migration2.indexOf("FUNCTION public.community_post(_post_id uuid)"));
    expect(detail).toContain("p.visibility = 'community' OR p.author_user_id = uid");
  });
  it("keeps internal helpers off the public API", () => {
    expect(migration2).toContain("REVOKE ALL ON FUNCTION public.community_workout_exercises(uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration2).toContain("REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration2).toContain("REVOKE ALL ON public.community_profiles FROM anon, authenticated;");
  });
  it("headlines the primary lift's best set across all its rows, not a ramp row", () => {
    // Regression: a 150 kg ramp row (sort 0) beat the 305 kg work row (sort 1) of the same lift.
    expect(migration2).toContain("primary_lift AS (SELECT qs.exercise_key FROM qs ORDER BY qs.sort_order ASC LIMIT 1)");
    expect(migration2).toContain("FROM qs JOIN primary_lift pl ON pl.exercise_key = qs.exercise_key");
  });
  it("caps bios to match the UI", () => {
    expect(migration2).toContain("char_length(bio) <= 150");
  });
});

describe("community is easy to find without taking over", () => {
  const shell = read("src/components/app-shell.tsx");
  const home = read("src/routes/_authenticated/portal/index.tsx");
  const entry = read("src/components/community/community-entry.tsx");
  it("sits in the header next to notifications and on Home", () => {
    expect(shell).toContain("<CommunityNavButton />");
    expect(home).toContain("<CommunityHomeStrip />");
  });
  it("is always on Home (clients live there), with Share first and an invite instead of an empty widget", () => {
    expect(entry).toContain('<ShareWorkoutButton unit={unit} label="Share" variant="bubble" />');
    expect(entry).toContain("Be the first to share this week");
    expect(entry).not.toContain("people.length === 0) return null");
  });
});

describe("community is its own page, reached from Home", () => {
  const workouts = read("src/routes/_authenticated/portal/workouts.index.tsx");
  const page = read("src/routes/_authenticated/portal/community.tsx");
  const entry = read("src/components/community/community-entry.tsx");
  const shellSrc = read("src/components/app-shell.tsx");
  const admin = read("src/routes/_authenticated/admin/index.tsx");
  const recent = read("supabase/migrations/20261006170000_community_recent_sessions.sql");
  const screen = read("src/components/community/community-screen.tsx");

  it("has a Back to Home and keeps Home lit, so nobody is stranded in Workouts", () => {
    expect(page).toContain('backTo="/portal" backLabel="Home"');
    expect(page).toContain("<CommunityScreen canShare={!isImpersonating} />");
    expect(shellSrc).toContain('(item.to === "/portal" && pathname === "/portal/community")');
  });
  it("leaves Workouts as pure training and forwards old #community links", () => {
    expect(workouts).not.toContain("CommunityScreen");
    expect(workouts).toContain('throw redirect({ to: "/portal/community"');
    expect(entry).not.toContain('to="/portal/workouts"');
  });
  it("opens a person's workout right on Home instead of navigating away", () => {
    expect(entry).toContain("onClick={() => setOpenPost(p.id)}");
    expect(entry).toContain("postId={openPost}");
  });
  it("only shows a header nudge when there is something new", () => {
    expect(entry).toContain("data.unseen <= 0) return null;");
  });
  it("puts one-tap coach props on the coach dashboard, visible even before anyone posts", () => {
    expect(admin).toContain("<CommunityCoachCard />");
    expect(entry).toContain("No posts yet. Clients share from Home and after each workout");
    expect(entry).toContain('react.mutate(given ? null : "fire"');
  });
  it("lets an athlete share any recent session (their own only)", () => {
    expect(recent).toContain("c.user_id = auth.uid()");
    expect(recent).toContain("interval '30 days'");
    expect(recent).toContain("REVOKE ALL ON FUNCTION public.community_recent_completions(int) FROM PUBLIC, anon;");
    expect(screen).toContain('label="Share your last workout"');
  });
  it("never lets a coach in View-as-client share for the athlete", () => {
    expect(page).toContain("<CommunityScreen canShare={!isImpersonating} />");
    expect(entry).toContain("{canShare && <ShareWorkoutButton");
  });
});

describe("lock in (I showed up)", () => {
  const sql = read("supabase/migrations/20261007090000_community_lock_in.sql");
  const bar = read("src/components/community/lock-in.tsx");
  const editor = read("src/components/community/lock-in-editor.tsx");
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  const card = read("src/lib/workout-share-card.ts");

  it("is the session's one post: a started session can post, the finished numbers fill it in", () => {
    expect(sql).toContain("AND (pc.completed_at IS NOT NULL OR pc.started_at IS NOT NULL OR pc.in_progress_at IS NOT NULL);");
    expect(sql).toContain("CASE WHEN v_done THEN NULL ELSE now() END)");
    // the upsert never rewrites locked_in_at
    expect(sql.slice(sql.indexOf("ON CONFLICT"), sql.indexOf("RETURNING p.id"))).not.toContain("locked_in_at");
    expect(sql).toContain("'live', pc.completed_at IS NULL,");
  });
  it("still refuses anyone but the athlete (coach View-as-client included)", () => {
    expect(sql).toContain("WHERE pc.id = _completion_id AND c.user_id = uid");
    expect(day).toContain("isClientWorkout && !isImpersonating && !completion?.completed_at");
  });
  it("starts the session through the normal start path, never on its own", () => {
    expect(day).toContain('await startWorkoutSrv({ data: { kind: "client" as const, dayId, scheduledWorkoutId } });');
    expect(editor).toContain("const id = completionId ?? (await ensureStarted());");
  });
  it("opens the camera inside the tap and keeps the logger light", () => {
    expect(bar).toContain('capture="environment"');
    expect(bar).toContain("camRef.current?.click();");
    expect(bar).toContain('lazyWithRetry(() => import("@/components/community/lock-in-editor")');
    expect(bar).not.toContain("workout-share-card");
  });
  it("draws a LOCKED IN card and carries the time onto the finished photo card", () => {
    expect(card).toContain('else if (d.template === "lockin") drawLockIn(ctx, d, logo, L);');
    expect(card).toContain("else if (d.lockedIn) pill(ctx, `LOCKED IN ${d.lockedIn.time}`");
    expect(availableTemplates({ isPr: false, exercises: [], volume: null, media: null })).not.toContain("lockin");
  });
  it("labels and timing", () => {
    expect(lockInTimeLabel(null)).toBeNull();
    expect(lockInTimeLabel("2026-10-07T18:42:00Z")).toMatch(/\d{1,2}:42/);
    const now = Date.parse("2026-10-07T19:00:00Z");
    expect(isTrainingNow({ live: true, locked_in_at: "2026-10-07T18:00:00Z" }, now)).toBe(true);
    expect(isTrainingNow({ live: true, locked_in_at: "2026-10-07T14:00:00Z" }, now)).toBe(false);
    expect(isTrainingNow({ live: false, locked_in_at: "2026-10-07T18:30:00Z" }, now)).toBe(false);
    expect(LOCK_IN_CAPTIONS.every((c) => c.length <= CAPTION_MAX && !c.includes("#"))).toBe(true);
  });
});

describe("community photos are the athlete's own", () => {
  const sql = read("supabase/migrations/20261007120000_community_avatars.sql");
  const profile = read("src/components/community/profile-view.tsx");
  const media = read("src/lib/community-media.ts");
  it("starts empty: never the account / identity photo", () => {
    const author = sql.slice(sql.indexOf("FUNCTION public.community_author"), sql.indexOf("REVOKE ALL ON FUNCTION public.community_author"));
    expect(author).not.toContain("profile_picture_url");
    expect(author).not.toContain("p.avatar_url");
    expect(author.match(/'avatar_url', cp\.avatar_path/g)?.length).toBe(2);
  });
  it("only accepts a path in your own community folder", () => {
    expect(sql).toContain("left(v_path, length(uid::text || '/community-')) <> uid::text || '/community-'");
    expect(media).toContain("const path = `${userId}/community-${Date.now()}.jpg`;");
  });
  it("lets you add, change or remove it from your own profile only", () => {
    expect(profile).toContain("disabled={!profile.is_me || setAvatar.isPending}");
    expect(profile).toContain("setAvatar.mutate(null");
  });
});

describe("who sees a post: JF crew, my coach, only me + hide weights", () => {
  const sql = read("supabase/migrations/20261007150000_community_audience.sql");
  it("uses one visibility rule everywhere (RLS, storage, feed, detail, reactions, comments, badge, profile)", () => {
    expect(sql).toContain("CHECK (visibility IN ('community', 'coach', 'private'))");
    expect(sql).toContain("USING (public.community_post_visible(visibility, author_user_id, client_id));");
    expect(sql.match(/public\.community_post_visible\(p\.visibility, p\.author_user_id, p\.client_id\)/g)!.length).toBeGreaterThanOrEqual(8);
    expect(sql).not.toContain("(p.visibility = 'community' OR p.author_user_id = uid)");
  });
  it("'coach' means the author, admins and the client's assigned coach, never other athletes", () => {
    expect(sql).toContain("OR (_visibility = 'coach' AND (public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach_for_client(_client))))");
  });
  it("hides weights server-side for everyone but the author", () => {
    expect(sql).toContain("CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer");
    expect(sql).toContain("'tonnage_kg', 0,");
    expect(sql).toContain("jsonb_build_object('best_load_kg', null,");
    expect(sql).toContain("hide_loads = coalesce(_hide_loads, p.hide_loads),");
  });
  it("formats a hidden load as reps, never '0 kg'", () => {
    expect(formatTopSet({ reps: 5, load_kg: null }, "kg")).toBe("5 reps");
    expect(formatTopSet({ reps: 1, load_kg: null }, "lb")).toBe("1 rep");
  });
});

describe("the crew: find anyone's profile", () => {
  const sql = read("supabase/migrations/20261007170000_community_members.sql");
  const screen = read("src/components/community/community-screen.tsx");
  const entry = read("src/components/community/community-entry.tsx");
  it("lists the same population as the community, minus you, counting only posts you can see", () => {
    expect(sql).toContain("coalesce(c.portal_access_disabled, false) = false");
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
    expect(sql).toContain("WHERE m.user_id <> uid");
    expect(sql).not.toMatch(/community_follow|is_following/i);
  });
  it("is a Crew tab, and Home opens a person's profile instead of dead-ending", () => {
    expect(screen).toContain('(["feed", "crew", "you"] as const)');
    expect(screen).toContain("<CrewList onOpen={openAuthor} />");
    expect(entry).toContain("hash: a.user_id === user?.id ? undefined : `person=${a.user_id}`");
  });
});

describe("Monday Motivation + Finish Strong Friday: real coach posts", () => {
  const sql = read("supabase/migrations/20261008090000_community_coach_posts.sql");
  const card = read("src/components/community/post-card.tsx");
  it("are ordinary community posts (same table, feed, profile, reactions, comments)", () => {
    expect(sql).toContain("CHECK ((kind = 'workout') = (completion_id IS NOT NULL))");
    expect(sql).toContain("'note', 'community', v_item.body");
    expect(sql).toContain("LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id");
    expect(card).toContain("<NoteBody post={post} clamp />");
  });
  it("publish once per theme per week, Winnipeg time, never twice even after a delete", () => {
    expect(sql).toContain("AT TIME ZONE 'America/Winnipeg'");
    expect(sql).toContain("v_local::time < time '07:00' OR v_local::time >= time '12:00'");
    expect(sql).toContain("to_char(v_local, 'IYYY-\"W\"IW')");
    expect(sql).toContain("series_key text PRIMARY KEY");
    expect(sql).toContain("ON CONFLICT (series_key) DO NOTHING;\n  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists'");
    expect(sql).toContain("'*/15 11-18 * * 1,5', 'select public.community_publish_series();'");
  });
  it("can be paused, and only coaches can publish, edit the library or write notes", () => {
    expect(sql).toContain("IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused')");
    expect(sql).toContain("IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN");
    expect(sql).toContain("IF uid IS NULL OR NOT public.community_is_coach(uid) THEN");
  });
  it("rotate mentors and never put words in anyone's mouth", () => {
    expect(sql).toContain("ORDER BY (i.mentor = ANY (coalesce(v_recent, '{}'))) ASC, i.last_used_at ASC NULLS FIRST");
    expect(sql).toContain("CONSTRAINT community_series_items_quote_has_source CHECK (quote IS NULL OR quote_source IS NOT NULL)");
    // quotes are not editable after the fact, only the coach's own words
    expect(sql).toMatch(/community_update_note\(_post_id uuid, _body text\)/);
    for (const known of ["Rest at the end, not in the middle", "Pain is weakness leaving the body", "opportunity for me to rise"]) expect(sql).not.toContain(known);
  });
  it("show the coach once, as coach, folding a second login into the same person", () => {
    expect(sql).toContain("'title', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coalesce(cp.title, 'Coach · JF Effect') END");
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)");
    expect(sql).toContain("'is_mine', n.author_user_id = public.community_main_account(_viewer),");
  });
});

describe("Wednesday Wins: last week's real wins, everyone who trained", () => {
  const sql = read("supabase/migrations/20261008120000_community_wednesday_wins.sql");
  const coach = read("src/components/community/coach-weekly-posts.tsx");
  it("posts once a week at noon Winnipeg, through the same series runs", () => {
    expect(sql).toContain("WHEN 3 THEN 'wednesday_wins'");
    expect(sql).toContain("v_start := CASE v_series WHEN 'wednesday_wins' THEN time '12:00' ELSE time '07:00' END;");
    expect(sql).toContain("'*/15 16-23 * * 3', 'select public.community_publish_series(''wednesday_wins'');'");
    expect(sql).toContain("INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;");
  });
  it("is built only from logged training, last week, excluding the coach", () => {
    expect(sql).toContain("public.community_compose_wins((date_trunc('week', v_local)::date - 7), v_author)");
    expect(sql).toContain("CONTINUE WHEN v_sessions = 0;");
    expect(sql).toContain("FROM public.client_load_records(c.id) UNION ALL SELECT * FROM public.client_rep_records(c.id)");
    expect(sql).toContain("IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;");
  });
  it("rotates shout-outs so everyone gets one within the month, and names the rest", () => {
    expect(sql).toContain("interval '28 days'");
    expect(sql).toContain("least(6, greatest(4, ceil(v_n / 2.0)::int))");
    expect(sql).toContain("'Shoutout to ' || v_rest || ' too. '");
    expect(sql).toContain("INSERT INTO public.community_series_features (series_key, client_id, win_type, featured_at)");
  });
  it("respects each client's unit and Hide weights", () => {
    expect(sql).toContain("v_set := CASE WHEN v_hide OR public.community_fmt_load(pr.load_kg, c.unit) IS NULL THEN NULL");
    expect(sql).toContain("REVOKE ALL ON public.community_series_features FROM anon, authenticated;");
  });
  it("shows the coach a live preview and the Wednesday label everywhere", () => {
    expect(SERIES_LABEL.wednesday_wins.name).toBe("Wednesday Wins");
    expect(coach).toContain('"wednesday_wins"');
    expect(coach).toContain("preview.body");
    expect(coach).toContain("SERIES_LABEL[h.series]?.short");
  });
});

describe("Wednesday Wins reads like the coach wrote it, with the crew's numbers", () => {
  const sql = read("supabase/migrations/20261008120000_community_wednesday_wins.sql");
  const card = read("src/components/community/post-card.tsx");
  const detail = read("src/components/community/post-detail.tsx");
  it("writes each win as a sentence and never repeats the same phrasing back to back", () => {
    expect(sql).toContain("v_name || ' hit an all-time PR on ' || v_lift");
    expect(sql).toContain("w->'texts'->>((pos - 1 + v_wk)::int % 3)");
    expect(sql).toContain("regexp_replace(_name, '^(.+?) - (.+)$', '\\2 \\1')");
    // no robotic "Name: ..." lines, no em dashes in the words
    expect(sql).not.toContain("v_name || ': '");
    expect(sql.split("$$").filter((_, i) => i % 2 === 1).join("")).not.toContain("—");
  });
  it("saves the crew's numbers on the post and the app reads them back", () => {
    expect(sql).toContain("ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS series_data jsonb;");
    expect(sql).toContain("v_comp->'stats', coalesce(_at, now()))");
    expect(sql).toContain("'series_data', n.series_data,");
    expect(sql).toContain("WHERE a.action = 'signed_in'");
    expect(card).toContain("<WinsStatsCard stats={post.series_data} unit={unit}");
    expect(detail).toContain("<WinsStatsCard stats={post.series_data} unit={unit}");
  });
  const s: WinsStats = {
    week_of: "2026-09-28", roster: 16, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 41, pr_people: 9,
    volume_kg: 204215, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday",
  };
  it("turns them into numbers anyone gets", () => {
    expect(winsWeekLabel("2026-09-28")).toBe("Sep 28 – Oct 4");
    const lb = winsStatTiles(s, "lb");
    expect(lb.map((t) => t.value)).toEqual(["94%", "36", "41", "450K", "10", "Fri"]);
    expect(lb[0].sub).toBe("15 of 16");
    expect(lb[1].sub).toBe("+13% vs last week");
    expect(lb[2].sub).toBe("by 9 people");
    expect(lb[3]).toMatchObject({ label: "lb lifted", sub: "≈ 90 pickup trucks" });
    expect(winsStatTiles(s, "kg")[3]).toMatchObject({ value: "204K", label: "kg lifted" });
    expect(winsHabitsLine(s)).toBe("9 logged bodyweight · 4 sent a check-in · 6,015 reps");
    expect(compactNumber(6015)).toBe("6,015");
    expect(compactNumber(45200)).toBe("45.2K");
    expect(compactNumber(1_250_000)).toBe("1.3M");
  });
  it("leaves out tiles that would be empty or misleading", () => {
    const quiet = winsStatTiles({ ...s, volume_kg: 0, streaks: 0, busiest_day: null, sessions_prev: 0, prs: 1, pr_people: 1 }, "lb");
    expect(quiet.map((t) => t.label)).toEqual(["opened the app", "workouts done", "new PR"]);
    expect(quiet[1].sub).toBeUndefined();
  });
});

describe("Wednesday Wins shows a PR in the unit the athlete logs that lift in", () => {
  const sql = read("supabase/migrations/20261008150000_community_wins_lift_unit.sql");
  it("uses the per-exercise kg/lb toggle first, then the account default", () => {
    expect(sql).toContain("SELECT x.exercise_id, x.exercise_name, x.reps, x.load_kg,");
    expect(sql).toContain("FROM public.client_exercise_unit_prefs u");
    expect(sql).toContain("WHERE u.client_id = c.id AND u.exercise_id = pr.exercise_id AND u.unit IN ('kg', 'lb') LIMIT 1), c.unit);");
    expect(sql).toContain("public.community_fmt_load(pr.load_kg, v_unit)");
    expect(sql).not.toContain("community_fmt_load(pr.load_kg, c.unit)");
  });
});

describe("weight units: a setting for clients, a tap on the community card", () => {
  const account = read("src/routes/_authenticated/portal/account.tsx");
  const unitCard = read("src/components/portal/weight-unit-card.tsx");
  const wins = read("src/components/community/wins-stats.tsx");
  it("clients can set their default unit in Account Settings", () => {
    expect(account).toContain('<WeightUnitCard key={form.id} clientId={form.id} value={client?.preferred_weight_unit} />');
    expect(account).toContain('{ id: "units", label: "Units" }');
    expect(unitCard).toContain('.update({ preferred_weight_unit: next })');
  });
  const s: WinsStats = {
    week_of: "2026-09-28", roster: 16, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 41, pr_people: 9,
    volume_kg: 204215, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday",
  };
  it("the weight tile on Wednesday Wins flips lb/kg on tap, only for that viewer, without opening the post", () => {
    expect(winsStatTiles(s, "lb").filter((t) => t.unitToggle).map((t) => t.label)).toEqual(["lb lifted"]);
    expect(wins).toContain('setShown(shown === "lb" ? "kg" : "lb")');
    expect(wins).toContain("e.stopPropagation();");
    // a tap never writes the viewer's saved preference
    expect(wins).not.toContain("preferred_weight_unit");
  });
});

describe("Wednesday Wins sounds like Jared texts", () => {
  const sql = read("supabase/migrations/20261008160000_community_wins_voice.sql");
  const body = sql.split("$$").filter((_, i) => i % 2 === 1).join("").replace(/--.*$/gm, "");
  it("uses gym shorthand for lifts and sets", () => {
    expect(sql).toContain("regexp_replace(s, '\\mcompetition\\M', 'comp', 'g')");
    expect(sql).toContain("regexp_replace(s, '\\mromanian deadlifts?\\M', 'RDL', 'g')");
    expect(sql).toContain("regexp_replace(s, '\\mdumbbells?\\M', 'DB', 'g')");
    expect(sql).toContain("|| CASE WHEN _reps = 1 THEN ' single' ELSE ' x ' || _reps END END");
    expect(sql).toContain("v_set := CASE WHEN v_hide THEN NULL ELSE public.community_fmt_set(pr.load_kg, pr.reps, v_unit) END;");
  });
  it("is casual: few commas, no em dashes, not capitalized every week", () => {
    expect(body).not.toContain("—");
    expect(sql).toContain("'big week. ' || v_prs || ' PRs between all of you last week heres who stood out'");
    expect(sql).toContain("IF v_wk % 2 = 1 THEN");
    // the only comma left in the words is between names in the shoutout list
    const words = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter((t) => /[a-z]{3}/.test(t));
    expect(words.filter((t) => t.includes(",") && t !== ", ").length).toBe(0);
  });
  it("never repeats the big PR week reaction on lines next to each other", () => {
    expect(sql).toContain("' PRs in 1 week thats insane'");
    expect(sql).toContain("' PRs in 1 week crazy'");
    expect(sql).toContain("' PRs on the week lowkey insane'");
  });
});
