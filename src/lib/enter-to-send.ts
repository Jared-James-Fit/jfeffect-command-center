/**
 * Chat composers: on phones/tablets the return key is a normal new line
 * (you tap the send button to send); on a desktop keyboard Enter sends and
 * Shift+Enter adds a new line.
 */
export function isTouchKeyboard(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
}

export function shouldSendOnEnter(e: { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent?.isComposing) return false;
  return !isTouchKeyboard();
}
