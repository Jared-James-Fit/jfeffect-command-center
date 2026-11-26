import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BACK_EDGE_PX,
  attributeOwns,
  createGestureArena,
  edgeBelongsToBrowser,
  isBackEdge,
  ownerOf,
  touchActionOwns,
  type OwnerNode,
} from "@/lib/gesture-arena";

const src = (p: string) => readFileSync(p, "utf8");

/** A stand-in element: its data-gesture, whether it matches the built-in owners, its touch-action. */
function node(opts: { gesture?: string; builtIn?: boolean; touch?: string; tag?: string } = {}, parent: OwnerNode | null = null) {
  const n = {
    tagName: opts.tag ?? "DIV",
    parentElement: parent,
    touch: opts.touch ?? "auto",
    getAttribute: (name: string) => (name === "data-gesture" ? (opts.gesture ?? null) : null),
    matches: () => !!opts.builtIn,
  };
  return n as unknown as OwnerNode & { touch: string };
}
const touchOf = (el: OwnerNode) => (el as unknown as { touch: string }).touch;

describe("who owns a drag", () => {
  it("reads touch-action the way the browser does", () => {
    expect(touchActionOwns("none", "x")).toBe(true);
    expect(touchActionOwns("none", "y")).toBe(true);
    // the 3D body at full size, a scrub bar, a swipe row: sideways is theirs, up and down the page's
    expect(touchActionOwns("pan-y", "x")).toBe(true);
    expect(touchActionOwns("pan-y", "y")).toBe(false);
    expect(touchActionOwns("pan-y pinch-zoom", "x")).toBe(true);
    expect(touchActionOwns("pan-x", "y")).toBe(true);
    // nothing kept from the browser: never an owner
    for (const v of ["auto", "manipulation", "pan-x pan-y", "", null, undefined]) {
      expect(touchActionOwns(v, "x")).toBe(false);
      expect(touchActionOwns(v, "y")).toBe(false);
    }
  });

  it("reads data-gesture", () => {
    expect(attributeOwns("x", "x")).toBe(true);
    expect(attributeOwns("x y", "y")).toBe(true);
    expect(attributeOwns("x", "y")).toBe(null);
    expect(attributeOwns(null, "x")).toBe(null);
  });

  it("finds the nearest owner from the finger up, and never the page itself", () => {
    const body = node({ tag: "BODY", touch: "none" });
    const page = node({ touch: "pan-x pan-y" }, body);
    const model = node({ gesture: "x" }, page);
    const canvas = node({}, model);
    expect(ownerOf(canvas, "x", { touchAction: touchOf })).toBe(model);
    // the body at full size lets up and down go to the page
    expect(ownerOf(canvas, "y", { touchAction: touchOf })).toBe(null);
    // a plain part of the page: nobody owns it, the back swipe may start there
    const text = node({}, page);
    expect(ownerOf(text, "x", { touchAction: touchOf })).toBe(null);
    // touch-action alone makes an owner (a story viewer, a map, a drawing pad)
    const pad = node({ touch: "none" }, page);
    expect(ownerOf(node({}, pad), "y", { touchAction: touchOf })).toBe(pad);
    // a slider, a chart, a scrub bar
    const slider = node({ builtIn: true }, page);
    expect(ownerOf(slider, "x", { touchAction: touchOf })).toBe(slider);
    // a parent gesture's own root (and what's above it) never counts
    const sheet = node({ touch: "none" }, body);
    expect(ownerOf(node({}, sheet), "y", { touchAction: touchOf, stop: sheet })).toBe(null);
  });
});

describe("the back edge", () => {
  it("is the browser's in iPhone Safari's own tab, the app's everywhere else", () => {
    expect(edgeBelongsToBrowser({ standalone: false })).toBe(true);
    expect(edgeBelongsToBrowser({ standalone: true })).toBe(false);
    expect(edgeBelongsToBrowser({})).toBe(false);
    // the home-screen app and the phone apps: a swipe from the edge is an intentional back swipe
    expect(isBackEdge(BACK_EDGE_PX - 1, { standalone: true })).toBe(true);
    expect(isBackEdge(8, {})).toBe(true);
    expect(isBackEdge(BACK_EDGE_PX, { standalone: true })).toBe(false);
    expect(isBackEdge(8, { standalone: false })).toBe(false);
  });
});

