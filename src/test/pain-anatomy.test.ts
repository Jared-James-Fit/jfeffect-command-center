import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAIN_SITES, SITE_KEYS, searchSites, siteAnatomy, siteLabel, siteOf, siteSided, sitesIn } from "@/lib/pain/sites";
import { REGION_KEYS } from "@/lib/pain/regions";
import { atlasView, hasDeep, layerParts, partAt, regionBox, sitesOnView, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { VIEW_H, VIEW_W, inside, parsePoints, smoothPath } from "@/lib/pain/anatomy/geometry";
import { DETAIL_SCALE, IDENTITY, MAX_SCALE, clampXf, fitView, frameBox, labelHeight, layoutCallouts, toDrawing, toScreen, wrapLines, zoomAt } from "@/lib/pain/anatomy/stage";
import { cleanReports, legacyColumns, placeLabel, reportLine, scoreWord, severityFromScore, type PainReportInput } from "@/lib/pain/report";
import { addPick, newPick, picksFromEntries, picksToReports, scorePatch, unrated, updatePick } from "@/lib/pain/picks";
import { needsSafetyNotice, redFlags } from "@/lib/pain/safety";
import { buildPainHistory, followUpFor, type PainEntry } from "@/lib/pain/history";
import { PAIN_DRAFT_MS, forgetPainDraft, keepPainDraft, painDraftKey, readPainDraft } from "@/lib/pain/pain-draft";

const VIEWS: { key: ViewKey; facing: "R" | "L" }[] = [
  { key: "front", facing: "R" },
  { key: "back", facing: "R" },
  { key: "side", facing: "R" },
  { key: "side", facing: "L" },
];

describe("the spots on the body map", () => {
  it("each spot has its own key, a known region and a plain name", () => {
    expect(SITE_KEYS.size).toBe(PAIN_SITES.length);
    for (const s of PAIN_SITES) {
      expect(REGION_KEYS).toContain(s.region);
      expect(s.key).toMatch(/^[a-z0-9_]{1,40}$/); // the database's own check
      expect(s.label.length).toBeGreaterThan(2);
      expect(s.label[0]).toBe(s.label[0].toUpperCase());
    }
    // every region but "somewhere else" and "whole body" (a general symptom has no place) has spots to pick
    for (const r of REGION_KEYS.filter((k) => k !== "other" && k !== "general")) expect(sitesIn(r).length).toBeGreaterThan(0);
    // a group covers only spots that exist, in its own region
    for (const s of PAIN_SITES.filter((x) => x.covers)) for (const c of s.covers!) expect(siteOf(c)?.region).toBe(s.region);
  });

  it("names a spot the way a person says it, side first, and keeps the anatomical name apart", () => {
    expect(siteLabel("side_delt", "L")).toBe("Left side delt");
    expect(siteLabel("patellar_tendon", "R")).toMatch(/^Right /);
    expect(siteAnatomy("side_delt")).toMatch(/lateral deltoid/i);
    // a spot on the midline never takes a side
    const mid = PAIN_SITES.find((s) => s.midline)!;
    expect(siteSided(mid.key, mid.region)).toBe(false);
    expect(siteLabel(mid.key, "L")).toBe(mid.label);
    expect(siteSided("side_delt", "shoulder")).toBe(true);
    expect(siteSided(null, "low_back")).toBe(false);
  });

  it("the list's search finds spots by their plain name, their anatomical name or another name", () => {
    expect(searchSites("side delt")[0]?.key).toBe("side_delt");
    expect(searchSites("lateral deltoid").map((s) => s.key)).toContain("side_delt");
    expect(searchSites("patellar").map((s) => s.key)).toContain("patellar_tendon");
    expect(searchSites("achilles")[0]?.key).toBe("achilles");
    expect(searchSites("").length).toBe(PAIN_SITES.length);
    expect(searchSites("zzzz")).toEqual([]);
  });
});

describe("the drawing", () => {
  it("draws every spot somewhere, and only spots it knows", () => {
    const drawn = new Set<string>();
    for (const v of VIEWS) for (const s of sitesOnView(atlasView(v.key, v.facing))) drawn.add(s);
    // a group ("Fingers", "Bottom of foot") is drawn through the spots it covers
    expect(PAIN_SITES.filter((s) => !drawn.has(s.key) && !(s.covers ?? []).some((c) => drawn.has(c))).map((s) => s.key)).toEqual([]);
    expect([...drawn].filter((k) => !SITE_KEYS.has(k))).toEqual([]);
  });

  it("puts the athlete's right on the screen's left from the front, and on the right from the back", () => {
    const front = atlasView("front").parts.filter((p) => p.site === "side_delt");
    expect(front.find((p) => p.side === "R")!.center[0]).toBeLessThan(VIEW_W / 2);
    expect(front.find((p) => p.side === "L")!.center[0]).toBeGreaterThan(VIEW_W / 2);
    const back = atlasView("back").parts.filter((p) => p.site === "rear_delt");
    expect(back.find((p) => p.side === "L")!.center[0]).toBeLessThan(VIEW_W / 2);
    expect(back.find((p) => p.side === "R")!.center[0]).toBeGreaterThan(VIEW_W / 2);
    // the side view shows one side at a time
    const right = atlasView("side", "R").parts.filter((p) => p.site && siteSided(p.site, p.region ?? ""));
    const left = atlasView("side", "L").parts.filter((p) => p.site && siteSided(p.site, p.region ?? ""));
    expect(new Set(right.map((p) => p.side))).toEqual(new Set(["R"]));
    expect(new Set(left.map((p) => p.side))).toEqual(new Set(["L"]));
  });

  it("a paired spot has a part on each side, and a midline one has no side", () => {
    const front = atlasView("front");
    for (const p of front.parts.filter((x) => x.site)) {
      const s = siteOf(p.site)!;
      if (s.midline) expect(p.side).toBeNull();
      else if (siteSided(s.key, s.region)) expect(front.parts.some((q) => q.site === p.site && q.side === (p.side === "L" ? "R" : "L"))).toBe(true);
    }
    expect(new Set(front.parts.map((p) => p.id)).size).toBe(front.parts.length);
  });

  it("every part sits inside the drawing, and a tap lands on what's under it", () => {
    for (const v of VIEWS) {
      const view = atlasView(v.key, v.facing);
      for (const p of view.parts) {
        expect(p.box.x).toBeGreaterThanOrEqual(0);
        expect(p.box.y).toBeGreaterThanOrEqual(0);
        expect(p.box.x + p.box.w).toBeLessThanOrEqual(VIEW_W);
        expect(p.box.y + p.box.h).toBeLessThanOrEqual(VIEW_H);
      }
    }
    const front = atlasView("front");
    const delt = front.parts.find((p) => p.site === "side_delt" && p.side === "R")!;
    const hit = partAt(layerParts(front, false), delt.center);
    expect(hit?.site).toBeTruthy();
    expect(hit?.region).toBe("shoulder");
    // a tap just off the body finds nothing, unless it's close enough to a part
    expect(partAt(layerParts(front, false), [2, 900])).toBeNull();
  });

  it("the deeper layer holds the deeper structures, and only where there are some", () => {
    const back = atlasView("back");
    expect(hasDeep(back)).toBe(true);
    const deep = back.parts.filter((p) => p.deep).map((p) => p.site);
    expect(deep).toContain("supraspinatus");
    expect(deep.every((k) => siteOf(k)?.deep)).toBe(true);
    expect(layerParts(back, false).some((p) => p.deep)).toBe(false);
  });

  it("frames a region on one side", () => {
    const front = atlasView("front");
    const r = regionBox(front, "shoulder", "R")!;
    const l = regionBox(front, "shoulder", "L")!;
    expect(r.x + r.w / 2).toBeLessThan(VIEW_W / 2);
    expect(l.x + l.w / 2).toBeGreaterThan(VIEW_W / 2);
    expect(regionBox(front, "nowhere", null)).toBeNull();
  });

  it("reads shapes as smooth closed paths", () => {
    const { pts, corners } = parsePoints("10,10 20,10! 20,20 10,20");
    expect(pts).toHaveLength(4);
    expect(corners.has(1)).toBe(true);
    expect(smoothPath(pts, corners)).toMatch(/^M.*Z$/);
    expect(inside([15, 15], pts)).toBe(true);
    expect(inside([25, 15], pts)).toBe(false);
  });
});

describe("the stage", () => {
  const size = { w: 390, h: 640 };
  const fit = fitView(size);

  it("fits the drawing and maps between the screen and the drawing both ways", () => {
    expect(fit.k * VIEW_H).toBeLessThanOrEqual(size.h);
    expect(fit.k * VIEW_W).toBeLessThanOrEqual(size.w);
    const xf = { s: 2.5, tx: -120, ty: -300 };
    const [sx, sy] = toScreen([137, 412], fit, xf);
    const [dx, dy] = toDrawing(sx, sy, fit, xf);
    expect(dx).toBeCloseTo(137, 6);
    expect(dy).toBeCloseTo(412, 6);
  });

  it("zooms a region into the room the sheet leaves, past the point where taps pick a spot", () => {
    const box = regionBox(atlasView("front"), "shoulder", "R")!;
    const vis = { top: 0, bottom: 220 };
    const xf = frameBox(box, size, fit, vis);
    expect(xf.s).toBeGreaterThanOrEqual(DETAIL_SCALE);
    expect(xf.s).toBeLessThanOrEqual(MAX_SCALE);
    const [cx, cy] = toScreen([box.x + box.w / 2, box.y + box.h / 2], fit, xf);
    expect(Math.abs(cx - size.w / 2)).toBeLessThan(size.w * 0.3);
    expect(cy).toBeLessThan(size.h - vis.bottom);
  });

  it("a pinch keeps the point between the fingers still, and never zooms out past the whole body", () => {
    const at: [number, number] = [200, 300];
    const before = toDrawing(at[0], at[1], fit, IDENTITY);
    const z = zoomAt(IDENTITY, 3, at);
    const after = toDrawing(at[0], at[1], fit, z);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(zoomAt(z, 0.2, at).s).toBe(1);
    expect(zoomAt(z, 99, at).s).toBe(MAX_SCALE);
    expect(clampXf({ s: 1, tx: 50, ty: 50 }, size, fit)).toEqual(IDENTITY);
  });

  it("never pans the body off the screen", () => {
    const far = clampXf({ s: 3, tx: 5000, ty: -9000 }, size, fit);
    const [lx] = toScreen([0, 0], fit, far);
    const [, by] = toScreen([0, VIEW_H], fit, far);
    expect(lx).toBeLessThanOrEqual(size.w / 2 + 0.5);
    expect(by).toBeGreaterThanOrEqual(size.h / 2 - 0.5);
  });

  it("lays labels out in two columns that never overlap", () => {
    const anchors = Array.from({ length: 14 }, (_, i) => ({ id: `a${i}`, x: i % 2 ? 260 : 120, y: 200 + (i % 5) * 6 }));
    const out = layoutCallouts(anchors, size, { labelW: 110, labelH: 30, top: 60, bottom: 200 });
    expect(out.length).toBeGreaterThan(0);
    for (const side of ["l", "r"] as const) {
      const col = out.filter((c) => c.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + 30);
      for (const c of col) {
        expect(c.y).toBeGreaterThanOrEqual(60);
        expect(c.y + 30).toBeLessThanOrEqual(size.h - 200);
      }
    }
  });

  it("gives a long name the lines it needs instead of cutting it off", () => {
    // a stub font: 7px a character
    const m = (t: string) => t.length * 7;
    expect(wrapLines("Side delt", 110, m)).toBe(1);
    expect(wrapLines("Above the kneecap", 110, m)).toBe(2);
    expect(wrapLines("High hamstring, near the sit bone", 110, m)).toBe(3);
    // the "R" tag takes room on the first line only
    expect(wrapLines("Inside of knee", 100, m)).toBe(1);
    expect(wrapLines("Inside of knee", 100, m, 14)).toBe(2);
    // one word too wide for a line breaks inside itself
    expect(wrapLines("Sternocleidomastoid", 70, m)).toBe(2);
    // the anatomical name goes when the plain name needs every line
    expect(labelHeight(1, true)).toEqual({ h: 40, lines: 1, anat: true });
    expect(labelHeight(2, true)).toEqual({ h: 53, lines: 2, anat: true });
    expect(labelHeight(5, true)).toEqual({ h: 55, lines: 3, anat: false });
  });

  it("stacks labels of different heights without overlap, inside the room", () => {
    const hs = [40, 53, 40, 55, 53, 40];
    const anchors = hs.map((h, i) => ({ id: `a${i}`, x: 120, y: 120 + i * 8, h }));
    const out = layoutCallouts(anchors, size, { labelW: 110, labelH: 40, top: 52, bottom: 12 });
    const col = out.filter((c) => c.side === "l").sort((a, b) => a.y - b.y);
    expect(out.length).toBeGreaterThan(2);
    for (const c of out) {
      expect(c.h).toBe(hs[Number(c.id.slice(1))]);
      expect(c.y).toBeGreaterThanOrEqual(52);
      expect(c.y + c.h).toBeLessThanOrEqual(size.h - 12);
    }
    for (let i = 1; i < col.length; i++) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + col[i - 1].h + 6);
  });
});

