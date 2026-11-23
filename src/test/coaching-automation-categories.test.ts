import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkinReplyRead, eyesProblems, messageTypeFor, missedSessionRead, progressReplyRead, pushesCoach, queueOrder, videoReplyRead, workoutReplyRead } from "@/lib/recovery-automation/categories";
import { CATEGORIES, effectiveMode, modeAllowed, modeNeeds, riskReasonWords, routeItem, type AutomationCategory } from "@/lib/recovery-automation/rules";

const OWNER = ["automation.approval_queue", "automation.auto_send", "automation.follow_ups", "owner.voice", "owner.training_aware", "owner.controls"];
const QUEUE_ONLY = ["automation.approval_queue"];

describe("workout reviews", () => {
  it("a review that says nothing needs no reply", () => {
    expect(workoutReplyRead({ note: null, rating: 4 }).useful).toBe(false);
    expect(workoutReplyRead({ note: "good", rating: 4 })).toMatchObject({ useful: false });
  });
  it("a plain note about the session is routine", () => {
    expect(workoutReplyRead({ note: "felt strong today, top set moved fast", rating: 5 })).toEqual({ useful: true, why: null, risk: "routine", reasons: [] });
    expect(workoutReplyRead({ note: "drop sets were brutal but good", rating: 4 }).risk).toBe("routine");
  });
  it("anything that needs the coach's judgment waits for him", () => {
    expect(workoutReplyRead({ note: "should I go heavier on bench next week?", rating: 4 })).toMatchObject({ risk: "review", reasons: ["question"] });
    expect(workoutReplyRead({ note: "my lower back is a bit sore after the deadlifts", rating: 4 }).reasons).toContain("mentions_pain");
    expect(workoutReplyRead({ note: "can we move thursday to friday, I'm out of town", rating: 4 }).reasons).toEqual(expect.arrayContaining(["question", "program_request"]));
    expect(workoutReplyRead({ note: "been sick all week, felt weak", rating: 3 }).reasons).toContain("ill");
    expect(workoutReplyRead({ note: null, rating: 2 })).toMatchObject({ useful: true, risk: "review", reasons: ["low_rating"] });
  });
  it("pain and feeling unwell said the way people say it", () => {
    for (const note of ["knee is killing me", "my tendonitis flared again", "back's stiff after deadlifts", "shoulder was bothering me on bench"]) expect(workoutReplyRead({ note, rating: 4 }).reasons).toContain("mentions_pain");
    for (const note of ["think I'm coming down with something", "felt run down all session", "bit under the weather"]) expect(workoutReplyRead({ note, rating: 4 }).reasons).toContain("ill");
  });
  it("a headline PR is worth a reply even when they wrote nothing", () => {
    expect(workoutReplyRead({ note: null, rating: 5, headlinePr: true })).toEqual({ useful: true, why: null, risk: "routine", reasons: [] });
    expect(workoutReplyRead({ note: "yes", rating: 5, headlinePr: true }).useful).toBe(true);
    expect(workoutReplyRead({ note: null, rating: 5, headlinePr: false }).useful).toBe(false);
    // a PR never hides a question or a low rating
    expect(workoutReplyRead({ note: "should I go up again?", rating: 4, headlinePr: true }).risk).toBe("review");
  });
  it("words that may need medical help are urgent", () => {
    expect(workoutReplyRead({ note: "got really dizzy after the squats and almost passed out", rating: 3 }).risk).toBe("urgent");
    expect(workoutReplyRead({ note: "some chest tightness on the last set", rating: 3 }).risk).toBe("urgent");
  });
});

