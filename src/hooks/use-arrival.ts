import { useRef } from "react";

/**
 * The class for content that has just replaced its loading placeholder: a quick
 * fade (`jf-arrive`), played once. Content that was already there (from the
 * cache) gets nothing, so a page opened from the cache never waits on an
 * animation.
 */
export function useArrivalClass(loading: boolean): string {
  const waited = useRef(loading);
  if (loading) waited.current = true;
  return !loading && waited.current ? "jf-arrive" : "";
}
