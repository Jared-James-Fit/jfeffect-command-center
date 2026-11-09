import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { PoseFigure, PoseGuideContent } from "@/components/progress/pose-guide";
import { PHOTO_SETUP, POSE_CUES, POSE_ORDER, VIDEO_STEPS } from "@/lib/progress-pose-guide";

// Nov 9 2026: the progress photo tiles were a camera icon and "Tap to add
// photo", with nothing on how to take them, so every check-in was shot a
// different way. Each pose now shows how to stand, and "How to take them"
// opens the setup that keeps them comparable.
describe("progress photos show how to take each pose", () => {
  it("each pose has a figure and a cue, in the order the tiles go", () => {
    expect(POSE_ORDER).toEqual(["front", "left", "back", "right"]);
    for (const a of POSE_ORDER) {
      expect(POSE_CUES[a].length).toBeLessThanOrEqual(48);
      const svg = renderToStaticMarkup(h(PoseFigure, { angle: a }));
      expect(svg).toContain(`data-pose-figure="${a}"`);
    }
    // the right side is the left side mirrored
    expect(renderToStaticMarkup(h(PoseFigure, { angle: "right" }))).toContain("scale(-1,1)");
    expect(renderToStaticMarkup(h(PoseFigure, { angle: "left" }))).not.toContain("scale(-1,1)");
  });

  it("the setup covers time, light, phone height and distance, framing, clothes and stance", () => {
    const text = PHOTO_SETUP.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
    for (const w of ["morning", "light", "belly-button height", "6 to 8 feet", "head to feet", "same thing every time", "don't flex"]) {
      expect(text, w).toContain(w);
    }
  });

  it("the guide draws the setup and the framing, and only a video's adds the turn", () => {
    const photo = renderToStaticMarkup(h(PoseGuideContent, { kind: "photo" }));
    const video = renderToStaticMarkup(h(PoseGuideContent, { kind: "video" }));
    expect(photo).toContain("data-setup-diagram");
    expect(photo).toContain("data-framing-diagram");
    for (const a of POSE_ORDER) expect(photo).toContain(`data-pose-demo="${a}"`);
    expect(photo).not.toContain("Single video");
    expect(video).toContain("Single video");
    expect(video).toContain(VIDEO_STEPS[2].replace(/'/g, "&#x27;"));
  });

  it("the photo and video dialogs open it, and empty tiles show the pose, not a bare camera", () => {
    const src = readFileSync("src/components/progress/progress-section.tsx", "utf8");
    expect(src).toContain('<PoseGuideButton kind="photo" />');
    expect(src).toContain('<PoseGuideButton kind="video" />');
    expect(src).toContain('<PoseFigure angle={angle} className="h-[46%]" />');
    expect(src).toContain("{angle === \"all\" ? SINGLE_VIDEO_CUE : POSE_CUES[angle]}");
    expect(src).not.toContain("Tap to {mediaType === \"video\" ? \"record\" : \"add photo\"}");
    expect(src).not.toContain("Tap a tile to add a photo — or upload all four at once.");
  });
});
