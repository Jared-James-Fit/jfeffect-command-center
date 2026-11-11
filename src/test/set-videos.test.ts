import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  setVideoFileKey,
  setVideoLabel,
  setVideoMessageBody,
  setVideoStem,
} from "@/lib/set-videos/label";
import { setGridTemplate } from "@/components/workout-day/set-grid";
import { isActiveJob, jobStatusText, jobsForSet, type SetVideoJob } from "@/lib/set-videos/jobs";

const read = (p: string) => readFileSync(p, "utf8");

const base = {
  load: null,
  unit: "kg" as const,
  reps: null,
  rpe: null,
  rir: null,
  loadType: "external" as const,
  durationSec: null,
};

describe("set video label", () => {
  it("reads like the set", () => {
    expect(setVideoLabel({ ...base, load: 100, reps: 5, rpe: 8 })).toBe("100 kg × 5 @ RPE 8");
    expect(setVideoLabel({ ...base, load: 102.5, unit: "lb", reps: 3, rpe: 8.5 })).toBe(
      "102.5 lb × 3 @ RPE 8.5",
    );
    expect(setVideoLabel({ ...base, load: 140, reps: 5, rir: 2 })).toBe("140 kg × 5 @ RIR 2");
    expect(setVideoLabel({ ...base, load: 0, reps: 12, loadType: "bodyweight" })).toBe("BW × 12");
    expect(setVideoLabel({ ...base, load: 20, reps: 8, loadType: "bodyweight" })).toBe(
      "BW + 20 kg × 8",
    );
    expect(setVideoLabel({ ...base, load: 20, reps: 8, loadType: "assisted" })).toBe(
      "20 kg assist × 8",
    );
    expect(setVideoLabel({ ...base, durationSec: 45, rpe: 7 })).toBe("45s @ RPE 7");
    expect(setVideoLabel({ ...base, durationSec: 600 })).toBe("10:00");
    expect(setVideoLabel({ ...base, reps: 1 })).toBe("1 rep");
    expect(setVideoLabel(base)).toBe("");
  });

  it("makes one chat line, never over 200 characters", () => {
    expect(setVideoMessageBody("Bench Press", 3, "100 kg × 5 @ RPE 8")).toBe(
      "🎥 Bench Press · Set 3 · 100 kg × 5 @ RPE 8",
    );
    expect(setVideoMessageBody("  ", 1, "")).toBe("🎥 Exercise · Set 1");
    expect(setVideoMessageBody("x".repeat(400), 1, "y").length).toBeLessThanOrEqual(200);
  });

  it("keys a picked file the same way every time, and differently per client", async () => {
    const f = { name: "IMG_0001.MOV", size: 12_345_678, lastModified: 1_700_000_000_000 };
    const a = await setVideoFileKey("c1", f);
    expect(a).toBe(await setVideoFileKey("c1", { ...f }));
    expect(a).not.toBe(await setVideoFileKey("c2", f));
    expect(a).not.toBe(await setVideoFileKey("c1", { ...f, size: f.size + 1 }));
    expect(a).not.toContain("IMG");
  });

  it("lives in the client's own folder of the chat bucket", () => {
    expect(setVideoStem("abc", "job1")).toBe("abc/set-videos/job1");
  });
});

describe("set grid", () => {
  const cols = {
    showReps: true,
    showTimer: false,
    showCalories: false,
    showVelocity: false,
    hideWeight: false,
    videoColumn: false,
  };
  it("has no status column: number, reps, effort, weight", () => {
    expect(setGridTemplate(cols)).toBe("34px 1fr 1fr 1.35fr");
  });
  it("adds the video column only when asked", () => {
    expect(setGridTemplate({ ...cols, videoColumn: true })).toBe("34px 1fr 1fr 1.35fr 30px");
    expect(setGridTemplate({ ...cols, videoColumn: true, focusMode: true })).toBe(
      "40px 1fr 1fr 1.35fr 36px",
    );
  });
  it("follows the columns picked", () => {
    expect(
      setGridTemplate({
        ...cols,
        showReps: false,
        showTimer: true,
        showCalories: true,
        hideWeight: true,
      }),
    ).toBe("34px 1fr 1fr 1fr");
  });
});

