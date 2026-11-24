/**
 * Talking to Cleo is dictation: it listens until the tap, pauses never end
 * it, and every way in shows a mic (not a phone).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Cleo dictation", () => {
  const mic = read("hooks/use-summer-mic.ts");
  const chat = read("components/cleo/cleo-panel.tsx");
  const inbox = read("route-pages/_authenticated/admin/messages.tsx");

  it("never stops on silence while dictating; only a tap or the cap ends it", () => {
    expect(mic).toMatch(/if \(!dictate && heardAt && now - lastLoud > silenceMs\) return finish\(true\);/);
    expect(mic).toMatch(/if \(!dictate && !heardAt && now - startedAt > noSpeechMs\) return finish\(false\);/);
    // The cap sends what was said rather than throwing it away.
    expect(mic).toMatch(/timer = window\.setTimeout\(\(\) => finish\(true\), maxMs\);/);
  });

  it("the panel dictates up to 5 minutes into the box, to read and change before sending", () => {
    const composer = read("components/cleo/cleo-composer.tsx");
    expect(composer).toContain("useSummerMic({ dictate: true, maxMs: DICTATION_MAX_MS })");
    expect(composer).toContain("export const DICTATION_MAX_MS = 5 * 60_000;");
    // the words go in the box; nothing is sent until they tap Send
    expect(composer).toContain("insert(text);");
    expect(chat).toContain("transcribe={transcribe}");
    expect(chat).not.toMatch(/PhoneOff|Call Cleo|End call/);
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

  it("draws no button of its own, only the chat sheet", () => {
    expect(assistant).not.toContain("data-summer-fab");
    expect(assistant).not.toContain('aria-label="Chat with Cleo"');
    expect(assistant).not.toMatch(/fixed right-4/);
    expect(styles).not.toContain(".summer-fab");
    expect(assistant).toContain("<CleoPanel />");
  });

  it("still opens from Messages, the shortcut and Cleo's pushes", () => {
    // Mounted for whoever has Cleo (the admin always; finance and coaches by switch).
    expect(layout).toContain("{cleoOn && <SummerAssistant />}");
    const panel = read("components/cleo/cleo-panel.tsx");
    expect(panel).toContain('window.addEventListener("summer:open", onOpen);');
    expect(panel).toMatch(/e\.shiftKey && \(e\.key === "S" \|\| e\.key === "s"\)/);
    expect(panel).toContain('if (hash !== "cleo" && hash !== "#cleo") return;');
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
