/**
 * The server's bar-speed reader (run by .github/workflows/velocity-worker.yml).
 *
 * For each set video waiting for a read (claimed from the app's hook, which
 * leases it for 20 minutes): download it, make a clean working copy with
 * ffmpeg (H.264, at most 1920 px on its long side, a keyframe a second: the
 * same pixels the phone measures, any codec in, fast seeking), then
 *   1. the phone's own pipeline, in headless Chromium (run.ts, identical code
 *      and decoder, so a set read here and on a phone agree);
 *   2. if that wouldn't go on the set: the any-angle estimate (estimate.ts),
 *      on frames ffmpeg decodes;
 *   3. hand back what it found, or the most useful read and why, in words.
 * The video only ever sits in this runner's temporary folder, deleted after
 * each job; nothing about a client is ever printed (the logs are public).
 *
 *   VELOCITY_HOOK_URL   https://jfeffect.com/api/public/hooks/velocity-worker
 *   RUN_MINUTES         how long to keep polling (default 25)
 *   ONCE=1              stop as soon as nothing is waiting
 *   DRY_JOBS=<file>     test locally: jobs from a JSON file (url may be a local path), every
 *                       hook call printed instead of sent
 */
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { decode } from "../lift-analysis/decode";
import { circleSeeds, estimateRead, everyNth } from "../../src/lib/lift-analysis/estimate";
import { guideLift, movementOf, repDirection } from "../../src/lib/lift-analysis/exercise";
import { fallbackOf, reasonWords, wouldLog, type WorkerJob } from "../../src/lib/lift-analysis/worker-plan";
import { startBrowser, type BrowserReader } from "./browser";

