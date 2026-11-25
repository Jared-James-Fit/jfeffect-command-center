import { describe, expect, it } from "vitest";
import {
  assembleTranscript,
  clock,
  participantEstimate,
  speakerKey,
  speakers,
  speakersConfirmed,
  transcriptLines,
  type AudioPart,
} from "@/lib/coaching-sessions/recording";

const p0: AudioPart = {
  seq: 0,
  offset_ms: 0,
  status: "done",
  transcript: {
    consistent: false,
    segments: [
      { start: 0, end: 4, speaker: "A", text: "Hey Sam, how's the week been?" },
      { start: 5, end: 12, speaker: "B", text: "Pretty good, squats felt heavy though." },
      { start: 12.5, end: 15, speaker: "B", text: "Maybe sleep." },
    ],
  },
};
const p1: AudioPart = {
  seq: 1,
  offset_ms: 300_000,
  status: "done",
  transcript: {
    consistent: true,
    segments: [{ start: 1, end: 6, speaker: "A", text: "Let's set the openers." }],
  },
};

describe("a recording's transcript", () => {
  it("labels speakers neutrally until the coach names them; never a guess", () => {
    const lines = transcriptLines([p0], {});
    expect(lines.map((l) => l.speaker)).toEqual(["Speaker A", "Speaker B", "Speaker B"]);
    const named = transcriptLines([p0], { "0:A": { role: "coach" }, "0:B": { role: "client" } }, [
      { role: "client", name: "Sam" },
    ]);
    expect(named.map((l) => l.speaker)).toEqual(["Coach", "Sam", "Sam"]);
  });
  it("a part transcribed with the first part's voices keeps the same label across parts", () => {
    expect(speakerKey(p0, "A")).toBe("0:A");
    expect(speakerKey(p1, "A")).toBe("*:A");
    expect(speakerKey(p0, null)).toBeNull();
  });
  it("is timestamped from the start of the meeting, consecutive lines of one speaker joined", () => {
    const t = assembleTranscript([p0, p1], {
      "0:A": { role: "coach" },
      "0:B": { role: "client", name: "Sam" },
    });
    expect(t.split("\n")[0]).toBe("[0:00] Coach: Hey Sam, how's the week been?");
    expect(t.split("\n")[1]).toBe(
      "[0:05] Sam: Pretty good, squats felt heavy though. Maybe sleep.",
    );
    expect(t).toContain("[5:01]");
    expect(clock(3725)).toBe("1:02:05");
  });
  it("speakers to name, how many are talking, and when they're all named", () => {
    const list = speakers([p0], {});
    expect(list.map((s) => s.label)).toEqual(["Speaker A (part 1)", "Speaker B (part 1)"]);
    expect(participantEstimate([p0, p1])).toBe(2);
    expect(speakersConfirmed(list)).toBe(false);
    expect(
      speakersConfirmed(speakers([p0], { "0:A": { role: "coach" }, "0:B": { role: "client" } })),
    ).toBe(true);
    expect(speakersConfirmed([])).toBe(false);
  });
});
