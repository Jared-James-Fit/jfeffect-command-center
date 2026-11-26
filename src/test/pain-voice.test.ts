/**
 * "Describe it" by voice: a refused transcriber never loses what they said.
 * Nov 23 2026: OpenAI answered 429 on gpt-4o-mini-transcribe and the pain
 * report got nothing; the next transcriber in line answers instead.
 */
import { describe, expect, it, vi } from "vitest";
import { audioExt, painTranscribers, transcribePainAudio } from "@/lib/pain/describe.server";

const audio = Buffer.from("not really audio but some bytes").toString("base64");

function fake(name: string, run: () => Promise<string>) {
  return { name, run: vi.fn(run) };
}

describe("pain voice transcription", () => {
  it("falls through a refused transcriber to the next one", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fake("openai:gpt-4o-mini-transcribe", async () => {
      throw new Error("429 rate limit");
    });
    const second = fake("openai:whisper-1", async () => "my left knee is a 5 on squats");
    const third = fake("gateway:gemini-2.5-flash", async () => "never asked");
    const r = await transcribePainAudio(audio, "audio/mp4", [first, second, third]);
    expect(r).toEqual({ text: "my left knee is a 5 on squats", via: "openai:whisper-1" });
    expect(third.run).not.toHaveBeenCalled();
    err.mockRestore();
    warn.mockRestore();
  });

  it("an empty answer means nothing was said, never another try", async () => {
    const first = fake("a", async () => "");
    const second = fake("b", async () => "words");
    expect(await transcribePainAudio(audio, "audio/webm", [first, second])).toEqual({
      text: "",
      via: "a",
    });
    expect(second.run).not.toHaveBeenCalled();
  });

  it("says so in plain words when every transcriber refuses", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = [
      fake("a", async () => Promise.reject(new Error("429"))),
      fake("b", async () => Promise.reject(new Error("403"))),
    ];
    await expect(transcribePainAudio(audio, "audio/webm", down)).rejects.toThrow(
      "Couldn't turn that into words right now",
    );
    err.mockRestore();
  });

  it("orders OpenAI's transcriber, then Whisper, and never the Lovable gateway (no Lovable credits)", () => {
    expect(
      painTranscribers({ OPENAI_API_KEY: "k", LOVABLE_API_KEY: "g" } as any).map((t) => t.name),
    ).toEqual(["openai:gpt-4o-mini-transcribe", "openai:whisper-1"]);
    expect(painTranscribers({ LOVABLE_API_KEY: "g" } as any)).toEqual([]);
    expect(painTranscribers({})).toEqual([]);
  });

  it("names an iPhone recording as audio OpenAI and Gemini both read", () => {
    expect(audioExt("audio/mp4")).toEqual({ ext: "m4a", format: "mp4" });
    expect(audioExt("audio/webm;codecs=opus")).toEqual({ ext: "webm", format: "webm" });
  });

  it("refuses a recording over the size cap before asking anyone", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64");
    const t = fake("a", async () => "x");
    await expect(transcribePainAudio(big, "audio/webm", [t])).rejects.toThrow("too long");
    expect(t.run).not.toHaveBeenCalled();
  });
});