const HOOK = process.env.VELOCITY_HOOK_URL ?? "https://jfeffect.com/api/public/hooks/velocity-worker";
const AUDIENCE = "jfeffect-velocity-worker";
const RUN_MS = Number(process.env.RUN_MINUTES ?? 25) * 60_000;
const ONCE = process.env.ONCE === "1";
const IDLE_MS = 20_000;
const MAX_DOWNLOAD = 800 * 1024 * 1024;

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── GitHub's OIDC token: who this worker is, to the app ─────────────────── */
let token: { value: string; at: number } | null = null;
async function oidc(): Promise<string> {
  if (token && Date.now() - token.at < 4 * 60_000) return token.value;
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("No GitHub OIDC token (the workflow needs id-token: write)");
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, {
    headers: { authorization: `bearer ${bearer}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OIDC token request failed: ${res.status}`);
  const body = (await res.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC token missing");
  token = { value: body.value, at: Date.now() };
  return body.value;
}

const DRY = process.env.DRY_JOBS ? (JSON.parse(readFileSync(process.env.DRY_JOBS, "utf8")) as WorkerJob[]) : null;

async function hook(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (DRY) {
    if (action === "claim") return { jobs: DRY.splice(0, 1) };
    if (action === "commit") {
      const r = payload.result as any;
      console.log(JSON.stringify({ commit: payload.set_video_id, outcome: payload.outcome, message: payload.message,
        engine: r?.engine, status: r?.status ?? "done", reps: r?.reps?.length, view: r?.plate?.view,
        accepted: r?.velocity?.accepted, value: r?.velocity?.value, tier: r?.velocity?.tier, ms: payload.compute_ms }));
      return { ok: true, logged: !!r?.velocity?.accepted };
    }
    if (action !== "heartbeat") console.log(JSON.stringify({ action, ...payload }));
    return { ok: true };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(HOOK, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await oidc()}` },
        body: JSON.stringify({ action, ...payload }),
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: "non_json", status: res.status };
      }
      if (res.status === 401) throw Object.assign(new Error(`unauthorized: ${body?.why ?? ""}`), { fatal: true });
      if (!res.ok) throw new Error(`hook ${action} ${res.status} ${body?.error ?? ""}`);
      return body;
    } catch (e: any) {
      if (e?.fatal || attempt >= 4) throw e;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

/* ── one job ─────────────────────────────────────────────────────────────── */
function normalise(src: string, out: string) {
  // the picture as shown (rotation applied), H.264 at most 1920 px long, a keyframe every second,
  // every frame kept at its own time
  const vf = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))':flags=lanczos,format=yuv420p";
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", src, "-map", "0:v:0", "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "16", "-force_key_frames", "expr:gte(t,n_forced*1)", "-fps_mode", "passthrough",
      "-movflags", "+faststart", out],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 10 * 60_000 },
  );
}

async function processJob(job: WorkerJob, reader: BrowserReader, dir: string) {
  const t0 = Date.now();
  const beat = (stage: string) =>
    hook("heartbeat", { set_video_id: job.set_video_id, lease_id: job.lease_id, stage }).catch(() => undefined);
  const timer = setInterval(() => void beat("reading"), 60_000);
  const src = join(dir, "source");
  const clip = join(dir, "clip.mp4");
  try {
    await beat("downloading");
    if (DRY && job.url.startsWith("/")) copyFileSync(job.url, src);
    else {
      const res = await fetch(job.url);
      if (!res.ok || !res.body) throw Object.assign(new Error(`download ${res.status}`), { retry: true });
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(src));
    }
    if (statSync(src).size > MAX_DOWNLOAD) throw Object.assign(new Error("The video is too large to read."), { retry: false });
    await beat("preparing");
    try {
      normalise(src, clip);
    } catch {
      throw Object.assign(new Error("The video couldn't be decoded."), { retry: false, unreadable: true });
    }
    const ex = job.exercise_name;
    const dirHint = repDirection(ex) ?? undefined;
    const movement = movementOf(ex);

    // 1. the phone's own pipeline
    await beat("reading");
    const phone = await reader.analyze(clip, { dirHint, lift: guideLift(ex), movement });
    if (phone.ok && wouldLog(phone.analysis, job)) {
      return await finish(job, phone.analysis, "phone_pipeline", "", t0);
    }

    // 2. the any-angle estimate
    await beat("estimating");
    const d = decode(clip, 480, { end: 75 });
    const est = estimateRead(d.frames, {
      dirHint,
      movement,
      expectedReps: job.reps,
      extraSeeds: circleSeeds(everyNth(d.frames, 4).slice(0, 40)),
    });
    if (est.ok && wouldLog(est.analysis, job)) {
      return await finish(job, est.analysis, "estimated", "", t0);
    }

    // 3. nothing that goes on the set: keep the most useful read, and why
    const fb = fallbackOf(
      { analysis: phone.ok ? phone.analysis : null, why: phone.ok ? null : phone.why },
      {
        analysis: est.ok ? est.analysis : est.best,
        why: est.ok ? ["reps_differ"] : est.tried.flatMap((t) => t.why).concat(est.why === "disagree" ? ["disagree"] : []),
      },
    );
    return await finish(job, fb.result, fb.outcome.outcome, fb.outcome.message, t0);
  } catch (e: any) {
    if (e?.unreadable) {
      return await finish(
        job,
        { engine: "bar-path/server", status: "failed", why: "unreadable", suggestions: [] },
        "unreadable",
        reasonWords(["unreadable"]),
        t0,
      );
    }
    const retry = e?.retry !== false;
    log(`job failed (${retry ? "will retry" : "final"}): ${String(e?.message ?? e).slice(0, 120)}`);
    await hook("fail", {
      set_video_id: job.set_video_id,
      lease_id: job.lease_id,
      reason: String(e?.message ?? "The read couldn't finish.").slice(0, 200),
      retry,
    }).catch(() => undefined);
    return "failed";
  } finally {
    clearInterval(timer);
    rmSync(src, { force: true });
    rmSync(clip, { force: true });
  }
}

async function finish(job: WorkerJob, result: unknown, outcome: string, message: string, t0: number) {
  const r = await hook("commit", {
    set_video_id: job.set_video_id,
    lease_id: job.lease_id,
    result,
    compute_ms: Date.now() - t0,
    outcome,
    message,
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  log(`read in ${secs}s: ${r?.logged ? `logged (${outcome})` : r?.kept ? "kept a newer read" : outcome}`);
  return r?.logged ? "logged" : outcome;
}

/* ── the loop ────────────────────────────────────────────────────────────── */
async function main() {
  const start = Date.now();
  const dir = join(tmpdir(), "velocity-worker");
  mkdirSync(dir, { recursive: true });
  let reader: BrowserReader | null = null;
  const tally: Record<string, number> = {};
  try {
    while (Date.now() - start < RUN_MS) {
      const { jobs } = (await hook("claim", { max: 1 })) as { jobs: WorkerJob[] };
      if (!jobs?.length) {
        if (ONCE || DRY) break;
        await sleep(IDLE_MS);
        continue;
      }
      reader ??= await startBrowser();
      for (const job of jobs) {
        const what = await processJob(job, reader, dir);
        tally[what] = (tally[what] ?? 0) + 1;
      }
    }
  } finally {
    await reader?.close();
    rmSync(dir, { recursive: true, force: true });
    log(`done: ${JSON.stringify(tally)}`);
  }
}

main().catch((e) => {
  console.error(`worker stopped: ${String(e?.message ?? e).slice(0, 200)}`);
  process.exit(1);
});
