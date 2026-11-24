import { describe, expect, it } from "vitest";
import {
  LOAD_TIMING,
  bytesWords,
  combineQueryViews,
  describeLoadError,
  elapsedClock,
  loadErrorKind,
  loadPhase,
  nextPhaseAt,
  queryRetryDelay,
  queryView,
  shouldRetryQuery,
  uploadWords,
} from "@/lib/loading/load-state";

const pg = (code: string, message = "x") => ({ code, message, details: null, hint: null });

describe("a wait's phase is time measured, never made up", () => {
  it("shows nothing for an instant answer, then loading, slow and stalled", () => {
    expect(loadPhase(0)).toBe("instant");
    expect(loadPhase(LOAD_TIMING.showAfterMs - 1)).toBe("instant");
    expect(loadPhase(LOAD_TIMING.showAfterMs)).toBe("loading");
    expect(loadPhase(LOAD_TIMING.slowAfterMs)).toBe("slow");
    expect(loadPhase(LOAD_TIMING.stalledAfterMs)).toBe("stalled");
    expect(loadPhase(Number.NaN)).toBe("instant");
  });
  it("names the next change so a hook needs one timer", () => {
    expect(nextPhaseAt(0)).toBe(LOAD_TIMING.showAfterMs);
    expect(nextPhaseAt(LOAD_TIMING.showAfterMs)).toBe(LOAD_TIMING.slowAfterMs);
    expect(nextPhaseAt(LOAD_TIMING.slowAfterMs + 1)).toBe(LOAD_TIMING.stalledAfterMs);
    expect(nextPhaseAt(LOAD_TIMING.stalledAfterMs)).toBeNull();
  });
});