describe("weekly check-ins", () => {
  const good = { urgency: "normal", red_flags: [], suggested_response: "good week. keep the steps up and we'll push the bench a bit." };
  it("a routine check-in can be answered from its recap's reply", () => {
    expect(checkinReplyRead({ analysis: good, answers: { help: "nope" } })).toEqual({ useful: true, why: null, risk: "routine", reasons: [] });
  });
  it("no reply to start from, nothing to do", () => {
    expect(checkinReplyRead({ analysis: { ...good, suggested_response: "" }, answers: {} }).useful).toBe(false);
  });
  it("the recap's flags, a request for help or pain wait for the coach", () => {
    expect(checkinReplyRead({ analysis: { ...good, urgency: "high" }, answers: {} }).reasons).toContain("checkin_important");
    expect(checkinReplyRead({ analysis: { ...good, red_flags: ["sleep under 5h most nights"] }, answers: {} }).reasons).toContain("checkin_flags");
    expect(checkinReplyRead({ analysis: good, answers: { help: "struggling to hit protein on weekends" } }).reasons).toContain("help");
    expect(checkinReplyRead({ analysis: good, answers: { recovery_flags: ["Pain / injury"] } }).reasons).toContain("pain_flag");
    expect(checkinReplyRead({ analysis: { ...good, urgency: "urgent" }, answers: {} }).risk).toBe("urgent");
  });
});

describe("missed sessions", () => {
  it("one is routine, a second in two weeks is a pattern for the coach", () => {
    expect(missedSessionRead({ missedInTwoWeeks: 1 }).risk).toBe("routine");
    expect(missedSessionRead({ missedInTwoWeeks: 2 })).toMatchObject({ risk: "review", reasons: ["missed_repeat"] });
  });
});

describe("set videos and progress check-ins need his eyes", () => {
  it("always waits for him, never routine", () => {
    expect(videoReplyRead({ videos: 3 })).toEqual({ useful: true, why: null, risk: "review", reasons: ["needs_eyes_video"] });
    expect(videoReplyRead({ videos: 0 }).useful).toBe(false);
    expect(progressReplyRead({ media: 4 })).toMatchObject({ risk: "review", reasons: ["needs_eyes_progress"] });
    expect(progressReplyRead({ media: 0 }).useful).toBe(false);
  });
  it("can never be set to send by itself, at any level", () => {
    for (const k of ["video_reply", "progress_reply"] as const) {
      expect(modeAllowed(OWNER, k, "automatic")).toBe(false);
      expect(modeAllowed(OWNER, k, "approval")).toBe(true);
      expect(modeAllowed(OWNER, k, "manual")).toBe(true);
      // a stored automatic steps down to asking him
      expect(effectiveMode({ features: OWNER, category: k, paused: false, setting: "automatic", clientRule: null })).toBe("approval");
    }
    expect(modeAllowed(QUEUE_ONLY, "video_reply", "approval")).toBe(true);
  });
  it("the draft never says how anything looked", () => {
    for (const bad of ["squats looked clean today", "depth was perfect on the top set", "you look leaner already", "bar path looked smooth", "your physique is coming along", "form looked solid"]) {
      expect(eyesProblems(bad)).not.toEqual([]);
    }
    for (const ok of ["got the videos, top set 140 kg x 3 @ 7 at 0.41 m/s", "thanks for sending these. 7-day average is down 0.8 kg from four weeks ago", "bench 100 x 5, speed held across the reps per the read"]) {
      expect(eyesProblems(ok)).toEqual([]);
    }
  });
  it("never pushes him again (the upload already did) and files where his own would go", () => {
    expect(pushesCoach("video_reply", "review")).toBe(false);
    expect(pushesCoach("progress_reply", "review")).toBe(false);
    expect(messageTypeFor("video_reply")).toBe("Training");
    expect(messageTypeFor("progress_reply")).toBe("General");
  });
  it("mirrors the database: never automatic for these two", () => {
    const sql = readFileSync("supabase/migrations/20270511090000_coaching_automation_videos_progress.sql", "utf8");
    expect(sql).toContain("WHEN _mode = 'automatic' AND _category IN ('video_reply', 'progress_reply') THEN false");
  });
});

