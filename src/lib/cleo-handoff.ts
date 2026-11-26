/**
 * Hand words to a client's Training, Nutrition or Cardio Cleo dock from another
 * screen (a meeting's approved recommendation, Nov 25 2026): kept for this tab
 * until that dock opens, then put in its box for the coach to read, change and
 * send. Never sent or applied on its own; the plan's own editor (Adjust
 * program, Adjust plan, the cardio draft) still shows every change first.
 */
import { useEffect } from "react";

export type HandoffArea = "training" | "nutrition" | "cardio";
export const CLEO_HANDOFF_EVENT = "jf:cleo-handoff";
const key = (clientId: string, area: HandoffArea) => `jf.cleo-handoff:${clientId}:${area}`;

export function handOffToCleo(clientId: string, area: HandoffArea, text: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(clientId, area), JSON.stringify({ text, at: Date.now() }));
  } catch {
    /* private mode: the event still reaches a dock that's open */
  }
  window.dispatchEvent(new CustomEvent(CLEO_HANDOFF_EVENT, { detail: { clientId, area, text } }));
}

/** Words waiting for this dock (taken once; an hour old at most). */
export function takeHandoff(clientId: string, area: HandoffArea): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(clientId, area));
    if (!raw) return null;
    sessionStorage.removeItem(key(clientId, area));
    const v = JSON.parse(raw);
    return typeof v?.text === "string" && Date.now() - Number(v.at ?? 0) < 3_600_000 ? v.text : null;
  } catch {
    return null;
  }
}

/** A dock takes what's waiting for it when it mounts, and anything handed over while it's open. */
export function useCleoHandoff(clientId: string | null | undefined, area: HandoffArea, ask: (text: string) => void) {
  useEffect(() => {
    if (!clientId) return;
    const waiting = takeHandoff(clientId, area);
    if (waiting) ask(waiting);
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ clientId: string; area: HandoffArea; text: string }>).detail;
      if (!d || d.clientId !== clientId || d.area !== area) return;
      takeHandoff(clientId, area);
      ask(d.text);
    };
    window.addEventListener(CLEO_HANDOFF_EVENT, on);
    return () => window.removeEventListener(CLEO_HANDOFF_EVENT, on);
  }, [clientId, area, ask]);
}
