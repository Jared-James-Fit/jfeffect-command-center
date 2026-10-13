import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_ZOOM, clampCrop, coverScale, cropRect, zoomAt } from "@/lib/avatar-crop";

const read = (p: string) => readFileSync(p, "utf8");
const portrait = { w: 3000, h: 4000 }; // an iPhone photo
const frame = 400;

describe("profile photo crop (Instagram-style move and scale)", () => {
  it("starts centred with the short side just filling the frame", () => {
    expect(coverScale(portrait, frame)).toBeCloseTo(400 / 3000);
    expect(cropRect({ zoom: 1, x: 0, y: 0 }, portrait, frame)).toEqual({ sx: 0, sy: 500, size: 3000 });
  });

  it("can't be dragged or zoomed out past the edge (never empty corners)", () => {
    // at zoom 1 a portrait only moves up and down
    expect(clampCrop({ zoom: 1, x: 120, y: 9999 }, portrait, frame)).toEqual({ zoom: 1, x: 0, y: (4000 * (400 / 3000) - 400) / 2 });
    expect(clampCrop({ zoom: 0.3, x: 0, y: 0 }, portrait, frame).zoom).toBe(1);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, portrait, frame).zoom).toBe(MAX_ZOOM);
    // whatever the gesture, the crop stays inside the photo
    for (const c of [{ zoom: 1, x: 500, y: -500 }, { zoom: 3.3, x: -9999, y: 9999 }, { zoom: 5, x: 1e6, y: 1e6 }]) {
      const r = cropRect(clampCrop(c, portrait, frame), portrait, frame);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.size).toBeLessThanOrEqual(portrait.w + 1e-6);
      expect(r.sy + r.size).toBeLessThanOrEqual(portrait.h + 1e-6);
    }
  });

  it("zooming keeps the point under your fingers in place", () => {
    const at = { x: 50, y: -40 };
    const before = { zoom: 1, x: 0, y: 0 };
    const after = zoomAt(before, 2, at, portrait, frame);
    expect(after.zoom).toBe(2);
    // the photo point under `at` maps to the same screen spot before and after
    const photoPoint = (c: typeof before) => ({ x: (at.x - c.x) / c.zoom, y: (at.y - c.y) / c.zoom });
    expect(photoPoint(after).x).toBeCloseTo(photoPoint(before).x);
    expect(photoPoint(after).y).toBeCloseTo(photoPoint(before).y);
  });

  it("zoom 2× at the centre crops the middle half of the short side", () => {
    expect(cropRect({ zoom: 2, x: 0, y: 0 }, portrait, frame)).toEqual({ sx: 750, sy: 1250, size: 1500 });
  });

  it("every profile photo goes through it: account / ID photo and Crew photo", () => {
    const capture = read("src/components/profile-picture-capture.tsx");
    expect(capture).toContain("<AvatarCropper src={raw} open={cropping}");
    expect(capture).toContain("startCrop(canvas.toDataURL(");
    expect(capture).toContain("startCrop(track(URL.createObjectURL(file)))");
    expect(capture).toContain("Adjust");
    expect(capture).toContain("compressImage(previewBlob");
    const crew = read("src/components/community/profile-view.tsx");
    expect(crew).toContain("<AvatarCropper");
    expect(crew).toContain("setCropSrc(URL.createObjectURL(f))");
  });

  it("the cropper: pinch, drag, wheel and a slider; the circle shows what people see", () => {
    const ui = read("src/components/avatar-cropper.tsx");
    expect(ui).toContain("touch-none");
    expect(ui).toContain('addEventListener("wheel", onWheel, { passive: false })');
    expect(ui).toContain('type="range"');
    expect(ui).toContain("rounded-full ring-1 ring-white/70");
    expect(ui).toContain("Move and scale");
  });
});
