// "View as client" (POV) must be read-only for anything that records what the
// CLIENT has seen. A coach peeking at a client's chat, check-in feedback or
// lift review must not flip "Read" receipts, unread dots or "viewed" stamps,
// or look like the client is online.
//
// This is the lowest-level check, used by the write helpers themselves so every
// caller (thread, bell, review sheets…) is covered. Components that want to
// skip work early use `useViewingAsClient()` from client-impersonation.tsx.

import { supabase } from "@/integrations/supabase/client";

/** Must match STORAGE_KEY in client-impersonation.tsx (a test enforces it). */
export const POV_STORAGE_KEY = "jfeffect.clientPov";

export type PovClient = { id: string; user_id: string | null; full_name: string | null };

export function readPovClient(): PovClient | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(POV_STORAGE_KEY) || window.localStorage.getItem(POV_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PovClient) : null;
  } catch {
    return null;
  }
}

/**
 * True when someone other than the client is viewing as them right now.
 * A real client who signs in on a device where a coach left POV switched on is
 * never treated as POV: only a signed-in user who is NOT the POV client counts.
 * Pass `clientId` to check one specific client's conversation/records.
 */
export async function isViewingAsClient(clientId?: string | null): Promise<boolean> {
  const pov = readPovClient();
  if (!pov) return false;
  if (clientId && pov.id !== clientId) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    return !!uid && uid !== pov.user_id;
  } catch {
    return false;
  }
}
