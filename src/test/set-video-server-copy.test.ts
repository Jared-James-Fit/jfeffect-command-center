import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SERVER_COPY_GRACE_MS,
  SERVER_COPY_TRIES,
  afterFailure,
  copyKeeps,
  leftToServer,
  muxAssetBody,
  muxMp4Url,
  needsServerCopy,
  playbackIdOf,
  readRendition,
  serverCopyPath,
} from "@/lib/set-videos/server-copy";

/**
 * Nov 18 2026: the 720p copies the workout film needs were made on the
 * athlete's phone, only while the app was open, so Jared's Monday Pull Up
 * (58.5 MB, 31 s, 4K) never got one and his film showed 5 of his 6 sets. The
 * copy is now made on a server (Mux) the moment the clip lands; the phone is
 * the fallback.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MB = 1024 * 1024;
const CLIENT = "3a548c6a-a07c-4832-aa32-92fdfdbe3282";
const pullUp = {
  id: "60c6f583-1dfa-4bec-b3db-2e295b0d4f8a",
  client_id: CLIENT,
  set_index: 1,
  deleted_at: null,
  feed_path: null,
  storage_path: `${CLIENT}/set-videos/69a11f1c-7fce-4578-a3a1-32b2cc69d4f7.mov`,
  duration_s: "30.800",
  size_bytes: Math.round(58.5 * MB),
  width: 2160,
  height: 3840,
  uploaded_by: "3d502a48-303a-48cd-97d6-fad7ca5cc7e3",
};

describe("which clips get a copy made on the server", () => {
  it("a 4K set like Jared's Pull Up does; so does a 1080p one (lighter for everyone watching)", () => {
    expect(needsServerCopy(pullUp)).toBe(true);
    expect(needsServerCopy({ ...pullUp, size_bytes: 23 * MB, width: 1080, height: 1920 })).toBe(true);
  });
  it("never a clip already light enough, one with a copy, a warm-up, one too long for a post, or someone else's folder", () => {
    expect(needsServerCopy({ ...pullUp, size_bytes: 2.2 * MB, width: 360, height: 480 })).toBe(false);
    expect(needsServerCopy({ ...pullUp, size_bytes: 21 * MB, width: 720, height: 1280 })).toBe(false);
    expect(needsServerCopy({ ...pullUp, feed_path: "x-feed.mp4" })).toBe(false);
    expect(needsServerCopy({ ...pullUp, set_index: 0 })).toBe(false);
    expect(needsServerCopy({ ...pullUp, duration_s: 140 })).toBe(false);
    expect(needsServerCopy({ ...pullUp, deleted_at: "2026-11-18" })).toBe(false);
    expect(needsServerCopy({ ...pullUp, storage_path: `other/set-videos/abc.mov` })).toBe(false);
    expect(needsServerCopy({ ...pullUp, storage_path: `${CLIENT}/set-videos/abc-feed.mp4` })).toBe(false);
  });
  it("the database's rule is the same one", () => {
    const sql = read("supabase/migrations/20270410090000_server_feed_copies.sql");
    expect(sql).toContain("coalesce(v.duration_s, 0) BETWEEN 0.5 AND 91.5");
    expect(sql).toContain("coalesce(v.size_bytes, 0) >= 4194304");
    expect(sql).toContain("greatest(coalesce(v.width, 0), coalesce(v.height, 0)) > 1300 OR coalesce(v.size_bytes, 0) > 46137344");
    expect(4194304).toBe(4 * MB);
    expect(46137344).toBe(44 * MB);
  });
  it("the copy sits next to the clip under the one name set_video_feed_copy_server takes", () => {
    expect(serverCopyPath(pullUp.storage_path)).toBe(`${CLIENT}/set-videos/69a11f1c-7fce-4578-a3a1-32b2cc69d4f7-feed.mp4`);
    expect(serverCopyPath(`${CLIENT}/set-videos/abc-feed.mp4`)).toBeNull();
  });
});

describe("what Mux is asked for and how its answer is read", () => {
  it("a 720p MP4 of the clip from its link, basic encoding; Mux's older form as the fallback", () => {
    expect(muxAssetBody("https://s/x")).toEqual({ inputs: [{ url: "https://s/x" }], playback_policies: ["public"], video_quality: "basic", static_renditions: [{ resolution: "720p" }] });
    expect(muxAssetBody("https://s/x", true)).toEqual({ input: [{ url: "https://s/x" }], playback_policy: ["public"], mp4_support: "capped-1080p" });
  });
  it("reads the MP4 as ready, still coming, or failed, in either form", () => {
    expect(readRendition({ status: "preparing" })).toEqual({ state: "waiting" });
    expect(readRendition({ status: "ready", static_renditions: { files: [{ name: "720p.mp4", ext: "mp4", status: "preparing" }] } })).toEqual({ state: "waiting" });
    expect(readRendition({ status: "ready", static_renditions: { files: [{ name: "highest.mp4", ext: "mp4", status: "ready" }, { name: "720p.mp4", ext: "mp4", status: "ready", resolution: "720p" }] } })).toEqual({ state: "ready", name: "720p.mp4" });
    expect(readRendition({ status: "ready", static_renditions: { status: "ready", files: [{ name: "capped-1080p.mp4", ext: "mp4" }] } })).toEqual({ state: "ready", name: "capped-1080p.mp4" });
    expect(readRendition({ status: "errored", errors: { messages: ["bad input"] } })).toMatchObject({ state: "failed" });
    expect(readRendition({ status: "ready", static_renditions: { files: [{ name: "720p.mp4", ext: "mp4", status: "skipped" }] } })).toMatchObject({ state: "failed" });
  });
  it("fetched by its public playback id", () => {
    expect(playbackIdOf({ playback_ids: [{ id: "abc", policy: "public" }] })).toBe("abc");
    expect(muxMp4Url("abc", "720p.mp4")).toBe("https://stream.mux.com/abc/720p.mp4");
  });
  it("keeps a copy only when it fits a workout post and is lighter than what was sent", () => {
    expect(copyKeeps(9 * MB, 58.5 * MB)).toBe(true);
    expect(copyKeeps(51 * MB, 80 * MB)).toBe(false);
    expect(copyKeeps(30 * MB, 20 * MB)).toBe(false);
  });
  it("a failed try waits a little longer each time, then it's the phone's", () => {
    expect(afterFailure(1, 0)).toEqual({ status: "queued", next_at: new Date(2 * 60_000).toISOString() });
    expect(afterFailure(SERVER_COPY_TRIES, 0).status).toBe("failed");
  });
  it("the phone leaves a clip to the server only while it's young and the server is on", () => {
    const now = Date.parse("2026-11-18T13:30:00Z");
    expect(leftToServer(true, "2026-11-18T13:21:00Z", now)).toBe(true);
    expect(leftToServer(true, new Date(now - SERVER_COPY_GRACE_MS - 1).toISOString(), now)).toBe(false);
    expect(leftToServer(false, "2026-11-18T13:21:00Z", now)).toBe(false);
  });
});

// ---- the hook's run, against a stand-in database, storage and Mux ----

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() {
      return { displayWidth: 720, displayHeight: 1280, codec: "avc" };
    }
    async computeDuration() {
      return 30.8;
    }
    dispose() {}
  },
}));

type Row = Record<string, any>;
function fakeAdmin(tables: Record<string, Row[]>) {
  const calls: Array<{ kind: string; [k: string]: any }> = [];
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update" | "insert" | "upsert"; patch?: Row } = { kind: "select" };
    let single = false;
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") {
        hit.forEach((r) => Object.assign(r, op.patch));
        calls.push({ kind: "update", table, patch: op.patch });
      } else if (op.kind === "insert" || op.kind === "upsert") {
        rows.push({ ...op.patch });
        calls.push({ kind: op.kind, table, patch: op.patch });
        return { data: [op.patch], error: null };
      }
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b: any = {
      select: () => b,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), b),
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((single = true), Promise.resolve(run())),
      update: (patch: Row) => ((op = { kind: "update", patch }), b),
      insert: (patch: Row) => ((op = { kind: "insert", patch }), Promise.resolve(run())),
      upsert: (patch: Row) => ((op = { kind: "upsert", patch }), Promise.resolve(run())),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const admin = {
    from: builder,
    rpc: async (name: string, args: Row) => {
      calls.push({ kind: "rpc", name, args });
      if (name === "media_video_object") return { data: { id: "obj-1", bytes: 9 * MB }, error: null };
      if (name === "set_video_feed_copy_server") return { data: { id: args._id, completion_id: null }, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${bucket}/${path}?sig=1` } }),
        upload: async (path: string, body: Blob, opts: Row) => {
          calls.push({ kind: "upload", bucket, path, size: body.size, opts });
          return { error: null };
        },
      }),
    },
  };
  return { admin, calls };
}

const jobRow = () => ({
  set_video_id: pullUp.id,
  status: "queued",
  asset_id: null,
  playback_id: null,
  attempts: 0,
  started_at: null,
  created_at: "2026-11-18T13:21:08Z",
  next_at: "2026-11-18T13:21:08Z",
  updated_at: "2026-11-18T13:21:08Z",
});

describe("the feed-copies hook makes the copy end to end", () => {
  const fetches: Array<{ url: string; method: string; body?: any }> = [];
  let polls = 0;
  beforeEach(() => {
    fetches.length = 0;
    polls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      fetches.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "https://api.mux.com/video/v1/assets" && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "asset-1", status: "preparing", playback_ids: [{ id: "pb-1", policy: "public" }] } }), { status: 201 });
      }
      if (url === "https://api.mux.com/video/v1/assets/asset-1" && method === "GET") {
        polls += 1;
        const files = [{ name: "720p.mp4", ext: "mp4", resolution: "720p", status: polls > 1 ? "ready" : "preparing" }];
        return new Response(JSON.stringify({ data: { id: "asset-1", status: "ready", static_renditions: { files } } }), { status: 200 });
      }
      if (url === "https://api.mux.com/video/v1/assets/asset-1" && method === "DELETE") return new Response(null, { status: 204 });
      if (url === "https://stream.mux.com/pb-1/720p.mp4") return new Response(new Uint8Array(9 * MB), { status: 200 });
      return new Response("nope", { status: 404 });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.MUX_TOKEN_ID;
    delete process.env.MUX_TOKEN_SECRET;
  });

  it("hands Mux a link, waits for the 720p MP4, stores and checks it, records it and deletes it from Mux", async () => {
    process.env.MUX_TOKEN_ID = "id";
    process.env.MUX_TOKEN_SECRET = "secret";
    const { runFeedCopyJobs } = await import("@/lib/set-videos/server-copy.server");
    const tables = { set_video_feed_jobs: [jobRow()], pl_set_videos: [{ ...pullUp }], app_settings: [] as Row[] };
    const { admin, calls } = fakeAdmin(tables);
    const res = await runFeedCopyJobs(admin, pullUp.id);
    expect(res).toEqual({ status: "ran", jobs: [{ id: pullUp.id, result: "done" }] });
    // Mux got a short-lived link to the clip, asked for 720p
    const made = fetches.find((f) => f.method === "POST")!;
    expect(made.body.inputs[0].url).toContain(`message-attachments/${pullUp.storage_path}`);
    expect(made.body.static_renditions).toEqual([{ resolution: "720p" }]);
    // stored as the clip's feed copy, checked as a workout post's video, recorded
    const up = calls.find((c) => c.kind === "upload")!;
    expect(up.path).toBe(`${CLIENT}/set-videos/69a11f1c-7fce-4578-a3a1-32b2cc69d4f7-feed.mp4`);
    expect(up.size).toBe(9 * MB);
    const check = calls.find((c) => c.kind === "upsert" && c.table === "media_video_checks")!;
    expect(check.patch).toMatchObject({ owner: pullUp.uploaded_by, context: "workout", width: 720, height: 1280, duration_s: 30.8 });
    expect(calls.some((c) => c.kind === "rpc" && c.name === "set_video_feed_copy_server")).toBe(true);
    // gone from Mux, the job done, and phones told the server makes copies now
    expect(fetches.some((f) => f.method === "DELETE")).toBe(true);
    expect(tables.set_video_feed_jobs[0].status).toBe("done");
    expect(JSON.parse(tables.app_settings[0].value).server).toBe(true);
  });

  it("with no keys on the server nothing is sent anywhere: the job waits an hour and phones keep making copies", async () => {
    const { runFeedCopyJobs } = await import("@/lib/set-videos/server-copy.server");
    const tables = { set_video_feed_jobs: [jobRow()], pl_set_videos: [{ ...pullUp }], app_settings: [] as Row[] };
    const { admin } = fakeAdmin(tables);
    const res = await runFeedCopyJobs(admin, pullUp.id);
    expect(res.status).toBe("off");
    expect(fetches).toHaveLength(0);
    expect(tables.set_video_feed_jobs[0].status).toBe("queued");
    expect(JSON.parse(tables.app_settings[0].value).server).toBe(false);
  });
});

describe("the phone and the film follow it", () => {
  it("the phone makes no copy itself while the server does, and catches up only on one the server left after 30 minutes", () => {
    const up = read("src/lib/set-videos/uploader.ts");
    expect(up).toContain("if (!server) queueFeedCopy({ ...feed, jobId: id, setVideoId, clientId: job.clientId, tries: 0 });");
    const cu = read("src/lib/set-videos/catch-up.ts");
    expect(cu).toContain("const until = server ? new Date(Date.now() - SERVER_COPY_GRACE_MS).toISOString() : null;");
  });
  it("a film Shared to Crew by hand queues copies for its heavy clips; the film says the copy is coming without asking to keep the app open", () => {
    const film = read("src/lib/workout-film.server.ts");
    expect(film).toContain('admin.rpc("set_video_feed_job_queue", { _id: v.id, _force: !data.auto })');
    const row = read("src/components/workout/shared/workout-film.tsx");
    expect(row).toContain("filmNotes(film, { server: film.serverCopies })");
  });
});
