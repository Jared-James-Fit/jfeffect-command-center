/**
 * Stripe's billing page (the Customer Portal), as JF Effect uses it (Nov 24 2026).
 *
 * Clients update their card and billing details and read invoices and
 * receipts there. Plans are never changed or cancelled there: that happens in
 * the app (Account → Your plan), so the app and Stripe can't disagree about a
 * subscription. Stripe's default portal configuration is account-wide and may
 * allow both, so the app keeps its own configuration (these params) and opens
 * every portal session with it.
 *
 * Pure: the params and the check of a configuration Stripe returns.
 */

export const PORTAL_CONFIG_TAG = "jf_billing_details_v1";

export function portalConfigParams(site = "https://jfeffect.com"): Record<string, string> {
  return {
    // Stripe allows 60 characters
    "business_profile[headline]": "JF Effect billing. Change your plan in the app.",
    "business_profile[privacy_policy_url]": `${site}/privacy`,
    "business_profile[terms_of_service_url]": `${site}/coaching-agreement`,
    default_return_url: `${site}/portal/plan`,
    "features[payment_method_update][enabled]": "true",
    "features[invoice_history][enabled]": "true",
    "features[customer_update][enabled]": "true",
    "features[customer_update][allowed_updates][0]": "email",
    "features[customer_update][allowed_updates][1]": "name",
    "features[customer_update][allowed_updates][2]": "address",
    "features[customer_update][allowed_updates][3]": "phone",
    "features[customer_update][allowed_updates][4]": "tax_id",
    "features[subscription_cancel][enabled]": "false",
    "features[subscription_update][enabled]": "false",
    "metadata[jf_portal]": PORTAL_CONFIG_TAG,
  };
}

export type PortalCheck = {
  ok: boolean;
  /** What's wrong, in words (empty when ok). */
  problems: string[];
  features: {
    paymentMethodUpdate: boolean;
    invoiceHistory: boolean;
    customerUpdate: boolean;
    subscriptionCancel: boolean;
    subscriptionUpdate: boolean;
  };
};

/** Does a portal configuration Stripe returned do what the app needs (and nothing more)? */
export function checkPortalConfig(cfg: any): PortalCheck {
  const f = cfg?.features ?? {};
  const features = {
    paymentMethodUpdate: !!f.payment_method_update?.enabled,
    invoiceHistory: !!f.invoice_history?.enabled,
    customerUpdate: !!f.customer_update?.enabled,
    subscriptionCancel: !!f.subscription_cancel?.enabled,
    subscriptionUpdate: !!f.subscription_update?.enabled,
  };
  const problems: string[] = [];
  if (!cfg?.active) problems.push("the configuration is inactive");
  if (!features.paymentMethodUpdate) problems.push("clients can't update their card");
  if (!features.invoiceHistory) problems.push("clients can't see invoices and receipts");
  if (!features.customerUpdate) problems.push("clients can't update billing details");
  if (features.subscriptionCancel) problems.push("clients can cancel in Stripe (plans must change in the app)");
  if (features.subscriptionUpdate) problems.push("clients can switch plans in Stripe (plans must change in the app)");
  return { ok: problems.length === 0, problems, features };
}

/** app_settings 'stripe_portal_config': the configuration id per Stripe mode. */
export function readPortalSetting(raw: string | null | undefined): { test?: string; live?: string } {
  try {
    const v = JSON.parse(String(raw ?? "{}"));
    const out: { test?: string; live?: string } = {};
    if (typeof v?.test === "string" && v.test.startsWith("bpc_")) out.test = v.test;
    if (typeof v?.live === "string" && v.live.startsWith("bpc_")) out.live = v.live;
    return out;
  } catch {
    return {};
  }
}
