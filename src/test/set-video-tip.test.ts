import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SET_VIDEO_TIP_GAP_MS,
  SET_VIDEO_TIP_MAX,
  claimSetVideoTip,
  releaseSetVideoTip,
  setVideoTipCopy,
  setVideoTipDue,
} from "@/lib/set-videos/tip";

const now = Date.parse("2026-11-12T18:00:00Z");
const base = { count: 0, lastAt: null, hasSent: false, coachFirst: "Jared" };

describe("when the set video point-out shows", () => {
  it("shows to a client who has never filmed a set", () => {
    expect(setVideoTipDue(base, now)).toBe(true);
  });
  it("never once they've sent a set video", () => {
    expect(setVideoTipDue({ ...base, hasSent: true }, now)).toBe(false);
  });
  it("at most once a training day, on any phone", () => {
    const lastAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    expect(setVideoTipDue({ ...base, count: 1, lastAt }, now)).toBe(false);
    const yesterday = new Date(now - SET_VIDEO_TIP_GAP_MS - 1000).toISOString();
    expect(setVideoTipDue({ ...base, count: 1, lastAt: yesterday }, now)).toBe(true);
  });
  it("stops by itself after a few days", () => {
    expect(setVideoTipDue({ ...base, count: SET_VIDEO_TIP_MAX }, now)).toBe(false);
  });
  it("a read that failed means no bubble", () => {
    expect(setVideoTipDue(null, now)).toBe(false);
  });
  it("one bubble per app open, handed on when it didn't show", () => {
    releaseSetVideoTip();
    expect(claimSetVideoTip()).toBe(true);
    expect(claimSetVideoTip()).toBe(false);
    releaseSetVideoTip();
    expect(claimSetVideoTip()).toBe(true);
    releaseSetVideoTip();
  });
  it("names the coach when we know them", () => {
    expect(setVideoTipCopy("Jared").title).toBe("Film your sets for Jared");
    expect(setVideoTipCopy(null).title).toBe("Film your sets for your coach");
    expect(setVideoTipCopy("Jared").body).toContain("Jared gets it in your chat");
  });
});

describe("the point-out in the set row", () => {
  const cell = readFileSync("src/components/workout-day/set-video-cell.tsx", "utf8");
  const tip = readFileSync("src/lib/set-videos/tip.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20270306090000_set_video_tip.sql", "utf8");
  it("shows only the moment a set is logged, never on sets logged before the workout opened", () => {
    expect(cell).toContain("const wasLogged = useRef(logged);");
    expect(cell).toContain("if (was || !logged) return;");
  });
  it("Film this set opens the phone's picker from that tap", () => {
    expect(cell).toMatch(/Film this set/);
    expect(cell).toMatch(/setTipOpen\(false\);\s*\/\/ the phone's picker opens from this tap\s*openPicker\(\);/);
  });
  it("never to a coach viewing as the client, and kept on the account, not the phone", () => {
    expect(tip).toContain("const on = enabled && !viewingAsClient && !!userId && !!clientId;");
    expect(tip).toContain('db.rpc("workout_view_set_video_tip_shown")');
    expect(tip).not.toContain("localStorage");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS set_video_tip_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.workout_view_set_video_tip_shown() TO authenticated;");
  });
});
