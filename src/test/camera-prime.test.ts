import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRIME_TTL_MS, firstCameraAsk, primeCamera, primedCameraForTests, studioCameraAsk, takePrimedCamera } from "@/lib/camera/camera-prime";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const g = globalThis as any;
const withNavigator = (nav: unknown) => Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });

/**
 * Nov 19 2026: on an iPhone WebKit reuses a camera "Allow" without asking only
 * for a request made from a tap once nothing has been captured for a minute;
 * the film camera asked from an effect after it opened, so the tap that opens
 * it now starts the request and the camera takes that answer.
 */
describe("the camera asked for inside the tap that opens it", () => {
  const track = () => ({ stop: vi.fn() });
  let t: ReturnType<typeof track>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    t = track();
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [t] });
    withNavigator({ mediaDevices: { getUserMedia } });
  });
  afterEach(async () => {
    const left = takePrimedCamera({ never: true } as MediaTrackConstraints);
    if (left && "released" in left) await left.released;
    vi.useRealTimers();
    withNavigator(undefined);
  });

  it("asks at once, with the camera's own first ask, and the camera takes that answer", async () => {
    primeCamera();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const first = firstCameraAsk()!;
    expect(getUserMedia.mock.calls[0][0]).toEqual({ video: first.ask, audio: false });
    const taken = takePrimedCamera(first.ask);
    expect(taken && "stream" in taken).toBe(true);
    expect(await (taken as { stream: Promise<MediaStream> }).stream).toEqual({ getTracks: expect.any(Function) });
    expect(t.stop).not.toHaveBeenCalled();
    expect(primedCameraForTests()).toBeNull();
  });

  it("an answer for something else is let go before the camera asks for its own", async () => {
    primeCamera();
    const taken = takePrimedCamera({ width: { ideal: 1 } });
    expect(taken && "released" in taken).toBe(true);
    await (taken as { released: Promise<void> }).released;
    expect(t.stop).toHaveBeenCalled();
  });

  it("an answer nobody takes never leaves the camera on", async () => {
    primeCamera();
    await vi.advanceTimersByTimeAsync(PRIME_TTL_MS + 10);
    expect(t.stop).toHaveBeenCalled();
    expect(primedCameraForTests()).toBeNull();
  });

  it("a no is the camera's to report, never an unhandled rejection", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    primeCamera();
    const taken = takePrimedCamera(firstCameraAsk()!.ask) as { stream: Promise<MediaStream> };
    await expect(taken.stream).rejects.toThrow("denied");
  });

  it("every way into the film camera primes it, and the camera takes it on its first ask", () => {
    expect(read("src/components/workout-day/set-video-cell.tsx")).toMatch(/if \(!canFilmInApp\(\)\) return openPicker\(\);\n[^\n]*\n\s*primeCamera\(\);/);
    // a back-camera capture primes in the tap; a selfie one (a profile photo) isn't primed with the back camera
    expect(read("src/components/camera/use-film-camera.tsx")).toMatch(/if \(!canFilmInApp\(\)\) return false;\n(?:[^\n]*\n){1,2}\s*if \(!purpose \|\| PURPOSES\[purpose\]\.facing === "environment"\) primeCamera\(\);/);
    const cam = read("src/components/camera/film-camera.tsx");
    expect(cam).toContain("const primed = first ? takePrimedCamera(ask) : null;");
  });

  it("the Crew camera too (Nov 21 2026): its + tap asks the studio's own first ask, and the studio takes it", async () => {
    primeCamera(studioCameraAsk("environment"));
    expect(getUserMedia.mock.calls[0][0]).toEqual({ video: studioCameraAsk("environment"), audio: false });
    const taken = takePrimedCamera(studioCameraAsk("environment"));
    expect(taken && "stream" in taken).toBe(true);
    await (taken as { stream: Promise<MediaStream> }).stream;
    expect(read("src/components/community/share-workout-picker.tsx")).toContain('primeCamera(studioCameraAsk("environment"));');
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("{ video: studioCameraAsk(facing, null, quality), audio: false },");
    expect(studio).toContain("const primed = takePrimedCamera(studioCameraAsk(facing, null, quality));");
    expect(studio).toContain('if (i === 0 && primed && "stream" in primed) return await primed.stream;');
  });
});
