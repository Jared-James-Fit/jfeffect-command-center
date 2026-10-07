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
    expect(entry).toContain("<PostDetailDialog postId={openPost}");
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
