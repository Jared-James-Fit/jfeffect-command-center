/**
 * The server's check before anyone's personal data reaches an AI model
 * (consent.ts has the rules and the words). Fails closed: if the answer
 * can't be read, nothing is sent.
 *
 *   await requireOwnAiConsent(userId);      // the person's own AI feature
 *   await requireClientAiConsent(clientId); // coach-side drafting from a client's records
 *
 * Staff logins always pass (their own data, their own work); a client record
 * with no login is the coach's own record keeping and passes too
 * (`ai_consent_ok_for_client`).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AI_CONSENT_VERSION, coachConsentMessage, selfConsentMessage } from "./consent";

export class AiConsentError extends Error {
  readonly aiConsent = true;
}

export async function userAllowsAi(userId: string): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any).rpc("ai_consent_ok", { _user: userId, _version: AI_CONSENT_VERSION });
  if (error) {
    console.error("[ai-consent] check failed", { message: error.message });
    return false;
  }
  return data === true;
}

export async function clientAllowsAi(clientId: string): Promise<{ ok: boolean; name: string | null }> {
  const { data, error } = await (supabaseAdmin as any).rpc("ai_consent_ok_for_client", { _client: clientId, _version: AI_CONSENT_VERSION });
  if (error) {
    console.error("[ai-consent] client check failed", { message: error.message });
    return { ok: false, name: null };
  }
  return { ok: data?.ok === true, name: (data?.name as string | null) ?? null };
}

/** The signed-in person's own AI feature: refused with a message the app turns into its inline request (useAiConsentInline). */
export async function requireOwnAiConsent(userId: string): Promise<void> {
  if (!(await userAllowsAi(userId))) throw new AiConsentError(selfConsentMessage());
}

/** Coach-side work on a client's records: refused with words for the coach. */
export async function requireClientAiConsent(clientId: string): Promise<void> {
  const r = await clientAllowsAi(clientId);
  if (!r.ok) throw new AiConsentError(coachConsentMessage(r.name));
}
