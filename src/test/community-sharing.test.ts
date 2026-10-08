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
  planDetail,
  groupSessions,
  sessionDisplayTitle,
  sessionWhen,
  formatExerciseBest,
  sessionLine,
  trainingSinceLabel,
  isTrainingNow,
  lockInTimeLabel,
  SERIES_LABEL,
  REACTION,
  reactionTotal,
  reactorsLine,
  compactNumber,
  winsChallenge,
  winsChart,
  winsHero,
  winsTiles,
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

  it("only opens when the athlete taps Share, and Done is the main action", () => {
    expect(summary).toContain("useState(false);\n  const [shareMounted");
    expect(summary).toContain('<Share2 className="mr-1.5 h-4 w-4" />Share\n');
    expect(summary).toContain("Done\n");
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
    expect(entry).toContain('<ShareWorkoutButton unit={unit} label="Share" variant="bubble" previewOnly={isImpersonating} />');
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
    expect(page).toContain("<CommunityScreen canShare previewOnly={isImpersonating} />");
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
    expect(page).toContain("<CommunityScreen canShare previewOnly={isImpersonating} />");
    expect(entry).toContain('<ShareWorkoutButton unit={unit} label="Share" variant="bubble" previewOnly={isImpersonating} />');
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
    expect(day).toContain("isClientWorkout && !completion?.completed_at && rowsLoaded");
    expect(day).toContain("previewOnly={isImpersonating}");
  });
  it("starts the session through the normal start path, never on its own", () => {
    expect(day).toContain('await startWorkoutSrv({ data: { kind: "client" as const, dayId, scheduledWorkoutId } });');
    expect(editor).toContain("const id = completionId ?? (await ensureStarted());");
  });
  it("opens the in-app camera and keeps the logger light", () => {
    expect(bar).toContain("else setCapturing(true);");
    expect(bar).toContain('lazyWithRetry(() => import("@/components/community/lock-in-editor")');
    expect(bar).toContain('lazyWithRetry(() => import("@/components/community/capture-flow")');
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
  const full: WinsStats = {
    ...s, volume_prev_kg: 206865, volume_rank: 4, sessions_rank: 5, weeks_tracked: 16,
    history: [49, 36, 34, 34, 35, 31, 32, 36].map((n, i) => ({ wk: ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"][i], sessions: n })),
  };
  it("leads with one team number anyone gets, said as a team total", () => {
    expect(winsWeekLabel("2026-09-28")).toBe("Sep 28 – Oct 4");
    const lb = winsHero(full, "lb");
    expect(lb).toMatchObject({ amount: "450,216", unit: "lbs" });
    expect(lb.compare).toMatch(/^That's about the weight of \d+ (pickup trucks|elephants|cars|school buses)$/);
    expect(winsHero(full, "kg")).toMatchObject({ amount: "204,215", unit: "kg" });
    // 4th best week: no badge; lighter than the week before: no change pill
    expect(lb.badge).toBeNull();
    expect(lb.change).toBeNull();
    expect(winsHero({ ...full, volume_rank: 1 }, "lb").badge).toBe("Biggest week the crew has ever had");
    expect(winsHero({ ...full, volume_rank: 2 }, "lb").badge).toBe("2nd biggest week the crew has ever had");
    expect(winsHero({ ...full, volume_rank: 1, weeks_tracked: 3 }, "lb").badge).toBeNull();
    expect(winsHero({ ...full, volume_prev_kg: 180000 }, "lb").change).toBe("13% more than the week before");
    expect(compactNumber(12_500_000)).toBe("12.5M");
  });
  it("keeps the comparison sensible at any size and rotates it week to week", () => {
    const picks = new Set(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((w) => winsHero({ ...full, week_of: w }, "lb").compare?.split(" ").pop()));
    expect(picks.size).toBeGreaterThan(1);
    for (const kg of [2_000, 50_000, 204_215, 900_000]) {
      const n = Number(winsHero({ ...full, volume_kg: kg }, "lb").compare?.match(/\d+/)?.[0] ?? "0");
      expect(n === 0 || (n >= 3 && n <= 300)).toBe(true);
    }
  });
  it("uses plain words in the tiles, no coach jargon", () => {
    const t = winsTiles(full);
    expect(t.map((x) => [x.value, x.label])).toEqual([
      ["12 of 16", "people trained"],
      ["36", "workouts finished"],
      ["41", "new personal records"],
      ["10", "people haven't missed a week"],
    ]);
    expect(t[0].sub).toBe("75% of the crew");
    expect(t[1].sub).toBe("4 more than the week before");
    expect(t[2].sub).toBe("set by 9 different people");
    expect(t[3].sub).toBe("in a month or more");
    const words = JSON.stringify(t);
    for (const jargon of ["opened the app", "busiest day", "PRs", "streak", "volume"]) expect(words).not.toContain(jargon);
    // a down week never shows a negative
    expect(winsTiles({ ...full, sessions_prev: 40 })[1].sub).toBeUndefined();
  });
  it("shows 8 weeks of workouts with this week highlighted, and a goal to chase", () => {
    const bars = winsChart(full);
    expect(bars).toHaveLength(8);
    expect(bars.filter((b) => b.current).map((b) => b.sessions)).toEqual([36]);
    expect(bars[0].share).toBe(1);
    expect(winsChart({ ...full, history: undefined })).toEqual([]);
    expect(winsChallenge(full)).toBe("This week's goal: beat 36 workouts");
    expect(winsChallenge({ ...full, sessions_rank: 1 })).toBe("Most workouts the crew has ever done in a week. Run it back");
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
    expect(winsHero(s, "lb").unit).toBe("lbs");
    expect(winsHero(s, "kg").unit).toBe("kg");
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

describe("Wednesday Wins card v2 + voice", () => {
  const sql = read("supabase/migrations/20261008180000_community_wins_card_v2.sql");
  const body = sql.split("$$").filter((_, i) => i % 2 === 1).join("").replace(/--.*$/gm, "");
  it("keeps the history the card needs", () => {
    for (const k of ["'volume_prev_kg'", "'volume_rank'", "'sessions_rank'", "'weeks_tracked'", "'history'"]) expect(sql).toContain(k);
    expect(sql).toContain("FROM generate_series(0, 7) i");
  });
  it("never says ur or u, and only says yall when it's hype", () => {
    expect(body).not.toMatch(/\bur\b|\bu\b/);
    const yall = [...body.matchAll(/'[^']*yall[^']*'/g)].map((m) => m[0]);
    expect(yall).toEqual(["'yall are cooking. '"]);
  });
});

describe("one reaction (🔥) and who gave it", () => {
  const sql = read("supabase/migrations/20261008200000_community_one_reaction.sql");
  const card = read("src/components/community/post-card.tsx");
  const p = (n: number, names: [string, boolean?][]) => ({
    reaction_count: n,
    reactions: { fire: n },
    reactors: names.map(([name, me]) => ({ user_id: name, name, avatar_url: null, is_coach: false, is_me: !!me })),
  });
  it("is one tap, and old reactions all count as 🔥", () => {
    expect(REACTION.emoji).toBe("🔥");
    expect(sql).toContain("UPDATE public.community_reactions SET emoji = 'fire' WHERE emoji IS DISTINCT FROM 'fire';");
    expect(sql).toContain("VALUES (_post_id, uid, 'fire')");
    expect(card).toContain("onReact(post, mine ? null : REACTION.key)");
    expect(card).not.toContain("REACTIONS.map(");
    expect(reactionTotal({ reactions: { fire: 2, heart: 1 } })).toBe(3);
  });
  it("says who in plain words, you first", () => {
    expect(reactorsLine(p(0, []))).toBeNull();
    expect(reactorsLine(p(1, [["Nicole"]]))).toBe("Nicole");
    expect(reactorsLine(p(2, [["Nicole"], ["Jared", true]]))).toBe("You and Nicole");
    expect(reactorsLine(p(3, [["Jared"], ["Vicky"], ["Nicole"]]))).toBe("Jared, Vicky and Nicole");
    expect(reactorsLine(p(5, [["Jared"], ["Vicky"], ["Nicole"]]))).toBe("Jared, Vicky and 3 others");
    expect(reactorsLine(p(3, [["Jared"], ["Vicky"]]))).toBe("Jared, Vicky and 1 other");
  });
  it("only people who can see the post can see who reacted", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_post_reactors(_post_id uuid)");
    expect(sql).toMatch(/community_post_reactors[\s\S]*community_post_visible\(p\.visibility, p\.author_user_id, p\.client_id\)/);
    expect(sql).toContain("'reactors', coalesce(");
    expect(card).toContain("<ReactorsSheet postId={listFor}");
  });
});

describe("coach POV shows the post buttons but never posts as the client", () => {
  const picker = read("src/components/community/share-workout-picker.tsx");
  const lockIn = read("src/components/community/lock-in.tsx");
  it("looks like the client's screen and explains on tap", () => {
    expect(picker).toContain("const open = rawOpen && !previewOnly;");
    expect(picker).toContain("toast.message(PREVIEW_ONLY_MESSAGE)");
    expect(lockIn).toContain("if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);");
  });
});

describe("share editor never opens blank", () => {
  const composer = read("src/components/community/share-composer.tsx");
  it("measures and draws once the stage actually mounts, even when the workout is already cached", () => {
    expect(composer).toContain("const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);");
    expect(composer).toContain('<div ref={setStageEl} className="relative min-h-0 flex-1">');
    expect(composer).toContain("}, [open, stageEl]);");
    expect(composer).toContain("}, [open, base, templates, dataFor, stageEl]);");
    expect(composer).not.toContain("stageRef");
  });
});

describe("Wednesday Wins stays short and still reaches everyone each month", () => {
  const sql = read("supabase/migrations/20261008220000_community_wins_short.sql");
  it("features 3 a week (up to 5 only to fit everyone left into the month)", () => {
    expect(sql).toContain("v_k := least(v_n, greatest(3, least(5, ceil(v_waiting::numeric / greatest(v_weds_left, 1))::int)));");
    expect(sql).toContain("f.featured_at >= v_month_start AND f.featured_at < v_post_end");
    expect(sql).toContain("((w->>'streak')::int >= 4) ASC,");
  });
  it("drops the everyone-else name list: intro, shout-outs, one team line", () => {
    expect(sql).toContain("v_caption := v_intro || E'\\n\\n' || v_lines || E'\\n\\n' || v_outro;");
    expect(sql).not.toContain("shoutout to ' || v_rest");
    expect(sql).toContain("' of you got after it last week. proud of this crew 🔥'");
  });
});

describe("Instagram-style post controls: edit, archive, delete", () => {
  const sql = read("supabase/migrations/20261009090000_community_edit_archive.sql");
  const actions = read("src/components/community/post-actions.tsx");
  const card = read("src/components/community/post-card.tsx");
  const detail = read("src/components/community/post-detail.tsx");
  const profile = read("src/components/community/profile-view.tsx");
  it("only the author (either linked account) can edit or archive", () => {
    expect(sql).toContain("p.author_user_id = auth.uid() OR p.author_user_id = public.community_main_account(auth.uid())");
    expect(sql).toMatch(/community_edit_post[\s\S]*IF NOT public\.community_is_post_author\(_post_id\)/);
    expect(sql).toMatch(/community_archive_post[\s\S]*IF NOT public\.community_is_post_author\(_post_id\)/);
  });
  it("a caption change shows Edited, from the edit sheet and the share editor", () => {
    expect(sql).toContain("edited_at = CASE WHEN p.caption IS DISTINCT FROM v_cap THEN now() ELSE edited_at END");
    expect(sql).toContain("edited_at = CASE WHEN p.caption IS DISTINCT FROM EXCLUDED.caption THEN now() ELSE p.edited_at END");
  });
  it("archive hides it from everyone (and your feed), keeps fire and comments, restores to who it was for", () => {
    expect(sql).toContain("SET archived_from = visibility, visibility = 'private', archived_at = now()");
    expect(sql).toContain("SET visibility = coalesce(archived_from, 'community'), archived_from = NULL, archived_at = NULL");
    expect(sql).toContain("       AND p.archived_at IS NULL\n       AND (_author_user_id IS NULL");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_my_archived()");
    // sharing the same workout again brings it back
    expect(sql).toContain("    archived_at = NULL,\n    archived_from = NULL,\n    updated_at = now()");
  });
  it("the same menu lives on the feed card and the post detail, with Archived on your profile", () => {
    expect(card).toContain("<PostActions post={post} viewerIsStaff={viewerIsStaff} />");
    expect(detail).toContain("<PostActions post={post} viewerIsStaff={viewerIsStaff} onGone={onClose}");
    expect(actions).toContain('{archived ? "Show on profile" : "Archive"}');
    expect(actions).toContain("Archive instead");
    expect(profile).toContain("useMyArchived(showArchived)");
  });
});

describe("share studio: lock in cards, camera first, text + stickers", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("today's plan reads like a program", () => {
    expect(planDetail({ sets: 4, reps_text: "5", duration_seconds: null })).toBe("4 × 5");
    expect(planDetail({ sets: 3, reps_text: " 8-10 ", duration_seconds: null })).toBe("3 × 8-10");
    expect(planDetail({ sets: 3, reps_text: null, duration_seconds: 45 })).toBe("3 × 45s");
    expect(planDetail({ sets: 2, reps_text: "", duration_seconds: 90 })).toBe("2 × 1:30");
    expect(planDetail({ sets: null, reps_text: null, duration_seconds: 120 })).toBe("2 min");
    expect(planDetail({ sets: null, reps_text: "AMRAP", duration_seconds: null })).toBe("AMRAP");
    expect(planDetail({ sets: 3, reps_text: null, duration_seconds: null })).toBe("3 sets");
    expect(planDetail({ sets: 0, reps_text: null, duration_seconds: null })).toBe("");
  });
  it("lock in offers Locked in, Clock and (with a plan) Today's plan", () => {
    const card = read("src/lib/workout-share-card.ts");
    const editor = read("src/components/community/lock-in-editor.tsx");
    expect(card).toContain('lockclock: "Clock"');
    expect(card).toContain(`lockplan: "Today's plan"`);
    expect(editor).toContain('plan.length ? ["lockin", "lockclock", "lockplan"] : ["lockin", "lockclock"]');
  });
  it("Share and Lock in open the camera first, then text + stickers", () => {
    const picker = read("src/components/community/share-workout-picker.tsx");
    const bar = read("src/components/community/lock-in.tsx");
    const flow = read("src/components/community/capture-flow.tsx");
    expect(picker).toContain("<CaptureFlow");
    expect(picker).toContain('const activeMode: Mode = today ? mode ?? "lockin" : "workout";');
    expect(picker).toContain("initialFile={photo}");
    expect(bar).toContain("<CaptureFlow");
    expect(bar).not.toContain('capture="environment"');
    expect(flow).toContain("<PhotoDecorator");
    // videos can't be decorated, so they skip the editor
    expect(flow).toContain('if (file.type.startsWith("video/")) onDone(file, live);');
  });
  it("the camera falls back to the phone's own camera and picker", () => {
    const cam = read("src/components/community/share-camera.tsx");
    expect(cam).toContain("navigator.mediaDevices?.getUserMedia");
    expect(cam).toContain('.catch(() => !cancelled && setStatus("fallback"))');
    expect(cam).toContain('capture="environment"');
    expect(cam).toContain("stop();");
  });
  it("stickers and text are baked into the photo at full size", () => {
    const deco = read("src/components/community/photo-decorator.tsx");
    expect(deco).toContain("const k = Math.min(1, 2048 / Math.max(nw, nh));");
    expect(deco).toContain('"image/jpeg", 0.9');
    // nothing added → the original photo, untouched
    expect(deco).toContain("if (!items.length) return onDone(file);");
  });
  it("full-screen editors really fill the screen", () => {
    for (const f of ["share-composer", "lock-in-editor", "share-camera", "photo-decorator", "post-detail"]) {
      expect(read(`src/components/community/${f}.tsx`)).toContain("h-[100dvh] max-h-none");
    }
  });
});

describe("share picker: which workout was today", () => {
  const now = new Date(2026, 9, 7, 21, 28); // Wed Oct 7, 9:28 PM local
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  it("drops the program's weekday so it can't clash with the real date", () => {
    expect(sessionDisplayTitle("Tuesday — Secondary Deadlift + Secondary Bench")).toBe("Secondary Deadlift + Secondary Bench");
    expect(sessionDisplayTitle("Saturday - Tertiary Squat")).toBe("Tertiary Squat");
    expect(sessionDisplayTitle("Workout")).toBe("Workout");
    expect(sessionDisplayTitle("Sunday Funday")).toBe("Sunday Funday");
  });
  it("says when, in plain words", () => {
    expect(sessionWhen(at(7, 21, 17), now)).toEqual({ group: "today", when: "Finished 11 min ago" });
    expect(sessionWhen(at(7, 21, 28), now).when).toBe("Finished just now");
    expect(sessionWhen(at(7, 9, 5), now).when).toMatch(/^Finished at 9:05/);
    expect(sessionWhen(at(6, 19, 0), now).when).toMatch(/^Yesterday, 7:00/);
    expect(sessionWhen(at(3, 10), now).group).toBe("week");
    expect(sessionWhen(new Date(2026, 8, 21, 10).toISOString(), now)).toEqual({ group: "earlier", when: expect.stringMatching(/Sep 21/) });
  });
  it("buckets newest first and skips empty buckets", () => {
    const g = groupSessions([{ completed_at: at(3, 10) }, { completed_at: at(7, 21, 17) }, { completed_at: at(7, 8) }], now);
    expect(g.map((x) => x.label)).toEqual(["Today", "This week"]);
    expect(g[0].items.map((i) => i.when)[0]).toBe("Finished 11 min ago");
  });
});
