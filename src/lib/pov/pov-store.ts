import { classifyDbRequest, POV_MODE_HEADER, POV_SESSION_HEADER, POV_VIEW_ONLY_MESSAGE, povPath, type PovSession } from "@/lib/pov/pov-rules";

/**
 * The open account view on this tab, outside React, so the server-call middleware and the fetch
 * guard can read it. The impersonation provider keeps it in step (client-impersonation.tsx).
 */
type Listener = () => void;
let current: PovSession | null = null;
/** An account view is open on this tab but the server hasn't answered yet: view-only meanwhile. */
let pending = false;
const listeners = new Set<Listener>();

export type PovEvent = { kind: "view" | "write" | "blocked"; path?: string; method?: string; target?: string | null; at: string };
let buffer: PovEvent[] = [];

export function setPovSession(s: PovSession | null) {
  current = s;
  for (const l of listeners) l();
}
export function getPovSession(): PovSession | null {
  return current;
}
/** While the view is opening (no session yet), writes are stopped like view-only. */
export function setPovPending(on: boolean) {
  pending = on;
}
export function subscribePov(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Edits on right now (switched on and not run out). */
export function povEditing(s: PovSession | null = current, now = Date.now()): boolean {
  return !!s && s.mode === "edit" && !!s.editUntil && Date.parse(s.editUntil) > now;
}

/** Headers every server call carries while a view is open (src/start.ts reads them). */
export function povHeaders(): Record<string, string> {
  if (!current) return {};
  return { [POV_SESSION_HEADER]: current.id, [POV_MODE_HEADER]: povEditing() ? "edit" : "view" };
}

export function recordPovEvent(e: Omit<PovEvent, "at">) {
  if (!current) return;
  buffer.push({ ...e, at: new Date().toISOString() });
  if (buffer.length > 200) buffer = buffer.slice(-200);
}
export function recordPovPage(pathname: string) {
  const last = [...buffer].reverse().find((e) => e.kind === "view");
  const path = povPath(pathname);
  if (last?.path === path) return;
  recordPovEvent({ kind: "view", path });
}
/** Take what's waiting to be sent (60 at most a call). */
export function takePovEvents(max = 60): PovEvent[] {
  const out = buffer.slice(0, max);
  buffer = buffer.slice(max);
  return out;
}
export function putBackPovEvents(events: PovEvent[]) {
  buffer = [...events, ...buffer].slice(-200);
}

let installed = false;
/**
 * Stops direct database writes while the view is view-only (they'd be made with the staff
 * member's own sign-in), and notes the ones made with edits on. Installed once, in the browser.
 */
export function installPovFetchGuard(dbBase: string | undefined) {
  if (installed || typeof window === "undefined" || !dbBase) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!current && !pending) return original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(dbBase)) return original(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const c = classifyDbRequest(url, method);
    if (!c || c.kind === "read") return original(input, init);
    if (!current || !povEditing()) {
      if (current) recordPovEvent({ kind: "blocked", method, target: c.target });
      return new Response(JSON.stringify({ code: "42501", message: POV_VIEW_ONLY_MESSAGE, details: null, hint: null }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    recordPovEvent({ kind: "write", method, target: c.target });
    return original(input, init);
  };
}
