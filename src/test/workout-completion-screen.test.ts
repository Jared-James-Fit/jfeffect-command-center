/**
 * The workout completion screen (Nov 25 2026): achievement → performance →
 * optional sharing → Done; one Share workout; the save-video line once per
 * workout; nothing pops up after filming.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completionMessage, completionStats, formatMinutes, recapStatus, recordsLine, recordsText, ringDash } from "@/lib/workouts/completion-screen";
import { markOffered, saveVideosLabel, shouldOfferSave, wasOffered, KEEP_MS, SAVE_OFFER_KEY } from "@/lib/set-videos/save-offer";
import { explainWorkoutScore } from "@/lib/workout-summary";
import type { RepRecord, WorkoutRecords } from "@/lib/training-records";

const read = (p: string) => readFileSync(p, "utf8");

const rec = (o: Partial<RepRecord> & { set_id: string; exercise_name: string }): RepRecord => ({
  exercise_id: null,
  exercise_key: o.exercise_name.toLowerCase(),
  reps: 3,
  load_kg: 100,
  atpr: false,
  program_pr: false,
  block_pr: false,
  ...o,
});
const records = (r: RepRecord[], load: RepRecord[] = [], tonnage = { atpr: false, program_pr: false, block_pr: false }): WorkoutRecords => ({
  workout_key: "w",
  tonnage_kg: 5000,
  tonnage,
  records: r,
  load_records: load,
  exercise_tonnage: [],
});

describe("the line under the score is earned, never misleading", () => {
  const base = { headlinePr: false, completedSets: 18, prescribedSets: 18, score: 100, planLines: [] };
  it("in order: a headline PR, every set done, a strong session, else session complete", () => {
    expect(completionMessage({ ...base, headlinePr: true })).toBe("New personal best.");
    expect(completionMessage(base)).toBe("Every prescribed set completed.");
    expect(completionMessage({ ...base, completedSets: 16, score: 89 })).toBe("Strong session.");
    expect(completionMessage({ ...base, completedSets: 9, score: 50 })).toBe("Session complete.");
  });
  it("a plan that ran hot or came up short is never cheered", () => {
    expect(completionMessage({ ...base, planLines: [{ kind: "harder" }] })).toBe("Session complete.");
    expect(completionMessage({ ...base, completedSets: 17, score: 94, planLines: [{ kind: "short" }] })).toBe("Session complete.");
    expect(completionMessage({ ...base, completedSets: 16, score: 89, pain: true })).toBe("Session complete.");
    // an easier set is no reason to hold back the facts
    expect(completionMessage({ ...base, planLines: [{ kind: "easier" }] })).toBe("Every prescribed set completed.");
  });
  it("no plan: never 'every prescribed set'", () => {
    expect(completionMessage({ ...base, prescribedSets: 0, completedSets: 12, score: 100 })).toBe("Strong session.");
  });
});

describe("the stats are the ones this workout has", () => {
  it("leaves out what's empty and keeps at most five", () => {
    const all = completionStats({ durationMin: 72, completedSets: 18, prescribedSets: 18, filmed: 7, volume: "12,400 lb", prs: 2, leaguePoints: 25 });
    expect(all.map((s) => s.key)).toEqual(["duration", "sets", "volume", "filmed", "prs"]);
    expect(all[0].value).toBe("1h 12m");
    const cardioDay = completionStats({ durationMin: 30, completedSets: 1, prescribedSets: 1, filmed: 0, volume: null, prs: 0 });
    expect(cardioDay.map((s) => s.key)).toEqual(["duration", "sets"]);
    expect(completionStats({ completedSets: 5, prescribedSets: 0, leaguePoints: 12 }).map((s) => s.value)).toEqual(["5", "+12"]);
    expect(formatMinutes(48)).toBe("48m");
  });
});

describe("records: counted like New records lists them, all-time only when they are", () => {
  it("a set that's both a rep and a weight record is one; the headline lift first", () => {
    const r = records(
      [rec({ set_id: "a", exercise_name: "Competition Bench", atpr: true }), rec({ set_id: "b", exercise_name: "Competition Squat", atpr: true })],
      [rec({ set_id: "a", exercise_name: "Competition Bench", atpr: true })],
    );
    const line = recordsLine(r, "Competition Squat")!;
    expect(line.count).toBe(2);
    expect(line.names).toEqual(["Competition Squat", "Competition Bench"]);
    expect(recordsText(line)).toBe("2 new personal records · Competition Squat · Competition Bench");
  });
  it("a block or program best is a record, not a personal best; more than two names fold", () => {
    const r = records(
      [rec({ set_id: "a", exercise_name: "Leg Press", block_pr: true }), rec({ set_id: "b", exercise_name: "Row", atpr: true }), rec({ set_id: "c", exercise_name: "Curl", program_pr: true })],
      [],
      { atpr: false, program_pr: true, block_pr: true },
    );
    const line = recordsLine(r)!;
    expect(line.count).toBe(4);
    expect(line.allTime).toBe(false);
    expect(recordsText(line)).toBe("4 new records · Leg Press · Row · +2");
  });
  it("none: no section", () => {
    expect(recordsLine(records([]))).toBeNull();
    expect(recordsLine(null)).toBeNull();
  });
});

describe("where the workout already is, said once", () => {
  it("Crew (its post or its film, one slot) wins; a story beside it is said together", () => {
    const none = { inFeed: false, filmPosted: false, storyShared: false, autoUp: false, hidden: false };
    expect(recapStatus(none)).toBeNull();
    expect(recapStatus({ ...none, filmPosted: true })).toBe("crew");
    expect(recapStatus({ ...none, inFeed: true, storyShared: true })).toBe("crew+story");
    expect(recapStatus({ ...none, storyShared: true })).toBe("story");
    expect(recapStatus({ ...none, autoUp: true })).toBe("auto");
    expect(recapStatus({ ...none, hidden: true })).toBe("hidden");
  });
});

describe("the score ring and its explanation", () => {
  it("draws the arc to the score; the explanation drops the stars where none are shown", () => {
    expect(ringDash(0, 42).dash.startsWith("0.00 ")).toBe(true);
    const full = ringDash(100, 42);
    expect(full.dash).toBe(`${full.length.toFixed(2)} ${full.length.toFixed(2)}`);
    const s = { score: 90, completedSets: 9, prescribedSets: 10, completionPct: 90 };
    expect(explainWorkoutScore(s).some((l) => l.startsWith("Stars"))).toBe(true);
    expect(explainWorkoutScore(s, { stars: false }).some((l) => l.startsWith("Stars"))).toBe(false);
  });
});

describe("Save N videos to device: at most once per workout", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("shown once, remembered per login, pruned when old", () => {
    const s = mem();
    expect(wasOffered(s, "u1", "c1")).toBe(false);
    markOffered(s, "u1", "c1", 1_000);
    expect(wasOffered(s, "u1", "c1")).toBe(true);
    expect(wasOffered(s, "u2", "c1")).toBe(false);
    markOffered(s, "u1", "c2", 1_000 + KEEP_MS + 1);
    expect(wasOffered(s, "u1", "c1")).toBe(false);
    expect(JSON.parse(s.m.get(SAVE_OFFER_KEY)!).u1.c2).toBeGreaterThan(0);
  });
  it("only with clips to save, on their own phone, never twice", () => {
    const ok = { eligible: 3, viewingAsClient: false, phone: true, offeredBefore: false };
    expect(shouldOfferSave(ok)).toBe(true);
    expect(shouldOfferSave({ ...ok, eligible: 0 })).toBe(false);
    expect(shouldOfferSave({ ...ok, viewingAsClient: true })).toBe(false);
    expect(shouldOfferSave({ ...ok, phone: false })).toBe(false);
    expect(shouldOfferSave({ ...ok, offeredBefore: true })).toBe(false);
    expect(saveVideosLabel(1)).toBe("Save 1 video to device");
    expect(saveVideosLabel(7)).toBe("Save 7 videos to device");
  });
});

describe("the screen itself", () => {
  const screen = read("src/components/workout-submission-summary.tsx");
  const share = read("src/components/community/recap-post.tsx");
  const copy = read("src/components/workout-day/set-video-phone-copy.tsx");

  it("achievement first: the workout, the ring, the line; no stars beside the score", () => {
    expect(screen).toContain("strokeDasharray={ring.dash}");
    expect(screen).toContain("data-recap-message>{message}");
    expect(screen).not.toContain("<Star ");
    expect(screen).toContain("explainWorkoutScore(summary, { pain, ownRating: sessionRating, stars: false })");
  });

  it("one scroll, one full-width Done with safe-area room, sharing behind one Share workout", () => {
    expect(screen.match(/overflow-y-auto/g)?.length).toBe(1);
    expect(screen).toContain('style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}');
    expect(screen).toContain('className="h-12 w-full rounded-xl text-[15px] font-semibold" onClick={close} data-recap-done');
    expect(share).toContain("Share workout");
    expect(share).toContain('<SheetContent\n          side="bottom"');
    // the studio, the quick story, Share outside and League points are all still there
    for (const s of ['"Share to Story"', '{inFeed ? "Edit Crew post" : "Create Crew Post"}', "<ShareOutSheet", "<QuickStorySheet", "league points", "Save workout summary"]) expect(share).toContain(s);
    // said once: no "In the feed" / "In the Crew feed" repeated on the recap
    expect(share).not.toContain("In the Crew feed");
    expect(share).toContain("Shared to Crew");
  });

  it("records are one subtle line, expandable, gone when there are none", () => {
    expect(screen).toContain("{recLine && (");
    expect(screen).toContain("aria-expanded={recordsOpen}");
  });

  it("no save pop-up after filming, none during the review or on a reopened workout's card", () => {
    expect(copy).not.toContain("export function offerPhoneCopy");
    expect(copy).not.toContain("export function PhoneCopyReminder");
    expect(read("src/components/workout-day/set-video-flow.tsx")).not.toContain("offerPhoneCopy");
    expect(read("src/components/workout/shared/workout-review-editor.tsx")).not.toContain("PhoneCopyReminder");
    expect(read("src/components/workout/shared/completed-workout-actions.tsx")).not.toContain("PhoneCopyReminder");
    expect(screen).toContain("<SaveVideosInline dayId={dayId} workoutKey={completionId} />");
    // never claims the clips are in Photos
    expect(copy).not.toMatch(/Saved to (your )?Photos/);
  });
});
