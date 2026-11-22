// Server-only: records that a new account agreed to the Terms and Privacy
// Policy at sign-up (legal-signup.ts). Written with the service role, like
// every acceptance (the database stamps the time and the published text:
// trg_legal_acceptance_stamp, 20270423090000_security_hardening.sql).
//
// Only a document's current published version that isn't waiting on legal
// review can be accepted. A document with no such version is skipped and
// named in `missing`, never invented: the sign-up still asks for the tick,
// and the person is asked again in the app once the document is published
// (listMyLegalStatus, LegalAcceptanceGate).
import { SIGNUP_ACK_TEXT, SIGNUP_LEGAL_SLUGS, type SignupLegalSlug } from "./legal-signup";

export type SignupAcceptanceResult = {
  recorded: SignupLegalSlug[];
  missing: SignupLegalSlug[];
};

export async function recordSignupAcceptances(
  sb: any,
  input: {
    userId: string;
    contextRef?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<SignupAcceptanceResult> {
  const recorded: SignupLegalSlug[] = [];
  const missing: SignupLegalSlug[] = [];

  const { data: docs, error } = await sb
    .from("legal_documents")
    .select("id, slug, archived, current_version_id")
    .in("slug", SIGNUP_LEGAL_SLUGS as unknown as string[]);
  if (error) throw new Error(error.message);

  const { data: clientRow } = await sb
    .from("clients")
    .select("id")
    .eq("user_id", input.userId)
    .maybeSingle();

  for (const slug of SIGNUP_LEGAL_SLUGS) {
    const doc = (docs ?? []).find((d: any) => d.slug === slug && !d.archived);
    if (!doc?.current_version_id) {
      missing.push(slug);
      continue;
    }
    const { data: ver } = await sb
      .from("legal_document_versions")
      .select("id, status, needs_legal_review, body")
      .eq("id", doc.current_version_id)
      .maybeSingle();
    if (!ver || ver.status !== "published" || ver.needs_legal_review) {
      missing.push(slug);
      continue;
    }
    const { error: insErr } = await sb.from("legal_acceptances").insert({
      user_id: input.userId,
      client_id: clientRow?.id ?? null,
      document_id: doc.id,
      version_id: ver.id,
      context: "signup",
      context_ref: input.contextRef ?? null,
      signature_method: "checkbox",
      checkbox_checked: true,
      typed_name: null,
      acknowledgement_text: SIGNUP_ACK_TEXT,
      rendered_snapshot: ver.body,
      ip_address: input.ip ?? null,
      user_agent: input.userAgent ? input.userAgent.slice(0, 400) : null,
    });
    // 23505: already recorded for this version (a retry), which is the same evidence.
    if (insErr && (insErr as any).code !== "23505") throw new Error(insErr.message);
    recorded.push(slug);
  }
  return { recorded, missing };
}

/** The caller's address for the evidence record, best effort (the first forwarded hop). */
export async function requestIp(): Promise<string | null> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const xff = getRequestHeader("cf-connecting-ip") || getRequestHeader("x-forwarded-for");
    const ip = xff?.split(",")[0]?.trim();
    return ip && /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

export async function requestUserAgent(): Promise<string | null> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("user-agent") ?? null;
  } catch {
    return null;
  }
}
