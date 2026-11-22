import { describe, expect, it } from "vitest";
import {
  captionSetPlace,
  exerciseScore,
  matchChatLift,
  type ChatLiftSet,
} from "@/lib/lift-analysis/chat-lift";

const T = (min: number) =>
  new Date(Date.parse("2026-11-20T18:00:00Z") + min * 60_000).toISOString();
const sent = T(0);

/** A Thursday: comp bench 4 sets, then close grip bench 3 sets, then curls. */
function workout(): ChatLiftSet[] {
  const out: ChatLiftSet[] = [];
  for (let i = 1; i <= 4; i++)
    out.push({
      rowId: "comp",
      dayId: "d1",
      setIndex: i,
      exercise: "Competition Bench",
      completedAt: T(-60 + i * 5),
      reps: i === 1 ? 3 : 5,
      setName: i === 1 ? "Top set" : `Backoff ${i - 1}`,
    });
  for (let i = 1; i <= 3; i++)
    out.push({
      rowId: "cg",
      dayId: "d1",
      setIndex: i,
      exercise: "Close Grip Bench Press",
      completedAt: T(-20 + i * 5),
      reps: 8,
      setName: `Set ${i}`,
    });
  for (let i = 1; i <= 3; i++)
    out.push({
      rowId: "curl",
      dayId: "d1",
      setIndex: i,
      exercise: "Dumbbell Curl",
      completedAt: T(-4),
      reps: 12,
    });
  return out;
}

describe("reading a chat caption", () => {
  it("names the exercise the way lifters write it", () => {
    expect(exerciseScore("Last set comp bench", "Competition Bench")).toBe(1);
    expect(exerciseScore("1st set close grip bench", "Close Grip Bench Press")).toBeGreaterThan(
      0.6,
    );
    expect(exerciseScore("1st set close grip bench", "Competition Bench")).toBeLessThan(0.3);
    expect(exerciseScore("Last set comp bench", "Close Grip Bench Press")).toBeLessThan(0.3);
    expect(exerciseScore("squat top single", "Competition Bench")).toBe(0);
  });
  it("reads a set's place", () => {
    expect(captionSetPlace("1st set close grip bench")).toEqual({ kind: "index", n: 1 });
    expect(captionSetPlace("set 3")).toEqual({ kind: "index", n: 3 });
    expect(captionSetPlace("Last set comp bench")).toEqual({ kind: "last" });
    expect(captionSetPlace("top set")).toEqual({ kind: "top" });
    expect(captionSetPlace("backoff 2")).toEqual({ kind: "backoff", n: 2 });
    expect(captionSetPlace("how does this look")).toBeNull();
    expect(captionSetPlace("1st working set comp bench")).toEqual({ kind: "index", n: 1 });
    expect(captionSetPlace("Squat last set warm up")).toEqual({ kind: "warmup" });
  });
});

describe("which set a chat video shows", () => {
  it("links when the words name the lift and the set, and the reps agree", () => {
    const m = matchChatLift({
      caption: "1st set close grip bench",
      sentAt: T(-12),
      sets: workout(),
      video: { dir: "lower_first", reps: 8 },
    });
    expect(m.kind).toBe("link");
    if (m.kind === "link") expect([m.set.rowId, m.set.setIndex]).toEqual(["cg", 1]);
  });

  it("'Last set comp bench' sent long after: the last comp bench set, linked once the reps agree", () => {
    const m = matchChatLift({
      caption: "Last set comp bench",
      sentAt: sent,
      sets: workout(),
      video: { dir: "lower_first", reps: 5 },
    });
    expect(m.kind).toBe("link");
    if (m.kind === "link") expect([m.set.rowId, m.set.setIndex]).toEqual(["comp", 4]);
  });

  it("never links when the reps in the video don't match the set: offered instead", () => {
    const m = matchChatLift({
      caption: "Last set comp bench",
      sentAt: sent,
      sets: workout(),
      video: { dir: "lower_first", reps: 3 },
    });
    expect(m.kind).toBe("suggest");
  });

  it("no words, the only barbell lift being done: the set logged just before, linked once the reps agree", () => {
    const sets = workout().filter((s) => s.rowId === "cg");
    const before = matchChatLift({ caption: "", sentAt: T(-3), sets });
    expect(before.kind).toBe("suggest");
    const after = matchChatLift({
      caption: "",
      sentAt: T(-3),
      sets,
      video: { dir: "lower_first", reps: 8 },
    });
    expect(after.kind).toBe("link");
    if (after.kind === "link") expect([after.set.rowId, after.set.setIndex]).toEqual(["cg", 3]);
  });

  it("no words in a batch after the workout (two lifts done): offered, never linked, whatever the reps", () => {
    // "1st working set" sent with seven others after the session: it could be either lift
    const sets = workout().filter((s) => s.rowId !== "curl");
    const m = matchChatLift({
      caption: "1st working set",
      sentAt: T(-3),
      sets,
      video: { dir: "lower_first", reps: 8 },
    });
    expect(m.kind).not.toBe("link");
  });

  it("a warm-up is never put on a working set", () => {
    const m = matchChatLift({
      caption: "Last warm up for comp bench",
      sentAt: sent,
      sets: workout(),
      video: { dir: "lower_first", reps: 5 },
    });
    expect(m.kind).toBe("day");
  });

  it("the same evening: the workout is known and the athlete picks the set", () => {
    const m = matchChatLift({ caption: "", sentAt: T(600), sets: workout() });
    expect(m.kind).toBe("day");
  });

  it("the bar going the wrong way for the lift named: the workout only, never that set", () => {
    const m = matchChatLift({
      caption: "Last set comp bench",
      sentAt: sent,
      sets: workout(),
      video: { dir: "lift_first", reps: 5 },
    });
    expect(m.kind).toBe("day");
  });

  it("nothing logged around then and no lift named: not a lift video", () => {
    const m = matchChatLift({ caption: "Is this normal?", sentAt: T(15 * 60), sets: workout() });
    expect(m.kind).toBe("none");
  });

  it("only a machine logged: not a lift video", () => {
    const sets: ChatLiftSet[] = [
      {
        rowId: "lp",
        dayId: "d1",
        setIndex: 1,
        exercise: "Leg Press Machine",
        completedAt: T(-2),
        reps: 10,
      },
    ];
    expect(matchChatLift({ caption: "", sentAt: sent, sets }).kind).toBe("none");
  });
});