describe("rating a spot", () => {
  it("0–10 maps onto the three severities every reader already uses", () => {
    expect([0, 3, 4, 6, 7, 10].map(severityFromScore)).toEqual(["mild", "mild", "moderate", "moderate", "severe", "severe"]);
    expect(scoreWord(8)).toBeTruthy();
    expect(scoreWord(null)).toBeNull();
  });

  it("a tap on the body adds a spot and never takes one away", () => {
    let picks = addPick([], { region: "shoulder", side: "R", site: "side_delt" }).picks;
    const again = addPick(picks, { region: "shoulder", side: "R", site: "side_delt" });
    expect(again.picks).toHaveLength(1);
    expect(again.uid).toBe(picks[0].uid);
    picks = addPick(picks, { region: "shoulder", side: "R", site: "front_delt" }).picks;
    picks = addPick(picks, { region: "shoulder", side: "L", site: "side_delt" }).picks;
    expect(picks).toHaveLength(3);
    expect(picks.every(unrated)).toBe(true);
    picks = updatePick(picks, picks[0].uid, scorePatch(7));
    expect(unrated(picks[0])).toBe(false);
    expect(picks[0].severity).toBe("severe");
  });

  it("each spot is its own report, with when and what exercise, and the review's old columns still read", () => {
    const a = { ...newPick("shoulder", "R", "side_delt"), ...scorePatch(6), timing: ["during" as const], exerciseId: "11111111-1111-1111-1111-111111111111", exerciseName: "Bench Press" };
    const b = { ...newPick("shoulder", "R", "front_delt"), ...scorePatch(2), timing: ["rest" as const] };
    const c = { ...newPick("knee", "L", "patellar_tendon"), ...scorePatch(9), timing: ["after" as const] };
    const reports = cleanReports(picksToReports([a, b, c]));
    expect(reports).toHaveLength(3);
    const bySite = Object.fromEntries(reports.map((r) => [r.site, r]));
    expect(bySite.side_delt.trigger).toBe("exercise");
    expect(bySite.side_delt.exerciseName).toBe("Bench Press");
    expect(bySite.front_delt.trigger).toBe("daily");
    expect(bySite.patellar_tendon.trigger).toBe("training");
    expect(bySite.patellar_tendon.severity).toBe("severe");
    const cols = legacyColumns(reports);
    expect(cols.painLevel).toBe(9);
    expect(cols.painArea).toContain("Shoulder (R)");
    expect(cols.painArea).toContain("Knee (L)");
    expect(placeLabel(bySite.side_delt)).toBe("Right side delt");
    expect(reportLine(bySite.side_delt)).toContain("6/10");
  });

  it("a score of 0 still stores a pain level the review table accepts", () => {
    const r = cleanReports(picksToReports([{ ...newPick("neck", null, "neck_back"), ...scorePatch(0) }]));
    expect(legacyColumns(r).painLevel).toBe(1);
  });

  it("a spot on the midline drops a side that came with it", () => {
    const mid = PAIN_SITES.find((s) => s.midline)!;
    const r = cleanReports([{ region: mid.region, side: "L", site: mid.key, severity: "mild", score: 2 } as PainReportInput]);
    expect(r[0].side).toBeNull();
  });

  it("the safety notice shows for a severe score, numbness or a pop, and chest pain at rest", () => {
    expect(needsSafetyNotice([{ region: "knee", side: "L", severity: null, score: 8 }])).toBe(true);
    expect(needsSafetyNotice([{ region: "knee", side: "L", severity: null, score: 5 }])).toBe(false);
    expect(needsSafetyNotice([{ region: "elbow", side: "R", severity: "mild", score: 2, feel: ["numb"] }])).toBe(true);
    expect(needsSafetyNotice([{ region: "chest", side: "L", severity: "mild", score: 3, timing: ["rest"] }])).toBe(true);
    expect(needsSafetyNotice([{ region: "chest", side: "L", severity: "mild", score: 3, timing: ["during"] }])).toBe(false);
  });
});

