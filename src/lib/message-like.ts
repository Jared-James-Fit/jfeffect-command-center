import { useRef, useState } from "react";

/**
 * Liking a message, Instagram style (the coach chat and the group / 1:1
 * chats): a double-tap leaves your reaction on it as the heart (it adds one,
 * or switches yours to it) and never takes it back; tapping the heart under
 * the message is how you remove it. Each double-tap springs the heart in.
 */

/** Whether a double-tap has to change anything: not when your reaction is already `emoji`. */
export function doubleTapAdds(mine: { emoji: string }[], emoji: string): boolean {
  return !mine.some((r) => r.emoji === emoji);
}

/** A touch double-tap and the browser's own dblclick can both arrive: one like per message in this window. */
export const LIKE_REPEAT_MS = 400;

/**
 * Which messages were just double-tapped (message id → how many times), so
 * their heart can spring in again on every double-tap. `pop` returns false
 * for the repeat of the same tap.
 */
export function useLikePops() {
  const [pops, setPops] = useState<Record<string, number>>({});
  const last = useRef(new Map<string, number>());
  const pop = (id: string): boolean => {
    const now = Date.now();
    if (now - (last.current.get(id) ?? 0) < LIKE_REPEAT_MS) return false;
    last.current.set(id, now);
    setPops((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
    return true;
  };
  return { pops, pop };
}