/**
 * A real evening (Oct 22 2026, anonymised: the lifts, set numbers, rep counts
 * and times as logged; row ids replaced): a squat, a comp bench as a top
 * single then four back-offs on two rows, close grip bench, each row logged
 * in one moment by the fill-down, then eight videos sent in one burst after
 * the session, captioned by the athlete.
 */
describe("a real evening's batch of chat videos", () => {
  const at = (hms: string) => `2026-10-22T${hms}Z`;
  const sets: ChatLiftSet[] = [
    ...[1, 2, 3].map((i) => ({
      rowId: "sq",
      dayId: "d",
      setIndex: i,
      exercise: "2-Count Paused Squat",
      completedAt: at("02:07:53.54"),
      reps: 3,
    })),
    {
      rowId: "cb1",
      dayId: "d",
      setIndex: 1,
      exercise: "Competition Bench",
      completedAt: at("02:26:37.736"),
      reps: 1,
    },
    ...[1, 2, 3, 4].map((i) => ({
      rowId: "cb2",
      dayId: "d",
      setIndex: i,
      exercise: "Competition Bench",
      completedAt: at("02:30:01.55"),
      reps: 3,
    })),
    ...[1, 2, 3].map((i) => ({
      rowId: "cg",
      dayId: "d",
      setIndex: i,
      exercise: "Close-Grip Bench Press",
      completedAt: at("02:48:40.56"),
      reps: 5,
    })),
    ...[1, 2, 3].map((i) => ({
      rowId: "row",
      dayId: "d",
      setIndex: i,
      exercise: "Dumbbells Single Arm Row",
      completedAt: at("03:02:27.76"),
      reps: 10,
    })),
  ];
  const go = (caption: string, sent: string, reps: number) =>
    matchChatLift({ caption, sentAt: at(sent), sets, video: { dir: "lower_first", reps } });
  const where = (m: ReturnType<typeof matchChatLift>) =>
    m.kind === "link" || m.kind === "suggest"
      ? `${m.kind} ${m.set.rowId}:${m.set.setIndex}`
      : m.kind;

  it("never puts a warm-up on a working set", () => {
    expect(where(go("Squat last set warm up", "03:03:41", 3))).toBe("day");
    expect(where(go("Last warm up for comp bench", "03:04:16", 2))).toBe("day");
  });
  it("asks when the words name no lift and the session had several", () => {
    expect(where(go("1st working set", "03:03:59", 3))).toBe("day");
    expect(where(go("Last working set", "03:04:14", 3))).toBe("day");
  });
  it("reads a lift on two rows as one: the top single first, the last back-off last", () => {
    expect(where(go("1st working set comp bench", "03:04:31", 1))).toBe("link cb1:1");
    expect(where(go("Last set comp bench", "03:05:06", 3))).toBe("link cb2:4");
  });
  it("links the close grip sets by their place, once the reps agree", () => {
    expect(where(go("1st set close grip bench", "03:05:15", 5))).toBe("link cg:1");
    expect(where(go("Last set close grip bench", "03:05:32", 5))).toBe("link cg:3");
    // a rep count that doesn't match is offered, never linked
    expect(where(go("Last set close grip bench", "03:05:32", 4))).toBe("suggest cg:3");
  });
});
