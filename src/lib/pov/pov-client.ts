import { toast } from "sonner";
import { askStepUp } from "@/components/pov/pov-start";
import { startPovSessionFn, setPovModeFn, type PovServerState } from "@/lib/pov/pov-session.functions";
import { startStatusWords, type PovMode, type PovSession, type PovStartStatus } from "@/lib/pov/pov-rules";

export function toPovSession(s: PovServerState): PovSession | null {
  if (s.status !== "ok" || !s.id || !s.expires_at || !s.max_until) return null;
  return {
    id: s.id,
    mode: s.mode === "edit" ? "edit" : "view",
    expiresAt: s.expires_at,
    maxUntil: s.max_until,
    editUntil: s.edit_until ?? null,
  };
}

/**
 * Open an account on the server in one tap: view-only unless `mode` is "edit" (logging a
 * session). Nothing is asked for routine access; only switching edits on in an account that
 * isn't an active coaching client asks the staff member to confirm it's them (two-step), and
 * when they don't it opens view-only. Throws when the account can't be opened (no access).
 */
export async function beginPov(clientId: string, opts: { mode?: PovMode } = {}): Promise<PovSession | null> {
  let mode: PovMode = opts.mode ?? "view";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await startPovSessionFn({ data: { clientId, mode } });
    if (out.status === "ok") return toPovSession(out);
    if (out.status === "confirm" && attempt === 0) {
      if (await askStepUp()) continue;
      mode = "view";
      toast.message("Opening view-only. Switch on edits from the bar when you need them.");
      continue;
    }
    if (out.status === "no_two_step" || out.status === "confirm") {
      toast.message(startStatusWords(out.status as PovStartStatus) ?? "Opening view-only.");
      const view = await startPovSessionFn({ data: { clientId, mode: "view" } });
      return toPovSession(view);
    }
    throw new Error(startStatusWords(out.status as PovStartStatus) ?? "Couldn't open the account.");
  }
  return null;
}

/** Edits on (one tap; a fresh two-step only for an account that isn't an active coaching client) or off. */
export async function changePovMode(session: PovSession, mode: PovMode): Promise<PovSession | null> {
  if (mode === "view") {
    const out = await setPovModeFn({ data: { sessionId: session.id, mode: "view" } });
    return toPovSession(out);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await setPovModeFn({ data: { sessionId: session.id, mode: "edit" } });
    if (out.status === "ok") return toPovSession(out);
    if (out.status === "confirm" && attempt === 0 && (await askStepUp())) continue;
    if (out.status === "confirm") return null;
    throw new Error(startStatusWords(out.status as PovStartStatus) ?? "Couldn't switch on edits.");
  }
  return null;
}
