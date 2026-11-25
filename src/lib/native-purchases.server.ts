/**
 * Option B on the server (native-purchases.ts, docs/APPLE_IAP_DECISION.md):
 * a request from inside the iPhone app never reaches a paid digital feature
 * (Premium, paid-membership access keys, bought AI credits) for a self-serve
 * member, so it can't be opened by calling the server directly either. Web
 * requests, staff and coaching clients are unchanged. Server only.
 */
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { NATIVE_APP_HEADER, SHELL_STAFF_ROLES, digitalPaidAllowed, isNativeAppRequest } from "@/lib/native-purchases";

/** This request came from the iPhone app (false with no request: a job, a webhook, a test). */
export function nativeAppRequest(): boolean {
  let headers: Headers | undefined;
  try {
    headers = getRequest()?.headers;
  } catch {
    return false;
  }
  if (!headers) return false;
  return isNativeAppRequest({ userAgent: headers.get("user-agent"), nativeHeader: headers.get(NATIVE_APP_HEADER) });
}

/** Whether this request may use paid digital features for `userId` (always true on the web). */
export async function digitalPaidAllowedFor(userId: string): Promise<boolean> {
  if (!nativeAppRequest()) return true;
  const db = supabaseAdmin as any;
  const [{ data: roles }, { data: client }] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", userId),
    db.from("clients").select("service_tier").eq("user_id", userId).maybeSingle(),
  ]);
  const staff = ((roles ?? []) as Array<{ role: string }>).some((r) => SHELL_STAFF_ROLES.includes(r.role));
  const tier = client?.service_tier === "coaching" ? "coaching" : client?.service_tier === "self_serve" ? "self_serve" : null;
  return digitalPaidAllowed({ native: true, staff, tier });
}