describe("set video jobs", () => {
  const job = (p: Partial<SetVideoJob>): SetVideoJob => ({
    id: "j",
    userId: "u",
    clientId: "c",
    rowId: "r1",
    dayId: "d",
    resultId: "s1",
    setIndex: 1,
    exerciseName: "Squat",
    dayTitle: "Day 1",
    label: "",
    fileKey: "k",
    fileName: "a.mov",
    state: "uploading",
    progress: 40,
    createdAt: 0,
    ...p,
  });
  it("belong to one logged set, and a sent one leaves", () => {
    const all = [
      job({ id: "a" }),
      job({ id: "b", resultId: "s2" }),
      job({ id: "c", rowId: "r2" }),
      job({ id: "d", state: "done" }),
    ];
    expect(jobsForSet(all, "r1", "s1").map((j) => j.id)).toEqual(["a"]);
    expect(jobsForSet(all, "r1", null)).toEqual([]);
  });
  it("say where they are in plain words", () => {
    expect(isActiveJob(job({}))).toBe(true);
    expect(isActiveJob(job({ state: "failed" }))).toBe(false);
    expect(jobStatusText(job({ progress: 0 }))).toBe("Uploading 1%");
    expect(jobStatusText(job({ progress: 100 }))).toBe("Uploading 99%");
    expect(jobStatusText(job({ state: "failed", autoRetry: true }))).toMatch(/carry on by itself/);
    expect(jobStatusText(job({ state: "failed", needsFile: true }))).toMatch(
      /Pick the video again/,
    );
    expect(jobStatusText(job({ state: "failed", error: "Videos can be up to 10 minutes." }))).toBe(
      "Videos can be up to 10 minutes.",
    );
  });
});

describe("set row: the number is the done button", () => {
  const src = read("src/components/workout-day/WorkoutDayView.tsx");
  it("has no separate status column with a check", () => {
    expect(src).toContain("<SetNumberBadge");
    expect(src).toContain("data-set-done");
    expect(src).not.toMatch(/gridTemplate = `\$\{focusMode \? "28px"/);
    expect(src).not.toContain('"44px"');
  });
  it("keeps automatic completion: the number calls the same save as the old check", () => {
    const at = src.indexOf("data-set-done");
    const near = src.slice(Math.max(0, at - 1200), at + 1200);
    expect(near).toContain("saveCompletionStatus()");
  });
  it("moves Remove a set into the card's ⋯", () => {
    expect(src).toContain('data-testid="card-remove-set"');
    expect(src).toContain("removeSet(n)");
  });
  it("shows the video column for coaching clients only", () => {
    expect(src).toContain('useEntitlement("lift_review") && adapter?.kind !== "member"');
  });
});

describe("set videos: wiring", () => {
  it("keeps the video code out of the logger (lazy)", () => {
    const cell = read("src/components/workout-day/set-video-cell.tsx");
    expect(cell).not.toMatch(/from "@\/lib\/set-videos\/uploader"/);
    expect(cell).not.toMatch(/from "@\/lib\/video-edit/);
    expect(cell).toContain('import("@/components/workout-day/set-video-flow")');
    // never React.lazy: a failed load must not suspend the workout or draw a box in the row
    const code = cell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/lazyWithRetry\(|React\.lazy|\blazy\(/);
    // warmed in the background so a pick works with no signal
    expect(cell).toContain("warmSetVideoCode()");
  });
  it("resumes on launch and clears on sign-out", () => {
    expect(read("src/routes/_authenticated/route.tsx")).toContain("<SetVideoResume />");
    expect(read("src/lib/auth.tsx")).toContain("outboxClearUser(uid)");
  });
  it("is one record and one message per clip, checked by the server", () => {
    const sql = read("supabase/migrations/20270302090000_set_videos.sql");
    expect(sql).toMatch(/UNIQUE INDEX[^;]*client_key/);
    expect(sql).toMatch(/UNIQUE INDEX[^;]*\(client_id, file_key\)[^;]*deleted_at IS NULL/);
    expect(sql).toContain("media_video_allowed");
    expect(sql).toContain("/set-videos/%");
    expect(sql).toContain("rls_evaluate_once('pl_set_videos')");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*pl_set_videos[^;]*authenticated/);
  });
  it("names a set video in the push and the coach inbox", async () => {
    const { messageAction } = await import("@/lib/push/notification-payload");
    expect(messageAction([{ type: "video", set_video: { set: 3 } } as any], true)).toBe(
      "sent you a set video",
    );
    const { deriveInboxWorkflow } = await import("@/lib/inbox-workflow");
    const item = deriveInboxWorkflow({
      lastMessage: {
        sender_role: "client",
        message_type: "Set Video",
        attachments: [{ type: "video", set_video: { set: 1 } }] as any,
      },
    });
    expect(item.detail).toBe("Set video");
  });
});

describe("set video retries", () => {
  it("retries what the connection broke, never what won't change", async () => {
    const { isRetryable, SetVideoRefused, RETRY_DELAYS_MS } =
      await import("@/lib/set-videos/uploader");
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isRetryable(
        new Error(
          "tus: failed to upload chunk at offset 12582912, caused by [object ProgressEvent]",
        ),
      ),
    ).toBe(true);
    expect(isRetryable(new Error("Video can be up to 10 minutes"))).toBe(false);
    expect(
      isRetryable(
        new SetVideoRefused("Set videos go to your coach, and this account has no coach."),
      ),
    ).toBe(false);
    expect(isRetryable(new Error("Upload cancelled"))).toBe(false);
    expect(RETRY_DELAYS_MS[0]).toBeLessThanOrEqual(2_000);
  });
});
