/* eslint-disable @typescript-eslint/no-explicit-any -- fakes for the supabase realtime client */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { RESUBSCRIBE_DELAY_MS, RESUME_DEBOUNCE_MS, watchTasksRealtime } from "@/lib/tasks-realtime";
import { QUERY_PERSIST_BUSTER, shouldPersistQueryKey } from "@/lib/query-persister";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

function setup() {
  const channels: { name: string; emit: (s: Status) => void; change: () => void; removed: boolean }[] = [];
  const client = {
    channel(name: string) {
      let cb: (s: Status) => void = () => {};
      let onEvent: () => void = () => {};
      const rec = { name, removed: false, emit: (s: Status) => cb(s), change: () => onEvent() };
      channels.push(rec);
      const ch: any = {
        on: (_t: string, _f: unknown, handler: () => void) => { onEvent = handler; return ch; },
        subscribe: (fn: (s: Status) => void) => { cb = fn; return ch; },
        __rec: rec,
      };
      return ch;
    },
    removeChannel(ch: any) { ch.__rec.removed = true; },
  };
  const listeners = new Map<string, Set<() => void>>();
  const target = (visible: { v: string }) => ({
    get visibilityState() { return visible.v; },
    addEventListener: (e: string, fn: () => void) => { (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(fn); },
    removeEventListener: (e: string, fn: () => void) => { listeners.get(e)?.delete(fn); },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  });
  const vis = { v: "visible" };
  const t = target(vis);
  const onChange = vi.fn();
  const stop = watchTasksRealtime({ client: client as any, name: "jf-tasks-rt", table: "tasks", filter: "scope=eq.admin", onChange, doc: t as any, win: t as any });
  const fire = (e: string) => listeners.get(e)?.forEach((fn) => fn());
  return { channels, onChange, stop, fire, vis };
}

describe("tasks realtime keeps every device in step", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("refetches on every change event and once each time it (re)subscribes", () => {
    const { channels, onChange } = setup();
    channels[0].emit("SUBSCRIBED");
    expect(onChange).toHaveBeenCalledTimes(1);
    channels[0].change();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("rebuilds a possibly-dead connection when the app returns to the foreground", () => {
    const { channels, fire, vis, onChange } = setup();
    channels[0].emit("SUBSCRIBED");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS + 1);
    vis.v = "visible";
    fire("visibilitychange");
    expect(channels).toHaveLength(2);
    expect(channels[0].removed).toBe(true);
    channels[1].emit("SUBSCRIBED");
    expect(onChange).toHaveBeenCalledTimes(2); // missed events are caught by the refetch
  });

  it("does not reconnect while hidden, and collapses the burst of events a resume fires", () => {
    const { channels, fire, vis } = setup();
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS + 1);
    vis.v = "hidden";
    fire("visibilitychange");
    expect(channels).toHaveLength(1);
    vis.v = "visible";
    fire("visibilitychange"); fire("focus"); fire("pageshow");
    expect(channels).toHaveLength(2);
  });

  it("retries after an error, timeout or close", () => {
    for (const s of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const) {
      const { channels, stop } = setup();
      channels[0].emit(s);
      vi.advanceTimersByTime(RESUBSCRIBE_DELAY_MS);
      expect(channels).toHaveLength(2);
      stop();
    }
  });

  it("ignores late status events from a replaced channel and stops cleanly", () => {
    const { channels, fire, stop } = setup();
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS + 1);
    fire("online");
    channels[0].emit("CLOSED"); // stale channel must not schedule another reconnect
    vi.advanceTimersByTime(RESUBSCRIBE_DELAY_MS * 2);
    expect(channels).toHaveLength(2);
    stop();
    expect(channels[1].removed).toBe(true);
    fire("online");
    expect(channels).toHaveLength(2);
  });
});

describe("task data is never served from an old disk snapshot", () => {
  it("does not persist task queries, and the cache version was bumped to evict old snapshots", () => {
    expect(shouldPersistQueryKey(["tasks", "admin"])).toBe(false);
    expect(shouldPersistQueryKey(["tasks", "media"])).toBe(false);
    expect(shouldPersistQueryKey(["something-else"])).toBe(true);
    expect(QUERY_PERSIST_BUSTER).not.toBe("v4");
  });

  it("refetches stale queries when the app returns to the foreground", () => {
    expect(readFileSync("src/router.tsx", "utf8")).toContain("refetchOnWindowFocus: true");
  });

  it("the Task Manager uses the resilient realtime watcher", () => {
    const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
    expect(page).toContain("watchTasksRealtime");
    expect(page).not.toContain("supabase.channel(");
  });
});
