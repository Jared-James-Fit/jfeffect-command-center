/**
 * After coaching starts for someone new to it (a site checkout or a free
 * member's own purchase), once Stripe's signed webhook says it's paid and
 * applyChange has moved the package, the tier and the coach (plans.server.ts
 * calls this only from the run that marked the change applied; the CRM row's
 * dedupe key makes a second run a no-op). Never from a success page.
 *
 *  - the lead becomes a client (New Client, active_client, converted_at)
 *  - their application is closed as bought, on the Leads page
 *  - an account: the coach's own setup email, when there's no login yet
 *  - a welcome email saying what they bought and what happens next
 *  - the onboarding checklist is the app's own (SetupChecklistBanner on Home,
 *    leading with the Coaching Agreement), shown once they're a coaching client
 *  - the coach and the admin were already told by notifyPlanChange("started")
 */
import { onboardingSteps } from "./onboarding";

type Db = any;

export async function afterCoachingStart(db: Db, change: Record<string, any>): Promise<{ done: boolean }> {
  const { data: client } = await db
    .from("clients")
    .select("id, user_id, email, first_name, full_name, status, lifecycle_stage, converted_to_client_at, archived")
    .eq("id", change.client_id)
    .maybeSingle();
  if (!client || client.archived) return { done: false };

  // once per change: the CRM row is the marker
  const now = new Date().toISOString();
  const { error: claimErr } = await db.from("client_crm_activities").insert({
    client_id: client.id,
    activity_type: "purchased",
    title: `Bought ${change.to_label ?? "coaching"}`,
    details: { change_id: change.id, sale_id: change.sale_id ?? null, package_id: change.to_package_id ?? null, price_cents: change.to_price_cents ?? null, had_account: !!client.user_id },
    source: "stripe_webhook",
    dedupe_key: `coaching_start:${change.id}`,
  });
  if (claimErr) {
    if (claimErr.code === "23505") return { done: false };
    throw new Error(claimErr.message);
  }

  // the lead is a client now (plan_apply_tier keeps a coaching-default row's "Lead")
  const patch: Record<string, unknown> = { lifecycle_stage: "active_client", converted_to_client_at: client.converted_to_client_at ?? now };
  if (!client.status || client.status === "Lead" || client.status === "Member") patch.status = "New Client";
  await db.from("clients").update(patch).eq("id", client.id);

  // their application (the site's intake, or an earlier one) closes as bought
  await db
    .from("coaching_applications")
    .update({ status: "Approved", decided_at: now, decision_note: `Bought ${change.to_label ?? "coaching"}` })
    .eq("client_id", client.id)
    .in("status", ["Checkout started", "New", "Needs Review"]);

  // an account: the same setup email the coach's Send invite sends (only the inbox's owner can use it)
  let setupSent = false;
  if (!client.user_id && client.email) {
    try {
      const { sendClientSetupEmail } = await import("@/lib/clients.functions");
      setupSent = (await sendClientSetupEmail(client.id)).sent;
    } catch (e) {
      console.warn("[coaching-sales] setup email failed", e);
    }
  }

  // the welcome (a new login never got notifyPlanChange's client email: it needs a login)
  if (!client.user_id && client.email) {
    const steps = onboardingSteps({ hasAccount: false, setupSent });
    const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
    await sendTemplateEmail(db, {
      template: "plan-change",
      to: client.email,
      idempotencyKey: `coaching_welcome:${change.id}`,
      data: {
        first_name: client.first_name ?? "",
        headline: `You're in: ${change.to_label ?? "coaching"}`,
        body: steps.join(" "),
        rows: [
          ["Package", String(change.to_label ?? "Coaching")],
          ...(change.to_price_cents ? [["Billed", `$${(Number(change.to_price_cents) / 100).toFixed(2)} a month + tax, until you cancel`] as [string, string]] : []),
        ],
        url: "https://jfeffect.com/auth",
      },
    });
  }
  return { done: true };
}
