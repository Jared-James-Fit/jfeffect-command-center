/**
 * Plays the app's real feedback engine in headless Chromium and measures what
 * comes out (node scripts/sound-check/run.cjs). Not a mock: src/lib/app-sounds.ts
 * and src/lib/feedback.ts bundled as they ship, on a real AudioContext, with the
 * context's output tapped (a ScriptProcessor records every block it plays).
 *
 *   1. every cue rendered offline: audible, short, never clipping at full volume,
 *      the logging cues in the order of what they mean (confirm < set < … );
 *   2. live, through feedback(): each cue plays from the cache within a few ms;
 *   3. browser audio rules: nothing before a tap, everything after it (an iPhone's
 *      viewport and touch, `--autoplay-policy=user-gesture-required`);
 *   4. rapid logging: 20 sets in 1.4 s are a few pops, never a pile-up or a clip;
 *   5. priority: a PR over its set's pop over a confirm tick, in one moment;
 *   6. volume: the level follows the slider; 0 is silence;
 *   7. offline: the network off, the cues still play (nothing is fetched);
 *   8. a hidden app makes no sound; a replayed set (same key) is silent.
 * Prints a table and exits non-zero on any failure.
 */
const path = require("node:path");
const esbuild = require("esbuild");
const { chromium, devices } = require("playwright");

const root = path.resolve(__dirname, "../..");
const fails = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails.push(what);
};