describe("every kind follows the same safeguards", () => {
  const kinds = CATEGORIES.map((c) => c.key);
  it("lists all seven kinds, each mirrored in the latest migration", () => {
    expect(kinds).toEqual(["recovery_reply", "recovery_follow_up", "checkin_reply", "workout_reply", "video_reply", "progress_reply", "missed_session"]);
    const sql = readFileSync("supabase/migrations/20270511090000_coaching_automation_videos_progress.sql", "utf8");
    for (const k of kinds) expect(sql).toContain(`'${k}'`);
  });
  it("only routine ever goes out by itself, whatever the kind", () => {
    for (const risk of ["review", "urgent"] as const) expect(routeItem("automatic", risk)).toBe("awaiting_approval");
    expect(routeItem("automatic", "routine")).toBe("send");
  });
  it("outreach the client didn't start needs follow-ups; sending needs auto-send", () => {
    expect(modeNeeds("missed_session", "approval")).toContain("automation.follow_ups");
    expect(modeNeeds("workout_reply", "approval")).toEqual(["automation.approval_queue"]);
    expect(modeAllowed(QUEUE_ONLY, "missed_session", "approval")).toBe(false);
    expect(modeAllowed(QUEUE_ONLY, "checkin_reply", "automatic")).toBe(false);
    for (const k of kinds) expect(modeAllowed(OWNER, k as AutomationCategory, "automatic")).toBe(k !== "video_reply" && k !== "progress_reply");
  });
  it("defaults to asking first, never to sending", () => {
    for (const k of kinds) expect(effectiveMode({ features: OWNER, category: k as AutomationCategory, paused: false, setting: null, clientRule: null })).toBe("approval");
  });
  it("the coach is pushed only for what isn't already in front of him", () => {
    expect(pushesCoach("recovery_reply", "routine")).toBe(true);
    expect(pushesCoach("workout_reply", "routine")).toBe(false);
    expect(pushesCoach("checkin_reply", "review")).toBe(false);
    expect(pushesCoach("checkin_reply", "urgent")).toBe(true);
    expect(pushesCoach("missed_session", "review")).toBe(false);
  });
  it("messages are filed where the coach's own would be", () => {
    expect(messageTypeFor("recovery_reply")).toBe("Recovery");
    expect(messageTypeFor("checkin_reply")).toBe("General");
    expect(messageTypeFor("workout_reply")).toBe("Training");
  });
  it("every reason is said in words", () => {
    for (const r of ["question", "program_request", "mentions_pain", "low_rating", "help", "checkin_flags", "missed_repeat", "warning_words", "needs_eyes_video", "needs_eyes_progress"]) expect(riskReasonWords(r)).not.toBe(r);
  });
});

describe("the queue's order", () => {
  const item = (category: AutomationCategory, risk: "routine" | "review" | "urgent", status = "awaiting_approval", due = "2026-11-23T10:00:00Z") => ({ category, risk, status, due_at: due });
  it("what could be serious, then judgment calls, then routine; pain before check-ins before workouts before missed sessions", () => {
    const list = [
      item("missed_session", "routine"),
      item("workout_reply", "routine"),
      item("checkin_reply", "review"),
      item("workout_reply", "urgent"),
      item("recovery_reply", "routine"),
      item("checkin_reply", "routine", "draft"),
      item("checkin_reply", "routine"),
      item("video_reply", "review"),
      item("progress_reply", "review"),
    ].sort(queueOrder);
    expect(list.map((i) => `${i.risk}:${i.category}:${i.status}`)).toEqual([
      "urgent:workout_reply:awaiting_approval",
      "review:checkin_reply:awaiting_approval",
      "review:video_reply:awaiting_approval",
      "review:progress_reply:awaiting_approval",
      "routine:recovery_reply:awaiting_approval",
      "routine:checkin_reply:awaiting_approval",
      "routine:workout_reply:awaiting_approval",
      "routine:missed_session:awaiting_approval",
      "routine:checkin_reply:draft",
    ]);
  });
  it("the same kind and risk: the oldest first", () => {
    const a = item("workout_reply", "routine", "awaiting_approval", "2026-11-23T09:00:00Z");
    const b = item("workout_reply", "routine", "awaiting_approval", "2026-11-23T11:00:00Z");
    expect([b, a].sort(queueOrder)).toEqual([a, b]);
  });
});
