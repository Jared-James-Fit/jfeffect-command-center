// ============================================================================
// Membership Launch Gate (Phase 4)
//
// One server-side resolver consumed by:
//   - /join (to render the controlled "checkout temporarily unavailable" state
//     and to know which legal versions to require)
//   - createJfSignupCheckout (to refuse session creation when launch criteria
//     aren't met)
//   - Admin Launch Readiness panel
//
// Never returns secrets or internal config. When blocked, members only see
// the generic "Membership checkout is temporarily unavailable." message;
// admins (via the dedicated authed call) get itemized blockers.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LaunchRequiredDoc = {
  document_id: string;
  version_id: string;
  slug: string;
  title: string;
  version_number: number;
  summary: string | null;
  doc_type: string;
  public_read_allowed: boolean;
};

export type LaunchGateResult = {
  ok: boolean;
  /** Member-safe message. Always the same generic string when blocked. */
  message: string | null;
  /** Required legal documents that DO have a current published version. */
  required_docs: LaunchRequiredDoc[];
  /** Set only when the caller is admin (server-side rechecked). */
  admin_blockers?: string[];
};

const GENERIC_BLOCK_MSG = "Membership checkout is temporarily unavailable.";

/**
 * Internal resolver. Reachable from other server fns; never exported as RPC.
 * Returns the full picture so the caller can decide what to expose.
 */
export async function resolveMembershipLaunchGate(opts: { admin: boolean }): Promise<LaunchGateResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const blockers: string[] = [];

  // 1) Stripe monthly price configured?
  const { data: settings } = await supabaseAdmin
    .from("jf_membership_settings")
    .select("monthly_price_id, support_email, refund_policy, trial_days")
    .eq("id", true)
    .maybeSingle();
  if (!settings?.monthly_price_id) blockers.push("Stripe monthly price not configured");
  if (!settings?.support_email) blockers.push("Support email not configured");

  // 2) Required legal documents at the membership_checkout placement.
  //    We require the canonical 5 slugs; each must have a current published version.
  const REQUIRED_SLUGS = [
    "terms-of-service",
    "privacy-policy",
    "membership-agreement",
    "recurring-billing-disclosure",
    "cancellation-and-refund-policy",
  ];

  const { data: rows, error } = await supabaseAdmin
    .from("v_membership_checkout_legal")
    .select("*");
  if (error) {
    blockers.push(`Legal placement read failed: ${error.message}`);
    return {
      ok: false,
      message: GENERIC_BLOCK_MSG,
      required_docs: [],
      admin_blockers: opts.admin ? blockers : undefined,
    };
  }

  const bySlug = new Map<string, any>((rows ?? []).map((r: any) => [r.slug, r]));
  const required_docs: LaunchRequiredDoc[] = [];

  for (const slug of REQUIRED_SLUGS) {
    const r = bySlug.get(slug);
    if (!r) { blockers.push(`Missing membership-checkout placement: ${slug}`); continue; }
    if (!r.current_version_id || r.current_version_status !== "published") {
      blockers.push(`${r.title}: no published current version`);
      continue;
    }
    // Public-read must be on for Terms / Privacy / Cancellation policy so the
    // links shown at /join (and inside the disclosure card) actually render.
    const mustBePublic = ["terms-of-service", "privacy-policy", "cancellation-and-refund-policy"];
    if (mustBePublic.includes(slug) && !r.public_read_allowed) {
      blockers.push(`${r.title}: public_read_allowed must be enabled`);
    }
    required_docs.push({
      document_id: r.document_id,
      version_id: r.current_version_id,
      slug: r.slug,
      title: r.title,
      version_number: r.current_version_number,
      summary: null,
      doc_type: r.doc_type,
      public_read_allowed: !!r.public_read_allowed,
    });
  }

  const ok = blockers.length === 0;
  return {
    ok,
    message: ok ? null : GENERIC_BLOCK_MSG,
    required_docs,
    admin_blockers: opts.admin ? blockers : undefined,
  };
}

/** Public (anon) launch gate — only returns ok flag, generic message, and required doc list. */
export const getMembershipLaunchGate = createServerFn({ method: "GET" }).handler(async () => {
  const r = await resolveMembershipLaunchGate({ admin: false });
  // Strip admin-only fields defensively.
  return {
    ok: r.ok,
    message: r.message,
    required_docs: r.required_docs,
  };
});

/** Admin launch gate — includes itemized blockers. Admin-gated. */
export const getAdminMembershipLaunchGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error } = await (context as any).supabase.rpc("has_role", {
      _user_id: (context as any).userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    if (!isAdmin) throw new Error("Forbidden");
    return resolveMembershipLaunchGate({ admin: true });
  });