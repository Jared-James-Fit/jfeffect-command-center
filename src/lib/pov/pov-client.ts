import { toast } from "sonner";
import { askPovReason, askStepUp } from "@/components/pov/pov-start";
import { startPovSessionFn, setPovModeFn, type PovServerState } from "@/lib/pov/pov-session.functions";
import { startStatusWords, type PovMode, type PovSession } from "@/lib/pov/pov-rules";

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
 * Start an account view on the server: asks why (unless the caller already knows, e.g. "Log a
 * session"), then asks the staff member to confirm it's them when edits in a member's account
 * need it. Falls back to view-only when edits can't be switched on. Null when cancelled.
 */
export async function beginPov(
  clientId: string,
  name: string | null,
  opts: { reason?: string; mode?: PovMode } = {},
): Promise<PovSession | null> {
  let reason = opts.reason;
  let mode: PovMode = opts.mode ?? "view";
  if (!reason) {
    const picked = await askPovReason(name);
    if (!picked) return null;
    reason = picked.reason;
    mode = picked.mode;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await startPovSessionFn({ data: { clientId, reason, mode } });
    if (out.status === "ok") return toPovSession(out);
    if (out.status === "confirm" && attempt === 0) {
      if (await askStepUp()) continue;
      mode = "view";
      toast.message("Opening view-only. Switch on edits from the bar when you need them.");
      continue;
    }
    if (out.status === "no_two_step" || out.status === "confirm") {
      toast.message(startStatusWords(out.status as any) ?? "Opening view-only.");
      const view = await startPovSessionFn({ data: { clientId, reason, mode: "view" } });
      return toPovSession(view);
    }
    throw new Error(startStatusWords(out.status as any) ?? "Couldn't open the account.");
  }
  return null;
}

/** Switch edits on (asks why, and to confirm it's them for a member's account) or off. */
export async function changePovMode(session: PovSession, mode: PovMode, name: string | null): Promise<PovSession | null> {
  if (mode === "view") {
    const out = await setPovModeFn({ data: { sessionId: session.id, mode: "view" } });
    return toPovSession(out);
  }
  const picked = await askPovReason(name, { forEdit: true });
  if (!picked) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await setPovModeFn({ data: { sessionId: session.id, mode: "edit", reason: picked.reason } });
    if (out.status === "ok") return toPovSession(out);
    if (out.status === "confirm" && attempt === 0 && (await askStepUp())) continue;
    throw new Error(startStatusWords(out.status as any) ?? "Couldn't switch on edits.");
  }
  return null;
}
