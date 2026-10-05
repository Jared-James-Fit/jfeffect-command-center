import { useCallback } from "react";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * Args for portal server functions so coach "View as client" reads the
 * viewed client's data. Empty object when not impersonating.
 */
export function usePovArgs(): { viewAsUserId?: string; viewAsClientId?: string } {
  const { client } = useClientImpersonation();
  if (!client) return {};
  return {
    ...(client.user_id ? { viewAsUserId: client.user_id } : {}),
    viewAsClientId: client.id,
  };
}

/** Wrap a server fn so every call carries the POV args in `data`. */
export function usePovFn<F extends (args: any) => any>(fn: F): F {
  const pov = usePovArgs();
  const uid = pov.viewAsUserId;
  const cid = pov.viewAsClientId;
  return useCallback(
    ((args?: { data?: Record<string, unknown> }) =>
      fn({
        ...(args ?? {}),
        data: { ...(args?.data ?? {}), ...(uid ? { viewAsUserId: uid } : {}), ...(cid ? { viewAsClientId: cid } : {}) },
      })) as F,
    [fn, uid, cid],
  );
}
