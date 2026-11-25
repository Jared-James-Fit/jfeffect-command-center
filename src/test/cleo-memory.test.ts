/**
 * What Cleo reads from a conversation (Nov 24 2026): the recent messages in
 * full, a summary of the rest, the client it's about and what's waiting; the
 * whole conversation stays stored. Plus the message box's keys and drafts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  cleanSummary,
  countsInMemory,
  KEEP_AFTER_SUMMARY,
  memoryText,
  parseTitleReply,
  planMemory,
  progressFor,
  RECENT_IN_FULL,
  summaryPrompt,
  SUMMARIZE_AFTER,
  type MemoryMessage,
} from "@/lib/cleo-memory";
import { draftKey, readDraft, writeDraft, clearDraft } from "@/lib/cleo-drafts";

const msgs = (n: number): MemoryMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0 ? `Question ${i}` : `Answer ${i}`,
    created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
    status: "done",
  }));

describe("what goes to the model", () => {
  it("sends the recent messages in full, never the whole lifetime", () => {
    const { recent, fold } = planMemory(msgs(10));
    expect(recent).toHaveLength(10);
    expect(fold).toEqual([]);
    const long = planMemory(msgs(40));
    expect(long.recent.length).toBeLessThanOrEqual(RECENT_IN_FULL);
    expect(long.recent[0].role).toBe("user");
    expect(long.recent[long.recent.length - 1].id).toBe("m39");
  });

  it("folds the older messages into the summary once enough build up, keeping the latest in full", () => {
    expect(planMemory(msgs(SUMMARIZE_AFTER - 1)).fold).toEqual([]);
    const { fold } = planMemory(msgs(SUMMARIZE_AFTER + 4));
    expect(fold).toHaveLength(SUMMARIZE_AFTER + 4 - KEEP_AFTER_SUMMARY);
    expect(fold[0].id).toBe("m0");
  });

  it("leaves out replaced messages and answers that never finished", () => {
    expect(countsInMemory({ id: "a", role: "assistant", content: "", created_at: "", status: "pending" })).toBe(false);
    expect(countsInMemory({ id: "a", role: "assistant", content: "Half", created_at: "", status: "failed" })).toBe(false);
    expect(countsInMemory({ id: "u", role: "user", content: "Old", created_at: "", superseded_at: "2026-11-01" })).toBe(false);
    expect(countsInMemory({ id: "u", role: "user", content: "Q", created_at: "" })).toBe(true);
  });

  it("a client's conversation is told who it's about, to stay on them, and what's waiting", () => {
    const text = memoryText({
      client: { id: "c1", name: "Marc Asugui" },
      section: "nutrition",
      category: "nutrition",
      summary: "Decisions: rest-day calories 2,350 kcal from Nov 20.",
      waiting: [{ summary: "Set Marc's rest-day calories to 2,350 kcal", status: "proposed" }],
      related: [{ title: "Marc's bench block", last_message_at: "2026-11-02T10:00:00Z", summary: "Top set RPE 8, back-offs 92.5%", preview: null }],
    });
    expect(text).toContain("THIS CONVERSATION IS ABOUT MARC ASUGUI");
    expect(text).toContain("Never mix in another client's records");
    expect(text).toContain("WHERE THE COACH IS NOW: Nutrition management.");
    expect(text).toContain("2,350 kcal from Nov 20");
    expect(text).toContain("waiting for them to tap Confirm");
    expect(text).toContain('"Marc\'s bench block"');
    expect(memoryText({})).toContain("GENERAL CONVERSATION");
  });

  it("the summary keeps decisions, exact numbers and open items, and the reply is tidied", () => {
    const prompt = summaryPrompt("People: Marc", [{ id: "1", role: "user", content: "Make it 3 x 5 @ 82.5% with 225 lb back-offs", created_at: "2026-11-20T10:00:00Z" }], "Marc");
    expect(prompt).toContain("3 x 5 @ 82.5% with 225 lb back-offs");
    expect(prompt).toContain("THE SUMMARY SO FAR");
    expect(cleanSummary("```\nPeople: Marc\nDecisions: 3x5 @ 82.5%\n```")).toBe("People: Marc\nDecisions: 3x5 @ 82.5%");
    expect(cleanSummary("ok")).toBeNull();
  });

  it("reads Cleo's title and topic, and says what it's doing from its look-ups", () => {
    expect(parseTitleReply('Sure: {"title":"Marc bench block","category":"program"}')).toEqual({ title: "Marc bench block", category: "program" });
    expect(parseTitleReply("no json")).toEqual({ title: null, category: null });
    expect(progressFor(["training_log"])).toBe("Reading the training log…");
    expect(progressFor(["nutrition", "propose_set_nutrition_targets"])).toBe("Setting up a card…");
    expect(progressFor([])).toBe("Thinking…");
  });
});

describe("drafts stay on the device", () => {
  it("per conversation (a new one per client), cleared when sent", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      },
    });
    expect(draftKey("chat-1", "c1")).toBe("chat:chat-1");
    expect(draftKey(null, "c1")).toBe("new:c1");
    expect(draftKey(null, null)).toBe("new:general");
    writeDraft("u1", "chat:a", "half-typed question");
    writeDraft("u1", "new:general", "another");
    expect(readDraft("u1", "chat:a")).toBe("half-typed question");
    expect(readDraft("u2", "chat:a")).toBe("");
    clearDraft("u1", "chat:a");
    expect(readDraft("u1", "chat:a")).toBe("");
    expect(readDraft("u1", "new:general")).toBe("another");
    vi.unstubAllGlobals();
  });
});

describe("every Cleo box: Enter sends, Shift+Enter is a new line", () => {
  const composer = readFileSync("src/components/cleo/cleo-composer.tsx", "utf8");

  it("the panel's composer", () => {
    expect(composer).toContain('if (e.key !== "Enter" || e.shiftKey) return;');
    expect(composer).toContain("e.nativeEvent.isComposing || (e.nativeEvent as any).keyCode === 229");
    expect(composer).toContain('enterKeyHint="send"');
    // never sends twice while a send is in flight
    expect(composer).toContain("if (!canSend || sending.current) return;");
  });

  it("the specialty docks (Training, Nutrition, Cardio)", () => {
    for (const p of ["src/components/program-ai/edit-with-ai.tsx", "src/components/cardio/cardio-cleo-panel.tsx", "src/components/nutrition/PlanAiChange.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toMatch(/e\.key === "Enter" && !e\.shiftKey && !e\.nativeEvent\.isComposing/);
      expect(src, p).not.toContain('(pointer: fine)").matches) {');
      expect(src, p).toContain('enterKeyHint="send"');
    }
    expect(readFileSync("src/components/cardio/cardio-cleo-panel.tsx", "utf8")).not.toContain('e.key === "Enter" && (e.metaKey || e.ctrlKey)');
  });

  it("dictation: a live waveform and the time, cancel, done, and Try again on a take that failed", () => {
    // the app's one recording bar (components/voice), Nov 25 2026
    expect(composer).toContain("<VoiceRecordingBar");
    expect(readFileSync("src/components/voice/voice-recorder.tsx", "utf8")).toContain('aria-label="Cancel recording"');
    expect(composer).toContain('doneLabel="Done: turn it into text"');
    expect(composer).toContain("Try again");
    expect(composer).toContain("use your keyboard's microphone to dictate");
    expect(readFileSync("src/lib/voice/voice-capture.ts", "utf8")).toContain('t.addEventListener("ended", () => finish(true, "interrupted"), { once: true })');
  });
});