describe("failures in plain words", () => {
  it("reads the kind from status, code and words", () => {
    expect(loadErrorKind(new TypeError("Failed to fetch"))).toBe("network");
    expect(loadErrorKind(new TypeError("Load failed"))).toBe("network"); // Safari
    expect(loadErrorKind(new Error("NetworkError when attempting to fetch resource."))).toBe("network");
    expect(loadErrorKind(new Error("anything"), false)).toBe("offline");
    expect(loadErrorKind(pg("57014", "canceling statement due to statement timeout"))).toBe("timeout");
    expect(loadErrorKind(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timeout");
    expect(loadErrorKind(pg("42501", "permission denied for table clients"))).toBe("forbidden");
    expect(loadErrorKind(pg("PGRST301", "JWT expired"))).toBe("session");
    expect(loadErrorKind(pg("PGRST116", "JSON object requested, multiple (or no) rows returned"))).toBe("not_found");
    expect(loadErrorKind({ status: 429, message: "slow down" })).toBe("rate");
    expect(loadErrorKind({ context: { status: 502 }, message: "x" })).toBe("server");
    expect(loadErrorKind(new Error("Internal Server Error"))).toBe("server");
    expect(loadErrorKind(new Error("Column foo is ambiguous"))).toBe("other");
    expect(loadErrorKind(null)).toBe("other");
  });
  it("never shows a database code or stack to the person", () => {
    const words = describeLoadError(pg("42P01", 'relation "x" does not exist'), { what: "your sales" });
    expect(words.title).toBe("Couldn't load your sales");
    expect(JSON.stringify(words)).not.toContain("42P01");
    expect(JSON.stringify(words)).not.toContain("relation");
    expect(words.retryable).toBe(true);
  });
  it("offers Try again only where it can help", () => {
    expect(describeLoadError(pg("42501", "permission denied")).retryable).toBe(false);
    expect(describeLoadError(pg("PGRST116")).retryable).toBe(false);
    expect(describeLoadError(new TypeError("Failed to fetch")).retryable).toBe(true);
    expect(describeLoadError(new Error("x"), { online: false })).toMatchObject({ kind: "offline", title: "You're offline" });
  });
});

describe("the query client retries what can get better, and only that", () => {
  it("never retries something that can only fail again", () => {
    expect(shouldRetryQuery(0, pg("42501", "permission denied"))).toBe(false);
    expect(shouldRetryQuery(0, pg("PGRST116"))).toBe(false);
    expect(shouldRetryQuery(0, { status: 400, message: "bad request" })).toBe(false);
    expect(shouldRetryQuery(0, { status: 422, message: "invalid" })).toBe(false);
  });
  it("gives a dropped connection, a timeout or a server hiccup two more tries", () => {
    for (const err of [new TypeError("Failed to fetch"), pg("57014", "statement timeout"), { status: 503, message: "x" }, { status: 429, message: "x" }]) {
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(1, err)).toBe(true);
      expect(shouldRetryQuery(2, err)).toBe(false);
    }
  });
  it("keeps the old single retry for anything else", () => {
    expect(shouldRetryQuery(0, new Error("odd"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("odd"))).toBe(false);
  });
  it("backs off 1 s, 2 s, 4 s, capped at 8 s", () => {
    const none = () => 0;
    expect([0, 1, 2, 3, 9].map((i) => queryRetryDelay(i, none))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(queryRetryDelay(0, () => 1)).toBeLessThanOrEqual(1250);
  });
});

const q = (over: Partial<{ status: "pending" | "error" | "success"; fetchStatus: "fetching" | "paused" | "idle"; data: any; error: unknown }>) => ({
  status: "pending" as const,
  fetchStatus: "fetching" as const,
  data: undefined,
  error: null,
  ...over,
});

describe("a query read as what to show", () => {
  it("is loading while the first read runs", () => {
    expect(queryView(q({})).kind).toBe("loading");
  });
  it("is offline (never an endless spinner) while a first read waits for a connection", () => {
    expect(queryView(q({ fetchStatus: "paused" })).kind).toBe("offline");
  });
  it("is an error, never an empty list, when the read failed with nothing to show", () => {
    expect(queryView(q({ status: "error", fetchStatus: "idle", error: new Error("x") })).kind).toBe("error");
    // ...but while Try again runs it reads as loading again
    expect(queryView(q({ status: "error", fetchStatus: "fetching", error: new Error("x") })).kind).toBe("loading");
  });
  it("keeps data on screen when a refresh fails or waits offline, and says so", () => {
    const failed = queryView(q({ status: "error", fetchStatus: "idle", data: [1], error: new Error("x") }));
    expect(failed).toEqual({ kind: "ready", refreshing: false, refreshFailed: true });
    expect(queryView(q({ status: "success", fetchStatus: "paused", data: [1] })).kind).toBe("ready");
    expect(queryView(q({ status: "success", fetchStatus: "fetching", data: [1] })).refreshing).toBe(true);
  });
  it("is empty only when the answer really is empty", () => {
    const isEmpty = (d: number[]) => d.length === 0;
    expect(queryView(q({ status: "success", fetchStatus: "idle", data: [] }), isEmpty).kind).toBe("empty");
    expect(queryView(q({ status: "success", fetchStatus: "idle", data: [1] }), isEmpty).kind).toBe("ready");
    expect(queryView(q({ status: "success", fetchStatus: "idle", data: [] })).kind).toBe("ready");
  });
  it("reads several queries as one: a problem first, then loading, then data", () => {
    const ready = { kind: "ready" as const, refreshing: false, refreshFailed: false };
    const loading = { kind: "loading" as const, refreshing: false, refreshFailed: false };
    const error = { kind: "error" as const, refreshing: false, refreshFailed: false };
    const empty = { kind: "empty" as const, refreshing: false, refreshFailed: false };
    expect(combineQueryViews([ready, loading]).kind).toBe("loading");
    expect(combineQueryViews([loading, error]).kind).toBe("error");
    expect(combineQueryViews([ready, empty]).kind).toBe("ready");
    expect(combineQueryViews([empty, empty]).kind).toBe("empty");
    expect(combineQueryViews([ready, { ...ready, refreshFailed: true }]).refreshFailed).toBe(true);
  });
});

describe("long work is said in real numbers", () => {
  it("counts the time it's been at it", () => {
    expect(elapsedClock(0)).toBe("0:00");
    expect(elapsedClock(42_400)).toBe("0:42");
    expect(elapsedClock(185_000)).toBe("3:05");
    expect(elapsedClock(3_730_000)).toBe("1:02:10");
  });
  it("says an upload's real bytes, or nothing when its size is unknown", () => {
    expect(bytesWords(740 * 1024)).toBe("740 KB");
    expect(bytesWords(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(uploadWords(4.2 * 1024 * 1024, 10 * 1024 * 1024)).toBe("4.2 MB of 10.0 MB · 42%");
    expect(uploadWords(5, 0)).toBeNull();
    expect(uploadWords(20, 10)).toBe("1 KB of 1 KB · 100%");
  });
});
