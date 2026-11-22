/**
 * The Technique panel shows what the body's read can stand behind: angle
 * layers switched off (and saying why) for a camera that isn't side-on, the
 * patterns worth a look with a moment to jump to, each rep's numbers, the
 * notes on the video, and the drawing tools with both ways to keep a note.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { TechniqueRead } from "@/lib/lift-analysis/pose/technique";
import type { FilmNote } from "@/lib/lift-analysis/film-notes";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "coach-1" }, role: "admin" }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { TechniquePanel } = await import("@/components/lift-analysis/technique-panel");
const { DEFAULT_LAYERS } = await import("@/components/lift-analysis/overlay-draw");

const analysis = {
  units: "mm",
  window: { start: 0, end: 6 },
  reps: [
    { n: 1, dir: "lower_first", con: { start: 1.6, end: 2.6 }, ecc: { start: 0.6, end: 1.6 } },
    { n: 2, dir: "lower_first", con: { start: 4.2, end: 5.2 }, ecc: { start: 3.2, end: 4.2 } },
  ],
  series: { t: [], x: [], y: [], v: [], ok: [] },
} as unknown as LiftAnalysis;

function read(over: Partial<TechniqueRead> = {}): TechniqueRead {
  return {
    lift: "squat",
    view: "side",
    side: "left",
    facing: 1,
    coverage: 0.97,
    angles: true,
    rows: [{ key: "depth", label: "Depth (thigh)", unit: "°", hint: "A guide." }],
    reps: [
      { n: 1, at: { start: 0.6, turn: 1.6, end: 2.6 }, m: { depth: 5.2 } },
      { n: 2, at: { start: 3.2, turn: 4.2, end: 5.2 }, m: { depth: -3.1 } },
    ],
    observations: [
      {
        id: "depth-change",
        text: "Depth changed about 8° from rep 1 to rep 2 (higher).",
        t: 4.2,
        rep: 2,
      },
    ],
    limits: [],
    ...over,
  };
}

function render(props: Record<string, unknown>) {
  const qc = new QueryClient();
  const tech = {
    status: "done",
    progress: null,
    failure: "",
    track: { frame: { w: 1080, h: 1920 }, t: [0], frames: [null] },
    read: read(),
    layers: DEFAULT_LAYERS,
    setLayers: () => {},
    compare: null,
    setCompare: () => {},
    scene: null,
    start: () => {},
    cancel: () => {},
    ...(props.tech as object),
  };
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(TechniquePanel as never, {
        analysis,
        setVideoId: "sv-1",
        src: "https://example.test/v.mp4",
        exerciseName: "Competition Squat",
        selected: null,
        onSelectRep: () => {},
        onJump: () => {},
        api: { current: null },
        notes: [],
        focusNote: null,
        onFocusNote: () => {},
        noteDraft: { draft: null, setDraft: () => {}, tool: "arrow", setTool: () => {}, begin: () => {}, draw: null, end: () => {} },
        onNeedBar: () => {},
        ...props,
        tech,
      }),
    ),
  );
}

describe("the Technique panel", () => {
  it("lists the overlays, the patterns worth a look and each rep's numbers from a side view", () => {
    const html = render({});
    expect(html).toContain('data-layer="skeleton"');
    expect(html).toContain('data-layer="angles"');
    expect(html).toContain("Worth a look");
    expect(html).toContain("Depth changed about 8°");
    expect(html).toContain(">Show<");
    expect(html).toContain("Depth (thigh)");
    expect(html).toContain("5°");
    expect(html).toContain("-3°");
    expect(html).toContain('data-technique-view="side"');
    expect(html).not.toMatch(/dangerous|injur|incorrect/i);
  });

  it("switches the angle layers off for a front view and says a side view reads them", () => {
    const html = render({
      tech: { read: read({ view: "front", side: null, angles: false, rows: [], observations: [] }) },
    });
    expect(html).toMatch(/data-layer="angles"[^>]*disabled|disabled[^>]*data-layer="angles"/);
    expect(html).toContain("Joint angles need a side view.");
  });

  it("shows how far the body read has got, in real progress", () => {
    const html = render({
      tech: { status: "running", read: null, track: null, progress: { stage: "model", progress: 0.42 } },
    });
    expect(html).toContain("Loading the body model (first time only)");
    expect(html).toContain("42%");
    expect(html).toContain("The video isn&#x27;t uploaded anywhere.");
  });

  it("lists the notes on the video with their moments", () => {
    const note: FilmNote = {
      id: "n1",
      set_video_id: "sv-1",
      client_id: "c1",
      author_id: "coach-1",
      t: 4.25,
      shapes: [{ kind: "joint", j: 25 }],
      body: "Knees drift in here",
      layers: {},
      message_id: "m1",
      hidden_at: null,
      created_at: "",
      updated_at: "",
    };
    const html = render({ notes: [note] });
    expect(html).toContain("0:04.3");
    expect(html).toContain("Knees drift in here");
    expect(html).toContain("· sent");
  });

  it("draws a note with lines, arrows, circles or a joint, and keeps it or sends it in the chat", () => {
    const html = render({
      noteDraft: {
        draft: { id: null, t: 2, shapes: [], body: "" },
        setDraft: () => {},
        tool: "arrow",
        setTool: () => {},
        begin: () => {},
        draw: null,
        end: () => {},
      },
    });
    expect(html).toContain("data-draw-tools");
    for (const t of ["Arrow", "Line", "Circle", "Joint"]) expect(html).toContain(t);
    expect(html).toContain("Save on video");
    expect(html).toContain("Send in chat");
  });
});
