import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importWithRetry } from "@/lib/chunk-import";
import { holdChunkRecovery, isChunkLoadError, isChunkRecoveryPaused } from "@/lib/chunk-recovery";

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: /assets/how-to-abc.js");

describe("importWithRetry", () => {
  it("returns the module on the first try without flagging anything", async () => {
    const onStale = vi.fn();
    await expect(importWithRetry(async () => "mod", onStale, 0)).resolves.toBe("mod");
    expect(onStale).not.toHaveBeenCalled();
  });

  it("quietly retries a transient chunk failure", async () => {
    const factory = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce("mod");
    const onStale = vi.fn();
    await expect(importWithRetry(factory, onStale, 0)).resolves.toBe("mod");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("flags a stale build when the retry fails too, and rethrows a chunk error", async () => {
    const factory = vi.fn().mockRejectedValue(chunkError());
    const onStale = vi.fn();
    const err = await importWithRetry(factory, onStale, 0).catch((e) => e);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("does not retry or flag errors that are not chunk failures", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("module threw while evaluating"));
    const onStale = vi.fn();
    await expect(importWithRetry(factory, onStale, 0)).rejects.toThrow("module threw");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(onStale).not.toHaveBeenCalled();
  });

  describe("automatic page reload", () => {
    // Only Date is faked: the pause window is time-based, the retry delay uses real timers.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 60_000); // clear any linger left by earlier tests
    });
    afterEach(() => vi.useRealTimers());

    it("is paused while loading and lingers briefly after", async () => {
      expect(isChunkRecoveryPaused()).toBe(false);
      let seenDuring = false;
      await importWithRetry(async () => {
        seenDuring = isChunkRecoveryPaused();
        return 1;
      }, undefined, 0);
      expect(seenDuring).toBe(true);
      // Vite's preload error event can arrive just after the import settles
      expect(isChunkRecoveryPaused()).toBe(true);
      vi.setSystemTime(Date.now() + 4_000);
      expect(isChunkRecoveryPaused()).toBe(false);
    });

    it("releases a hold exactly once and is never paused forever", () => {
      const release = holdChunkRecovery();
      expect(isChunkRecoveryPaused()).toBe(true);
      release();
      release(); // a double release must not underflow the counter
      vi.setSystemTime(Date.now() + 4_000);
      expect(isChunkRecoveryPaused()).toBe(false);
    });
  });
});

describe("lazy loading contract", () => {
  function walk(dir: string, out: string[] = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("never uses bare React.lazy: every lazy component must survive a failed chunk fetch", () => {
    const root = resolve(process.cwd(), "src");
    const offenders = walk(root).filter((file) => {
      if (file.endsWith("lazy-chunk.tsx") || file.includes("/test/")) return false;
      return /import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("preloads workout action sheets before the first tap", () => {
    const actions = readFileSync(resolve(process.cwd(), "src/components/workout-day/deferred-exercise-actions.tsx"), "utf8");
    expect(actions).toContain("LazyExerciseHowToSheet.preload()");
    expect(actions).toContain("onPointerDown");
    expect(actions).toContain("requestIdleCallback");
  });
});
