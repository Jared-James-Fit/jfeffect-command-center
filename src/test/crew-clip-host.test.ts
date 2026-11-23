/**
 * A feed clip is always in the box it's shown in (Nov 23 2026). Jarrett's
 * 9:16 deadlift went black on its screen: InlineVideo has a box per fit
 * (filling the screen, shown whole, framed), its fit is decided again whenever
 * the screen's shape is measured (a first layout before the box has a size, a
 * post's sheet opening), and the pooled video element was put in a box only
 * when it was borrowed. Swapping the box left the element playing off the
 * page with its poster already faded: black. Reproduced in Chromium on the
 * real feed (the fit flipped and back; a 16:9 clip's comments opened and
 * closed), and gone with this.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keepInHost } from "@/lib/video-pool";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** Just enough of a DOM box to see where things land. */
class Box {
  children: Node[] = [];
  get firstChild() {
    return this.children[0] ?? null;
  }
  insertBefore(n: Node, ref: Node | null) {
    n.parentNode?.remove(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    n.parentNode = this;
  }
  appendChild(n: Node) {
    n.parentNode?.remove(n);
    this.children.push(n);
    n.parentNode = this;
  }
  remove(n: Node) {
    this.children = this.children.filter((c) => c !== n);
    n.parentNode = null;
  }
}
class Node {
  parentNode: Box | null = null;
  constructor(public name: string) {}
}

describe("a clip follows its box (keepInHost)", () => {
  it("moves the element out of a box that was swapped away into the one on the page", () => {
    const old = new Box();
    const now = new Box();
    const video = new Node("video");
    old.appendChild(video);
    expect(keepInHost(now, video)).toBe(true);
    expect(now.children).toEqual([video]);
    expect(old.children).toEqual([]);
  });

  it("keeps the element first and its decoded canvas over it", () => {
    const old = new Box();
    const now = new Box();
    const video = new Node("video");
    const canvas = new Node("canvas");
    old.appendChild(video);
    old.appendChild(canvas);
    keepInHost(now, video, canvas);
    expect(now.children.map((c) => c.name)).toEqual(["video", "canvas"]);
  });

  it("does nothing when it's already there, or when there's no box or no element yet", () => {
    const box = new Box();
    const video = new Node("video");
    box.appendChild(video);
    expect(keepInHost(box, video, null)).toBe(false);
    expect(box.children).toEqual([video]);
    expect(keepInHost(null, video)).toBe(false);
    expect(keepInHost(box, null)).toBe(false);
  });
});

describe("InlineVideo keeps its element in its box, and its poster until it plays", () => {
  const src = read("src/components/community/inline-video.tsx");

  it("checks after every render (a layout effect with no dependencies), so any swap of the box is caught in the same commit", () => {
    expect(src).toMatch(
      /useLayoutEffect\(\(\) => \{\s*keepInHost\(host\.current, el, canvasRef\.current\);\s*\}\);/,
    );
  });

  it("a play-and-pause from a tap elsewhere never fades the poster away from a clip that isn't playing", () => {
    expect(src).toMatch(
      /"playing",\s*\(\) => \{[\s\S]{0,300}?if \(v\.paused\) return;\s*setPlaying\(true\);/,
    );
  });

  it("a clip that failed is tried again with a fresh link", () => {
    expect(src).toMatch(/setFailed\(false\);\s*\};\s*\}, \[holding, url\]\);/);
  });
});
