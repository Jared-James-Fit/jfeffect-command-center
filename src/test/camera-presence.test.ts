import { describe, expect, it } from "vitest";

// A stand-in page: two theme-color tags and the root element (the test runs in node).
const attrs = new Map<string, string>();
const classes = new Set<string>();
const metas = [0, 1].map(() => {
  let content = "#f6f7f8";
  return { getAttribute: () => content, setAttribute: (_: string, v: string) => void (content = v) };
});
(globalThis as any).document = {
  documentElement: {
    hasAttribute: (k: string) => attrs.has(k),
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    classList: { contains: (c: string) => classes.has(c) },
  },
  querySelectorAll: () => metas,
};
(globalThis as any).window ??= { dispatchEvent() {} };
(globalThis as any).CustomEvent ??= class {
  constructor(public type: string) {}
};

const { CAMERA_THEME_COLOR, holdCameraOpen, isCameraOpen } = await import("@/lib/camera/camera-presence");
const colours = () => metas.map((m) => m.getAttribute());
const reset = (c: string) => metas.forEach((m) => m.setAttribute("content", c));

describe("the camera is full screen: a black status bar while it's up", () => {
  it("paints the status bar black and gives the page's colour back after", () => {
    reset("#f6f7f8");
    const close = holdCameraOpen();
    expect(isCameraOpen()).toBe(true);
    expect(attrs.has("data-camera-open")).toBe(true);
    expect(colours()).toEqual([CAMERA_THEME_COLOR, CAMERA_THEME_COLOR]);
    close();
    close();
    expect(isCameraOpen()).toBe(false);
    expect(attrs.has("data-camera-open")).toBe(false);
    expect(colours()).toEqual(["#f6f7f8", "#f6f7f8"]);
  });
  it("two holds give it back only when the last closes; a theme switched meanwhile keeps its colour", () => {
    reset("#f6f7f8");
    const a = holdCameraOpen();
    const b = holdCameraOpen();
    a();
    expect(colours()[0]).toBe(CAMERA_THEME_COLOR);
    reset("#0d0d0f");
    b();
    expect(colours()).toEqual(["#0d0d0f", "#0d0d0f"]);
  });
  it("over Crew's paged feed the status bar stays the feed's black", () => {
    reset("#f6f7f8");
    const close = holdCameraOpen();
    classes.add("feed-paging");
    close();
    classes.delete("feed-paging");
    expect(colours()[0]).toBe(CAMERA_THEME_COLOR);
  });
});
