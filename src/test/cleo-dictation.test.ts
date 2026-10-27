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

  it("after she answers it's your turn: one tap keeps the conversation going", () => {
    expect(chat).toMatch(/if \(turn === turnRef\.current\) setVoiceState\("ready"\);/);
    expect(chat).toContain("Keep talking");
    // The orb sends while listening, and otherwise starts listening (cutting her off).
    expect(chat).toContain("onClick={listening ? onSend : onTalk}");
    expect(chat).toContain("onTalk={startDictation}");
    // Nothing listens on its own: "ready" waits for the tap.
    expect(chat).not.toMatch(/setVoiceState\("ready"\);\s*\n\s*void dictate\(\)/);
  });

  it("Cleo's row in Messages opens straight into dictation with a mic", () => {
    expect(inbox).toContain("openSummer({ dictate: true })");
    expect(inbox).toContain('aria-label="Talk to Cleo"');
    expect(inbox).not.toContain("tap the phone");
  });
});

describe("Cleo in admin has no floating button", () => {
  const assistant = read("components/summer/summer-assistant.tsx");
  const layout = read("routes/_authenticated/admin/route.tsx");
  const styles = read("styles.css");

  it("draws no button of her own, only her chat sheet", () => {
    expect(assistant).not.toContain("data-summer-fab");
    expect(assistant).not.toContain('aria-label="Chat with Cleo"');
    expect(assistant).not.toMatch(/fixed right-4/);
    expect(styles).not.toContain(".summer-fab");
    expect(assistant).toContain("<SummerChat");
  });

  it("still opens from Messages, the shortcut and her pushes", () => {
    expect(layout).toContain('{role === "admin" && <SummerAssistant />}');
    expect(assistant).toContain('window.addEventListener("summer:open", onOpen);');
    expect(assistant).toMatch(/e\.shiftKey && \(e\.key === "S" \|\| e\.key === "s"\)/);
    expect(assistant).toContain('if (hash !== "cleo" && hash !== "#cleo") return;');
  });
});

describe("Cleo's speaker never sticks on Speaking", () => {
  const speaker = read("lib/summer-speaker.ts");

  it("finishes audio by the end of playback, an outside pause or the clock, not just 'ended'", () => {
    expect(speaker).toContain("el.ontimeupdate = () =>");
    expect(speaker).toContain("el.onpause = () =>");
    expect(speaker).toContain("finishBy(10_000)");
  });

  it("keeps device-voice utterances alive and watches the engine as a backstop", () => {
    expect(speaker).toContain("this.utterances.push(u);");
    expect(speaker).toMatch(/!ss\.speaking && !ss\.pending/);
  });

  it("a slow voice request falls back without turning the server voice off for good", () => {
    expect(speaker).toContain("SERVER_VOICE_TIMEOUT_MS");
    expect(speaker).toContain("if (i === 0 && !r.timedOut) this.serverVoiceOff = true;");
  });

  it("caps device speech by reply length", async () => {
    const { deviceSpeechCapMs } = await import("@/lib/summer-speaker");
    expect(deviceSpeechCapMs("", 1)).toBe(5000);
    const forty = Array(40).fill("word").join(" ");
    expect(deviceSpeechCapMs(forty, 1)).toBe(30600);
    expect(deviceSpeechCapMs(forty, 2)).toBeLessThan(deviceSpeechCapMs(forty, 1));
  });
});
