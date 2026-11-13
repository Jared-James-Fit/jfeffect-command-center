import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const k of ["from", "select", "eq", "is", "gt", "gte", "order"]) q[k] = () => q;
  q.limit = async () => ({ data: rows, error: null });
  return { supabase: q };
});

import {
  CATCH_UP_LAUNCHES,
  catchUpCheckedRecently,
  catchUpJobId,
  findCatchUpClips,
  leftOutForSize,
  takeCatchUpLaunch,
} from "@/lib/set-videos/catch-up";
import { feedCopyPath } from "@/lib/set-videos/feed-copy";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MiB = 1024 * 1024;
const CLIENT = "c0ffee00-1111-4222-8333-444455556666";

function fakeStorage() {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("set videos the film left out for their size get a copy later (catch-up)", () => {
  beforeEach(() => {
    fakeStorage();
    rows.length = 0;
  });

  it("names the copy after the clip's own job, the only name set_video_feed_copy takes", () => {
    const job = catchUpJobId(CLIENT, `${CLIENT}/set-videos/k9_Ab-1.mov`);
    expect(job).toBe("k9_Ab-1");
    expect(feedCopyPath(CLIENT, job!, "mp4")).toBe(`${CLIENT}/set-videos/k9_Ab-1-feed.mp4`);
    // never someone else's folder, a copy itself or an odd path
    expect(catchUpJobId(CLIENT, `other/set-videos/k9.mov`)).toBeNull();
    expect(catchUpJobId(CLIENT, `${CLIENT}/set-videos/k9-feed.mp4`)).toBeNull();
    expect(catchUpJobId(CLIENT, `${CLIENT}/set-videos/../x.mov`)).toBeNull();
  });

  it("only clips over a workout post's 50 MB that a copy can put on (one too long stays out either way)", () => {
    // Jared's Nov 12 squat: 4K, 34 s, 69.7 MB
    expect(leftOutForSize({ size_bytes: 69.7 * MiB, duration_s: 34.2 })).toBe(true);
    expect(leftOutForSize({ size_bytes: "54000000", duration_s: "33.8" })).toBe(true);
    // already on the film
    expect(leftOutForSize({ size_bytes: 49.5 * MiB, duration_s: 29.3 })).toBe(false);
    // over 90 s: a copy wouldn't make it fit
    expect(leftOutForSize({ size_bytes: 120 * MiB, duration_s: 140 })).toBe(false);
    expect(leftOutForSize({ size_bytes: null, duration_s: 20 })).toBe(false);
  });

  it("tries a clip on at most a few launches, so a phone that can't make it never downloads it every time", () => {
    for (let i = 0; i < CATCH_UP_LAUNCHES; i++) expect(takeCatchUpLaunch("v1")).toBe(true);
    expect(takeCatchUpLaunch("v1")).toBe(false);
    expect(takeCatchUpLaunch("v2")).toBe(true);
  });

  it("a phone that found nothing looks again only hours later", async () => {
    expect(catchUpCheckedRecently("u1")).toBe(false);
    expect(await findCatchUpClips("u1")).toEqual([]);
    expect(catchUpCheckedRecently("u1")).toBe(true);
    expect(await findCatchUpClips("u1")).toEqual([]);
  });

  it("returns the clips that need a copy and keeps looking while there are some", async () => {
    rows.push(
      { id: "a", client_id: CLIENT, storage_path: `${CLIENT}/set-videos/j1.mov`, size_bytes: 69.7 * MiB, duration_s: 34.2, mime: "video/quicktime" },
      { id: "b", client_id: CLIENT, storage_path: `${CLIENT}/set-videos/j2-feed.mp4`, size_bytes: 60 * MiB, duration_s: 30, mime: "video/mp4" },
    );
    const got = await findCatchUpClips("u2");
    expect(got.map((c) => c.id)).toEqual(["a"]);
    expect(catchUpCheckedRecently("u2")).toBe(false);
  });

  it("starts after the launch, fetches each clip only when its turn comes and makes the copy like a new one", () => {
    const resume = read("src/lib/set-videos/resume.tsx");
    expect(resume).toContain("const CATCH_UP_AFTER_MS = 20_000;");
    expect(resume).toContain("const clips = await findCatchUpClips(uid);");
    expect(resume).toContain("if (!cancelled) await m.catchUpFeedCopies(uid, clips);");
    const up = read("src/lib/set-videos/uploader.ts");
    // the clip the coach got, back from storage, planned as the original it was
    expect(up).toContain("const { data, error } = await supabase.storage.from(BUCKET).download(path);");
    expect(up).toContain('const plan = feedCopyPlan("original", probe.info, null, probe.canEncode);');
    // loaded only when its turn comes, and let go once the copy is made
    expect(up).toContain("const src = item.video && item.plan ? { video: item.video, plan: item.plan } : await item.load?.();");
    expect(up).toContain("item.video = undefined;");
    // only on a phone that can encode, only while the film goes to Crew
    expect(up).toContain('typeof (window as any).VideoEncoder === "undefined"');
    expect(up).toContain("if (!jobId || !takeCatchUpLaunch(c.id)) continue;");
  });
});
