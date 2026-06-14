/**
 * Admin-only feature flags backed by localStorage.
 *
 * Slice 3 of the multi-block exercise editor is gated behind
 * `pl-multi-block-builder`. With the flag off (the production default)
 * the builder shows no new UI and behaves exactly as before. With it
 * on, each exercise row exposes a "Blocks" button that opens the new
 * normalized-schema editor (see `<ExerciseBlocksEditor />`).
 *
 * To enable in DevTools:
 *   localStorage.setItem("pl-multi-block-builder", "1");
 *   window.dispatchEvent(new Event("pl-flags-changed"));
 */
import { useEffect, useState } from "react";

const FLAG_EVENT = "pl-flags-changed";

export const PL_FLAGS = {
  multiBlockBuilder: "pl-multi-block-builder",
} as const;

function read(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setFlag(key: string, on: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
    window.dispatchEvent(new Event(FLAG_EVENT));
  } catch {
    /* noop */
  }
}

export function useFlag(key: string): boolean {
  const [on, setOn] = useState<boolean>(() => read(key));
  useEffect(() => {
    const handler = () => setOn(read(key));
    window.addEventListener(FLAG_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(FLAG_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [key]);
  return on;
}

export function useMultiBlockBuilderFlag(): boolean {
  return useFlag(PL_FLAGS.multiBlockBuilder);
}