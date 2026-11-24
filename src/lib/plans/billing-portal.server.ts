/**
 * The app's own Stripe Customer Portal configuration (billing-portal.ts says
 * why): read it, check it, make it when it's missing or wrong, and open portal
 * sessions with it. Server only; every call takes the service-role client.
 */
import { formEncode, getStripeKeyForMode, stripeFetch, type StripeMode } from "@/lib/stripe.server";
import { checkPortalConfig, PORTAL_CONFIG_TAG, portalConfigParams, readPortalSetting, type PortalCheck } from "@/lib/plans/billing-portal";

type Db = any;
const SETTING_KEY = "stripe_portal_config";

async function readSetting(db: Db): Promise<{ test?: string; live?: string }> {
  const { data } = await db.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
  return readPortalSetting(data?.value);
}

async function writeSetting(db: Db, next: { test?: string; live?: string }) {
  const value = JSON.stringify(next);
  const { data: existing } = await db.from("app_settings").select("id").eq("key", SETTING_KEY).maybeSingle();
  if (existing?.id) await db.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("id", existing.id);
  else await db.from("app_settings").insert({ key: SETTING_KEY, value });
}

export type PortalReport = {
  mode: StripeMode;
  /** The app's own configuration. */
  ours: { id: string | null; check: PortalCheck | null; created: boolean; error: string | null };
  /** Stripe's account default (used by anything that doesn't name a configuration). */
  default: { id: string | null; check: PortalCheck | null };
};

/**
 * Check (and, with `apply`, fix) the portal configuration for one Stripe mode.
 * A wrong or missing configuration is replaced by a new one; Stripe's default
 * is only read, never changed (other tools may rely on it).
 */
export async function ensurePortalConfig(db: Db, mode: StripeMode, opts: { apply: boolean; site?: string }): Promise<PortalReport> {
  const apiKey = getStripeKeyForMode(mode);
  const report: PortalReport = { mode, ours: { id: null, check: null, created: false, error: null }, default: { id: null, check: null } };
  if (!apiKey) {
    report.ours.error = `No Stripe ${mode} key is set`;
    return report;
  }
  try {
    const list = await stripeFetch("/billing_portal/configurations?is_default=true&limit=1", { apiKey });
    const def = list?.data?.[0] ?? null;
    report.default = { id: def?.id ?? null, check: def ? checkPortalConfig(def) : null };
  } catch (e: any) {
    report.default = { id: null, check: null };
    report.ours.error = `Couldn't read the default portal: ${String(e?.message ?? e).slice(0, 160)}`;
  }

  const saved = await readSetting(db);
  let id = saved[mode] ?? null;
  if (id) {
    try {
      const cfg = await stripeFetch(`/billing_portal/configurations/${encodeURIComponent(id)}`, { apiKey });
      report.ours = { id, check: checkPortalConfig(cfg), created: false, error: null };
    } catch (e: any) {
      report.ours = { id, check: null, created: false, error: `Saved configuration couldn't be read: ${String(e?.message ?? e).slice(0, 160)}` };
      id = null;
    }
  }
  if ((!id || !report.ours.check?.ok) && opts.apply) {
    const cfg = await stripeFetch("/billing_portal/configurations", {
      method: "POST",
      apiKey,
      body: formEncode(portalConfigParams(opts.site)),
      idempotencyKey: `${PORTAL_CONFIG_TAG}_${mode}_${new Date().toISOString().slice(0, 10)}`,
    });
    report.ours = { id: cfg.id, check: checkPortalConfig(cfg), created: true, error: null };
    await writeSetting(db, { ...saved, [mode]: cfg.id });
  }
  return report;
}

/** The configuration to open a portal session with (null = none saved yet; Stripe's default is used). */
export async function portalConfigId(db: Db, mode: StripeMode): Promise<string | null> {
  return (await readSetting(db))[mode] ?? null;
}