async function bundle() {
  const out = await esbuild.build({
    entryPoints: [path.join(__dirname, "entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    alias: { "@": path.join(root, "src") },
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

/**
 * Before the engine loads: tap every AudioContext's output so we hear what it
 * plays, and hold it to an iPhone's rule (Playwright's own calls count as a
 * user gesture, so without this the page could start audio by itself): a
 * context stays suspended until a resume() inside a real tap / click / key.
 */
const TAP = `
(() => {
  const Real = window.AudioContext;
  window.__blocks = [];
  window.__ctxs = [];
  let gesture = false;
  for (const type of ["touchend", "pointerup", "click", "keydown"]) {
    window.addEventListener(type, () => { gesture = true; setTimeout(() => { gesture = false; }, 0); }, true);
  }
  const realResume = Real.prototype.resume;
  window.AudioContext = function (opts) {
    const c = new Real(opts);
    let blocked = true;
    realResume; // the real one stays on the prototype
    c.suspend();
    c.resume = function () {
      if (blocked && !gesture) return Promise.resolve();
      blocked = false;
      return realResume.call(c);
    };
    const tap = c.createGain();
    tap.connect(c.destination);
    const sp = c.createScriptProcessor(256, 1, 1);
    tap.connect(sp);
    const sink = c.createGain();
    sink.gain.value = 0;
    sp.connect(sink).connect(c.destination);
    sp.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
      window.__blocks.push({ t: e.playbackTime, peak, rms: Math.sqrt(sum / d.length) });
    };
    Object.defineProperty(c, "destination", { value: tap });
    window.__ctxs.push(c);
    return c;
  };
  window.AudioContext.prototype = Real.prototype;
})();
`;

async function page(browser, ctxOpts = {}) {
  const context = await browser.newContext(ctxOpts);
  const p = await context.newPage();
  // a real origin, so localStorage / sessionStorage work as in the app
  await context.route("https://sound-check.test/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body style='height:600px'><button id='b' style='width:300px;height:300px'>tap</button></body></html>" }),
  );
  await p.goto("https://sound-check.test/");
  await p.addScriptTag({ content: TAP });
  await p.addScriptTag({ content: CODE });
  return { context, p };
}

/** Wait, then read what played since `since` (audio-clock seconds). */
const heard = (p, since, ms = 400) =>
  p.evaluate(
    async ({ since, ms }) => {
      await new Promise((r) => setTimeout(r, ms));
      const b = window.__blocks.filter((x) => x.t >= since);
      const loud = b.filter((x) => x.peak > 0.002);
      return {
        peak: Math.max(0, ...b.map((x) => x.peak)),
        energy: b.reduce((a, x) => a + x.rms * x.rms, 0),
        first: loud.length ? loud[0].t - since : null,
        onsets: b.reduce((n, x, i) => n + (x.peak > 0.01 && (i === 0 || b[i - 1].peak <= 0.004) ? 1 : 0), 0),
        // a set's pop rising through a level a confirm tick never reaches
        pops: b.reduce((n, x, i) => n + (x.peak > 0.05 && (i === 0 || b[i - 1].peak <= 0.05) ? 1 : 0), 0),
      };
    },
    { since, ms },
  );
const now = (p) => p.evaluate(() => window.__ctxs[0]?.currentTime ?? 0);

let CODE = "";
(async () => {
  CODE = await bundle();
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });

  // ── 1. every cue rendered offline ─────────────────────────────────────────
  {
    const { p, context } = await page(browser);
    const stats = await p.evaluate(async () => {
      const s = window.__sounds;
      const names = Object.keys(s.SOUND_SECONDS);
      const rate = 48000;
      const out = {};
      const full = s.volumeToGain(1);
      for (const n of names) {
        const buf = await s.renderAppSound(n, rate);
        const d = buf.getChannelData(0);
        let peak = 0, sum = 0, last = 0, first = -1, active = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > peak) peak = a;
          if (a > 0.0005) { last = i; if (first < 0) first = i; }
        }
        for (let i = Math.max(0, first); i <= last; i++) { sum += d[i] * d[i]; active++; }
        out[n] = {
          peakDb: 20 * Math.log10(peak * full),
          rmsDb: 10 * Math.log10(sum / Math.max(1, active) * full * full),
          seconds: (last - Math.max(0, first)) / rate,
          onsetMs: (Math.max(0, first) / rate) * 1000,
        };
      }
      return out;
    });
    console.log("\ncue          peak dBFS  RMS dBFS  length  onset   (full volume)");
    for (const [n, x] of Object.entries(stats)) {
      console.log(`${n.padEnd(12)} ${x.peakDb.toFixed(1).padStart(8)} ${x.rmsDb.toFixed(1).padStart(9)} ${x.seconds.toFixed(2).padStart(6)}s ${x.onsetMs.toFixed(1).padStart(5)}ms`);
    }
    console.log("");
    for (const [n, x] of Object.entries(stats)) {
      check(x.peakDb > -45, `${n}: audible`, `peak ${x.peakDb.toFixed(1)} dBFS`);
      check(x.peakDb < -1, `${n}: no clipping at full volume`, `peak ${x.peakDb.toFixed(1)} dBFS`);
      check(x.seconds < 1.5, `${n}: short`, `${x.seconds.toFixed(2)} s`);
      // the Rankings board's swish swells in by design; every tap's cue starts at once
      if (n !== "whoosh") check(x.onsetMs < 8, `${n}: starts at once`, `${x.onsetMs.toFixed(1)} ms`);
    }
    const r = (n) => stats[n].rmsDb;
    check(r("confirm") < r("set"), "a confirm tick is quieter than a set's pop", `${r("confirm").toFixed(1)} < ${r("set").toFixed(1)}`);
    check(stats.confirm.seconds < 0.06, "a confirm tick is a tick", `${(stats.confirm.seconds * 1000).toFixed(0)} ms`);
    check(stats.set.seconds < 0.15, "a set's pop is short", `${(stats.set.seconds * 1000).toFixed(0)} ms`);
    check(stats.warning.peakDb < stats.pr.peakDb && stats.error.peakDb < stats.pr.peakDb, "a failure is softer than a PR");
    check(stats.pr.seconds > stats.set.seconds && stats.workout.seconds > stats.exercise.seconds, "the big moments ring longer than the everyday ones");
    await context.close();
  }

  // ── 2 & 3. live, through feedback(), with the browser's audio rules ───────
  {
    const iphone = devices["iPhone 13"];
    const { p, context } = await page(browser, { ...iphone });
    // before any tap: the context exists but may not start
    await p.evaluate(() => window.__fb.primeFeedback());
    await p.waitForTimeout(300);
    const t0 = await now(p);
    await p.evaluate(() => window.__fb.feedback("set", { key: "before-tap" }));
    const before = await heard(p, t0, 500);
    check(before.energy === 0, "nothing plays before the first tap (the browser's rule)", `energy ${before.energy.toExponential(1)}`);
    await p.touchscreen.tap(150, 150);
    await p.waitForTimeout(200);
    const state = await p.evaluate(() => window.__ctxs[0]?.state);
    check(state === "running", "a tap wakes the audio", state);
    await p.waitForTimeout(1500); // idle-time rendering of the hot cues
    const cached = await p.evaluate(() => window.__sounds.preloadedAppSounds());
    check(["confirm", "set", "exercise", "pr", "rest", "upload", "workout", "warning"].every((n) => cached.includes(n)), "the logging cues are rendered and cached", cached.join(","));
    const lat = {};
    for (const [ev, cue] of [["confirm", "confirm"], ["set", "set"], ["exercise", "exercise"], ["upload", "upload"], ["pr", "pr"], ["rest", "rest"], ["workout", "workout"], ["warning", "warning"]]) {
      await p.waitForTimeout(1600);
      const t = await now(p);
      const fired = await p.evaluate((e) => window.__fb.feedback(e, { key: `live-${e}` }), ev);
      const h = await heard(p, t, 600);
      lat[cue] = h.first;
      check(fired && h.energy > 0 && h.first != null && h.first < 0.04, `${ev}: plays live from the cache`, `first sound ${h.first == null ? "never" : (h.first * 1000).toFixed(0) + " ms"} after the call (audio clock), peak ${h.peak.toFixed(3)}`);
    }

    // ── 4. rapid logging ─────────────────────────────────────────────────────
    await p.waitForTimeout(1600);
    const tr = await now(p);
    await p.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        window.__fb.feedback("confirm", { key: `rc-${i}` });
        window.__fb.feedback("set", { key: `rs-${i}` });
        await new Promise((r) => setTimeout(r, 70));
      }
    });
    const rapid = await heard(p, tr, 600);
    check(rapid.pops >= 2 && rapid.pops <= 4, "rapid logging: 20 sets in 1.4 s are a few pops, not 20", `${rapid.pops} pops`);
    check(rapid.peak < 0.95, "rapid logging never clips", `peak ${rapid.peak.toFixed(3)}`);

    // ── 5. priority in one moment ────────────────────────────────────────────
    await p.waitForTimeout(1600);
    const tp = await now(p);
    const decisions = await p.evaluate(async () => {
      const out = [];
      out.push(window.__fb.feedback("confirm", { key: "pm-c" }));
      await new Promise((r) => setTimeout(r, 40));
      out.push(window.__fb.feedback("set", { key: "pm-s" }));
      await new Promise((r) => setTimeout(r, 120));
      out.push(window.__fb.feedback("pr", { key: "pm-p" }));
      await new Promise((r) => setTimeout(r, 60));
      out.push(window.__fb.feedback("set", { key: "pm-s2" }));
      return out;
    });
    const prio = await heard(p, tp, 1100);
    check(decisions.every(Boolean) && prio.peak < 0.95 && prio.energy > 0, "confirm → set → PR in one moment: the PR lands, nothing clips", `peak ${prio.peak.toFixed(3)}`);

    // ── 6. volume ────────────────────────────────────────────────────────────
    const level = async (v, key) => {
      await p.evaluate((v) => window.__sounds.setAppSoundVolume(v), v);
      await p.waitForTimeout(1700);
      const t = await now(p);
      await p.evaluate((k) => window.__fb.feedback("exercise", { key: k }), key);
      return heard(p, t, 900);
    };
    const loud = await level(1, "vol-1");
    const soft = await level(0.3, "vol-03");
    const mute = await level(0, "vol-0");
    const expected = await p.evaluate(() => window.__sounds.volumeToGain(0.3) / window.__sounds.volumeToGain(1));
    const ratio = soft.peak / loud.peak;
    check(Math.abs(ratio - expected) < 0.05, "volume: the level follows the slider", `0.3 → ${ratio.toFixed(3)} of full (expected ${expected.toFixed(3)})`);
    check(mute.energy === 0, "volume 0 is silence", `energy ${mute.energy}`);
    await p.evaluate(() => window.__sounds.setAppSoundVolume(0.8));

    // ── 7. offline ───────────────────────────────────────────────────────────
    await context.setOffline(true);
    await p.waitForTimeout(1700);
    const to = await now(p);
    await p.evaluate(() => window.__fb.feedback("pr", { key: "offline-pr" }));
    const off = await heard(p, to, 700);
    check(off.energy > 0, "offline: a PR still sounds (nothing is fetched)");
    await context.setOffline(false);

    // ── 8. hidden app, replays ───────────────────────────────────────────────
    await p.waitForTimeout(1700);
    const tk = await now(p);
    const replay = await p.evaluate(() => window.__fb.feedback("set", { key: "live-set" }));
    const rep = await heard(p, tk, 500);
    check(replay === false && rep.energy === 0, "a set already sounded (same key: a refetch, a remount) is silent");
    const old = await p.evaluate(() => window.__fb.feedback("pr", { key: "history", at: Date.now() - 3 * 86400000 }));
    check(old === false, "a PR from history is silent");
    await p.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
    await p.waitForTimeout(1700);
    const th = await now(p);
    await p.evaluate(() => window.__fb.feedback("pr", { key: "hidden-pr" }));
    const hid = await heard(p, th, 600);
    check(hid.energy === 0, "a hidden app makes no sound");
    console.log("\nlatency from feedback() to sound (audio clock):", Object.entries(lat).map(([k, v]) => `${k} ${v == null ? "-" : (v * 1000).toFixed(0) + "ms"}`).join(", "));
    await context.close();
  }

  // ── an iPhone's audio session: "ambient" (mixes with their music, follows the silent switch) ──
  {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const p = await context.newPage();
    await context.route("https://sound-check.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<button style='width:300px;height:300px'>tap</button>" }));
    await p.goto("https://sound-check.test/");
    await p.addScriptTag({ content: "navigator.audioSession = { type: 'auto' };" });
    await p.addScriptTag({ content: TAP });
    await p.addScriptTag({ content: CODE });
    await p.touchscreen.tap(100, 100);
    await p.evaluate(() => window.__fb.feedback("set", { key: "session" }));
    const type = await p.evaluate(() => navigator.audioSession.type);
    check(type === "ambient", "the audio session is ambient (music keeps playing)", type);
    await context.close();
  }

  // ── Android: haptics through navigator.vibrate, the tuned pattern per moment, its own switch ──
  {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const p = await context.newPage();
    await context.route("https://sound-check.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<button style='width:300px;height:300px'>tap</button>" }));
    await p.goto("https://sound-check.test/");
    await p.addScriptTag({ content: "window.__buzz = []; navigator.vibrate = (x) => { window.__buzz.push(x); return true; };" });
    await p.addScriptTag({ content: TAP });
    await p.addScriptTag({ content: CODE });
    await p.touchscreen.tap(100, 100);
    const route = await p.evaluate(() => window.__haptics.hapticRoute());
    check(route === "vibrate", "Android web: haptics go through vibrate", route);
    const buzz = await p.evaluate(async () => {
      const out = {};
      for (const ev of ["confirm", "set", "exercise", "pr", "upload", "rest", "warning"]) {
        window.__buzz.length = 0;
        window.__fb.feedback(ev, { key: `hap-${ev}` });
        out[ev] = window.__buzz[0] ?? null;
        await new Promise((r) => setTimeout(r, 600));
      }
      window.__haptics.setHapticsEnabled(false);
      window.__buzz.length = 0;
      window.__fb.feedback("set", { key: "hap-off" });
      out.off = window.__buzz.length;
      return out;
    });
    check(JSON.stringify(buzz.confirm) === "8", "a confirm is the lightest tick", JSON.stringify(buzz.confirm));
    check(JSON.stringify(buzz.set) === "20", "a set is a medium tap", JSON.stringify(buzz.set));
    check(JSON.stringify(buzz.pr) === "[14,70,22]", "a PR is the success pattern", JSON.stringify(buzz.pr));
    check(JSON.stringify(buzz.upload) === "[14,70,22]" && JSON.stringify(buzz.rest) === "[14,70,22]", "footage done and rest over are the soft double tap, never the alarm");
    check(JSON.stringify(buzz.warning) === "[24,80,24]", "a failed action is the warning pattern", JSON.stringify(buzz.warning));
    check(buzz.off === 0, "haptics off: nothing buzzes (sounds are a separate switch)");
    await context.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