function entry(p: Partial<PainEntry> & Pick<PainEntry, "region" | "date">): PainEntry {
  return {
    id: p.id ?? `${p.region}-${p.date}`,
    stored: true,
    at: `${p.date}T18:00:00.000Z`,
    source: "review",
    feedbackId: p.feedbackId ?? `fb-${p.date}`,
    dayId: null,
    side: null,
    site: null,
    score: null,
    timing: [],
    severity: "moderate",
    trigger: null,
    exerciseName: null,
    feel: [],
    impact: null,
    sameIssue: null,
    change: null,
    continuesId: null,
    note: null,
    inferred: false,
    ...p,
  } as PainEntry;
}

describe("what the coach and the AI read", () => {
  it("history keeps the spot, the latest score and when it hurts", () => {
    const entries = [
      entry({ region: "shoulder", side: "R", site: "side_delt", score: 5, timing: ["during"], date: "2026-11-10" }),
      entry({ region: "shoulder", side: "R", site: "side_delt", score: 6, timing: ["during"], date: "2026-11-17" }),
      entry({ region: "shoulder", side: "R", site: "front_delt", score: 3, timing: ["after"], date: "2026-11-03", id: "x2" }),
    ];
    const h = buildPainHistory(entries, "2026-11-21");
    const area = h.areas.find((a) => a.region === "shoulder")!;
    expect(area.latestScore).toBe(6);
    expect(area.sites[0]).toEqual({ site: "side_delt", count: 2 });
    expect(area.timing).toContain("during");
  });

  it("a follow-up asks about the same spot when there is one", () => {
    const entries = [
      entry({ region: "shoulder", side: "R", site: "front_delt", score: 4, date: "2026-11-05", id: "front" }),
      entry({ region: "shoulder", side: "R", site: "side_delt", score: 5, date: "2026-11-12", id: "side" }),
    ];
    expect(followUpFor(entries, "shoulder", "R", { today: "2026-11-21", site: "front_delt" })?.id).toBe("front");
  });

  it("severe pain at rest is a warning sign for the coach", () => {
    const flags = redFlags([entry({ region: "low_back", site: "erectors_low", score: 8, severity: "severe", timing: ["rest"], date: "2026-11-20" })]);
    expect(flags.map((f) => f.key)).toContain("rest");
  });

  it("an earlier review's spots come back into the editor as they were saved", () => {
    const fb = "fb-1";
    const picks = picksFromEntries([entry({ region: "knee", side: "L", site: "patellar_tendon", score: 7, timing: ["after"], date: "2026-11-20", feedbackId: fb })], fb);
    expect(picks).toHaveLength(1);
    expect(picks[0].site).toBe("patellar_tendon");
    expect(picks[0].score).toBe(7);
    expect(picks[0].timing).toEqual(["after"]);
  });
});