describe("one holder at a time, always let go", () => {
  it("lets one gesture hold the finger and refuses the rest", () => {
    const a = createGestureArena();
    expect(a.claim("body3d")).toBe(true);
    expect(a.claim("body3d")).toBe(true);
    expect(a.claim("swipe-back")).toBe(false);
    expect(a.heldByOther("swipe-back")).toBe(true);
    expect(a.heldByOther("body3d")).toBe(false);
    // only the holder can let go
    a.release("swipe-back");
    expect(a.holder()).toBe("body3d");
    a.release("body3d");
    expect(a.holder()).toBe(null);
    expect(a.claim("swipe-back")).toBe(true);
  });

  it("lets go once the last finger lifts, even when nobody released", () => {
    const a = createGestureArena();
    a.down(1);
    a.down(2);
    a.claim("body3d");
    a.up(1);
    expect(a.holder()).toBe("body3d");
    a.up(2);
    expect(a.holder()).toBe(null);
    a.down(3);
    a.claim("sheet-drag");
    a.allUp();
    expect(a.holder()).toBe(null);
    expect(a.fingersDown()).toBe(0);
  });

  it("tells everyone to put things back when the app goes away mid-gesture", () => {
    const a = createGestureArena();
    let resets = 0;
    const stop = a.onReset(() => resets++);
    a.down(1);
    a.claim("swipe-back");
    a.reset();
    expect(resets).toBe(1);
    expect(a.holder()).toBe(null);
    stop();
    a.reset();
    expect(resets).toBe(1);
  });
});

describe("every screen gesture follows the one rule", () => {
  it("swipe back: never over an owner, never while something holds the finger, never left half-way", () => {
    const s = src("src/components/swipe-back.tsx");
    expect(s).toContain('return targetOwns(el, "x");');
    expect(s).toContain("if (e.defaultPrevented || heldByOther(ARENA_ID))");
    expect(s).toContain("claimGesture(ARENA_ID)");
    expect(s).toContain("releaseGesture(ARENA_ID)");
    // a lost touchend or the app hidden puts the page back
    expect(s).toContain('if (mode === "back") abort(0);');
    expect(s).toContain("onGestureReset(() => abort(0))");
    // the edge: an intentional back swipe where it's the app's, the browser's in Safari's tab
    expect(s).toContain("if (!isBackEdge(t.clientX) || typingOrDialog(e.target)) return;");
    // a full-screen page that closes is never slid back in
    expect(s).toContain("if (cb.current.closes) {");
    expect(src("src/components/full-screen-page.tsx")).toContain("<SwipeBack enabled closes target={layer}");
  });

  it("the 3D body owns sideways drags, gives up and down to the page until zoomed, and a cancel never picks", () => {
    const s = src("src/components/analytics/muscle-map.tsx");
    expect(s).toContain('data-gesture={preview ? undefined : zoomed ? "x y" : "x"}');
    expect(s).toContain('preview ? "pointer-events-none" : zoomed ? "touch-none" : "touch-pan-y"');
    expect(s).toContain("onPointerCancel={preview ? undefined : onCancel}");
    expect(s).toContain("onLostPointerCapture={preview ? undefined : onCancel}");
    expect(s).toContain('if (e.pointerType !== "mouse" && isBackEdge(e.clientX)) return;');
    expect(s).toContain("if (!claimGesture(arenaId)) return;");
    expect(s).toContain("if (heldByOther(arenaId)) return endGesture();");
    // the cancel path ends the gesture with no pick
    const cancel = s.slice(s.indexOf("const onCancel = "), s.indexOf("const onCancel = ") + 200);
    expect(cancel).not.toContain("onPick");
  });

  it("pull to refresh, the sheet swipe and the Crew camera swipe ask the same rule", () => {
    expect(src("src/lib/tab-refresh.ts")).toContain('if (targetOwns(el, "y")) return false;');
    expect(src("src/components/tab-refresh.tsx")).toContain("if (!pulling && gestureHolder()) return;");
    const sheet = src("src/hooks/use-swipe-down-to-close.ts");
    expect(sheet).toContain('targetOwns(t, "y", el)');
    expect(sheet).toContain("claimGesture(ARENA_ID)");
    const create = src("src/components/community/swipe-to-create.tsx");
    expect(create).toContain('if (targetOwns(target, "x")) return;');
    expect(create).toContain('claimGesture("crew-create")');
    expect(src("src/components/workouts/calendar-day-dnd.tsx")).toContain("claimGesture(ARENA_ID)");
  });
});
