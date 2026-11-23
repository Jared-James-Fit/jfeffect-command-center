import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const groups = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const key = f.replace(/-\d+\.json$/, "");
  let lhr; try { lhr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
  if (!lhr.audits) continue;
  const a = lhr.audits;
  const num = (id) => a[id]?.numericValue ?? null;
  const items = (id, n = 12) => (a[id]?.details?.items ?? []).slice(0, n);
  (groups[key] ??= []).push({
    score: lhr.categories?.performance?.score,
    fcp: num("first-contentful-paint"), lcp: num("largest-contentful-paint"), tbt: num("total-blocking-time"),
    cls: num("cumulative-layout-shift"), si: num("speed-index"), tti: num("interactive"),
    ttfb: num("server-response-time"), bytes: num("total-byte-weight"),
    lcpElement: items("largest-contentful-paint-element", 4),
    lcpBreakdown: a["lcp-breakdown-insight"]?.details ?? a["largest-contentful-paint-element"]?.details?.items?.[1] ?? null,
    renderBlocking: items("render-blocking-resources").map((x) => ({ url: x.url, ms: x.wastedMs, bytes: x.totalBytes })),
    unusedJs: items("unused-javascript").map((x) => ({ url: x.url, total: x.totalBytes, wasted: x.wastedBytes })),
    network: (a["network-requests"]?.details?.items ?? []).map((x) => ({ url: x.url, type: x.resourceType, bytes: x.transferSize, start: Math.round(x.networkRequestTime ?? x.startTime ?? 0), end: Math.round(x.networkEndTime ?? x.endTime ?? 0), prio: x.priority })).sort((p, q) => q.bytes - p.bytes).slice(0, 25),
    requests: (a["network-requests"]?.details?.items ?? []).length,
    bootup: items("bootup-time", 10).map((x) => ({ url: x.url, total: x.total, scripting: x.scripting })),
    mainthread: items("mainthread-work-breakdown", 10).map((x) => ({ group: x.group ?? x.groupLabel, ms: x.duration })),
    layoutShifts: items("layout-shifts", 8).map((x) => ({ node: x.node?.snippet ?? x.node?.selector, score: x.score })),
    cacheTtl: items("uses-long-cache-ttl", 15).map((x) => ({ url: x.url, ttl: x.cacheLifetimeMs, bytes: x.totalBytes })),
    imageIssues: ["uses-responsive-images", "modern-image-formats", "offscreen-images", "uses-optimized-images", "prioritize-lcp-image", "unsized-images"].reduce((o, id) => ((o[id] = { savingsMs: a[id]?.details?.overallSavingsMs ?? null, items: items(id, 10).map((x) => ({ url: x.url ?? x.node?.snippet, wasted: x.wastedBytes })) }), o), {}),
    domSize: num("dom-size"), jsBytes: (a["resource-summary"]?.details?.items ?? []).find((x) => x.resourceType === "script")?.transferSize ?? null,
    resourceSummary: (a["resource-summary"]?.details?.items ?? []).map((x) => ({ t: x.resourceType, n: x.requestCount, bytes: x.transferSize })),
  });
}
const out = {};
for (const [k, runs] of Object.entries(groups)) {
  const sorted = [...runs].sort((x, y) => (x.lcp ?? 1e9) - (y.lcp ?? 1e9));
  const med = sorted[Math.floor(sorted.length / 2)];
  out[k] = { runs: runs.map((r) => ({ score: r.score, fcp: r.fcp, lcp: r.lcp, tbt: r.tbt, cls: r.cls, si: r.si, ttfb: r.ttfb, bytes: r.bytes })), median: med };
}
console.log(JSON.stringify(out, null, 2));
