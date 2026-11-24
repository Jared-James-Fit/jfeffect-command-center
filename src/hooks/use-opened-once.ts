import { useRef } from "react";

/**
 * True from the first render where `open` is true, and from then on (so a
 * sheet or dialog keeps its closing animation and its state). Before that,
 * a closed sheet needn't be mounted at all: every post on Crew carries a few
 * (who liked it, its menu's delete and edit), and mounting them closed made
 * each page of posts that arrived cost far more than the posts themselves
 * (Nov 23 2026).
 */
export function useOpenedOnce(open: boolean): boolean {
  const opened = useRef(false);
  if (open) opened.current = true;
  return opened.current;
}
