import { afterEach, describe, expect, it, vi } from "vitest";
import { getMicStream, isAudioSessionError, prepareForCapture, setAudioSessionType } from "@/lib/audio-session";

const g = globalThis as any;

function withNavigator(nav: any) {
  Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });
}

afterEach(() => {
  withNavigator(undefined);
});

describe("audio session for recording on iPhone", () => {
  it("switches to play-and-record for the capture and restores the app's mode", () => {
    const session = { type: "ambient" };
    withNavigator({ audioSession: session });
    const restore = prepareForCapture();
    expect(session.type).toBe("play-and-record");
    restore();
    expect(session.type).toBe("ambient");
    restore(); // idempotent
    expect(session.type).toBe("ambient");
  });

  it("is a no-op where the API doesn't exist", () => {
    withNavigator({});
    expect(setAudioSessionType("playback")).toBeNull();
    expect(() => prepareForCapture()()).not.toThrow();
  });

  it("recognizes WebKit's session error", () => {
    expect(isAudioSessionError(new Error("AudioSession category is not compatible with audio capture."))).toBe(true);
    expect(isAudioSessionError(Object.assign(new Error("denied"), { name: "NotAllowedError" }))).toBe(false);
  });

  it("retries once with the session on auto when WebKit still refuses", async () => {
    const session = { type: "playback" };
    const stream = { id: "s" };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("AudioSession category is not compatible with audio capture."))
      .mockResolvedValueOnce(stream);
    withNavigator({ audioSession: session, mediaDevices: { getUserMedia } });
    const res = await getMicStream(true);
    expect(res.stream).toBe(stream);
    expect(session.type).toBe("auto");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    res.restore();
    expect(session.type).toBe("playback");
  });

  it("restores the mode when the mic is refused for another reason", async () => {
    const session = { type: "ambient" };
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    withNavigator({ audioSession: session, mediaDevices: { getUserMedia } });
    await expect(getMicStream(true)).rejects.toThrow("denied");
    expect(session.type).toBe("ambient");
  });
});
