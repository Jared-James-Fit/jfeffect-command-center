/**
 * Lift analyses on this device: the ones running (with how far they've got)
 * and the moment one is saved, so every open sheet and chat card updates
 * without asking the server again and again. In memory only.
 */
import { useSyncExternalStore } from "react";
import type { RunProgress } from "@/lib/lift-analysis/run";

type Running = RunProgress & { setVideoId: string; startedAt: number };

const running = new Map<string, Running>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  subs.forEach((cb) => cb());
};

export function setRunning(setVideoId: string, p: RunProgress | null) {
  if (p)
    running.set(setVideoId, {
      ...p,
      setVideoId,
      startedAt: running.get(setVideoId)?.startedAt ?? Date.now(),
    });
  else running.delete(setVideoId);
  emit();
}

export function getRunning(setVideoId: string): Running | null {
  return running.get(setVideoId) ?? null;
}

export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** The analysis running for this set video on this device, if any. */
export function useRunningAnalysis(setVideoId: string | null | undefined): Running | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return setVideoId ? getRunning(setVideoId) : null;
}

/** Fired (window event) when an analysis is saved or removed, with the set video's id. */
export const LIFT_ANALYSIS_CHANGED = "jf:lift-analysis-changed";

export function announceChanged(setVideoId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIFT_ANALYSIS_CHANGED, { detail: { setVideoId } }));
}