describe("a report the app closing cut short", () => {
  it("is kept on the phone for a day and forgotten after", () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    Object.defineProperty(globalThis, "window", { value: { localStorage: fake }, configurable: true });
    try {
      const key = painDraftKey("day-1", null, null);
      expect(readPainDraft(key)).toBeNull();
      const p = { ...newPick("hip", "R", "hip_flexor"), ...scorePatch(4) };
      keepPainDraft(key, [p], 1000);
      expect(readPainDraft(key, 2000)?.picks[0].site).toBe("hip_flexor");
      expect(readPainDraft(key, 1000 + PAIN_DRAFT_MS + 1)).toBeNull();
      expect(store.has(key)).toBe(false);
      keepPainDraft(key, [p], 1000);
      forgetPainDraft(key);
      expect(readPainDraft(key, 2000)).toBeNull();
      store.set(key, "{not json");
      expect(readPainDraft(key)).toBeNull();
      expect(painDraftKey("day-1", "sw", "c")).not.toBe(key);
    } finally {
      // @ts-expect-error test cleanup
      delete globalThis.window;
    }
  });
});

describe("the review keeps what's being typed", () => {
  const ed = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
  it("asks before closing with answers that aren't saved", () => {
    expect(ed).toContain("onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}");
    expect(ed).toContain("onClick={requestClose}");
    expect(ed).toContain("data-review-discard");
    expect(ed).toContain("Keep editing");
  });
  it("brings an interrupted pain report back, and forgets it once saved", () => {
    expect(ed).toContain("readPainDraft(draftKey)");
    expect(ed).toContain("forgetPainDraft(draftKey)");
  });
  it("the map is a full screen of its own over the review with a way back at every step", () => {
    const map = readFileSync("src/components/pain/pain-map.tsx", "utf8");
    expect(map).toContain("data-pain-map");
    expect(map).toMatch(/onEscapeKeyDown/);
    expect(map).toMatch(/onPointerDownOutside/);
  });
  it("holds the scroll lock itself, so its details, list and tray scroll over the review sheet", () => {
    // Radix puts RemoveScroll on the overlay: with none, the review sheet's lock
    // cancelled every touchmove on the map (Nov 21 2026: the details wouldn't scroll)
    const map = readFileSync("src/components/pain/pain-map.tsx", "utf8");
    expect(map).toContain("<DialogPrimitive.Overlay");
    // the details sheet is the height the map frames around, so no label sits under it
    expect(map).toContain("height: `${DETAILS_SHARE * 100}%`");
    expect(map.match(/size\.h \* DETAILS_SHARE/g)?.length).toBe(2);
    expect(map).not.toMatch(/size\.h \* 0\.\d+/);
    // a swipe up or down that starts on the 0–10 row scrolls the sheet
    expect(map).toContain("touch-pan-y grid-cols-11");
  });
  it("typing keeps the box in view above the keyboard, and a pinch never zooms the page", () => {
    const map = readFileSync("src/components/pain/pain-map.tsx", "utf8");
    // the details pin to the visible part of the screen, the Setup sheet's way
    expect(map).toContain("useVisualViewportBox(open)");
    expect(map).toContain("top: vv.top + 8, height: vv.height - 8");
    expect(map).toContain("useSwipeDownToClose(panel, !kb, onDone)");
    expect(map).toContain("revealDelta(");
    // two fingers anywhere on the map are the map's
    expect(map).toContain("e.touches.length > 1 && e.cancelable");
    expect(map).toContain('addEventListener("gesturestart", stop)');
  });
});
