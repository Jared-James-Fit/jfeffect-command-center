/**
 * Talking to Cleo is dictation: it listens until the tap, pauses never end
 * it, and every way in shows a mic (not a phone).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Cleo dictation", () => {
  const mic = read("hooks/use-summer-mic.ts");
  const chat = read("components/admin/books/summer-chat.tsx");
  const inbox = read("route-pages/_authenticated/admin/messages.tsx");

  it("never stops on silence while dictating; only a tap or the cap ends it", () => {
    expect(mic).toMatch(/if \(!dictate && heardAt && now - lastLoud > silenceMs\) return finish\(true\);/);
    expect(mic).toMatch(/if \(!dictate && !heardAt && now - startedAt > noSpeechMs\) return finish\(false\);/);
    // The cap sends what was said rather than throwing it away.
    expect(mic).toMatch(/timer = window\.setTimeout\(\(\) => finish\(true\), maxMs\);/);
  });

  it("the chat dictates for up to 5 minutes with an obvious Send", () => {
    expect(chat).toContain("useSummerMic({ dictate: true, maxMs: DICTATION_MAX_MS })");
    expect(chat).toContain("const DICTATION_MAX_MS = 5 * 60_000;");
    expect(chat).toContain("Send to {ASSISTANT_NAME}");
    expect(chat).not.toMatch(/PhoneOff|Call Cleo|End call/);
  });

  it("Cleo's row in Messages opens straight into dictation with a mic", () => {
    expect(inbox).toContain("openSummer({ dictate: true })");
    expect(inbox).toContain('aria-label="Talk to Cleo"');
    expect(inbox).not.toContain("tap the phone");
  });
});
