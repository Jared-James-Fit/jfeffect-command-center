/**
 * Server-only helper that fires an SMS automation trigger.
 *
 * Picks every active sms_automations row whose trigger_type matches, renders
 * the body with the provided template vars, and sends via Twilio. Each send
 * is recorded in sms_log with the automation id + trigger.
 *
 * Safe to import from server routes and server functions only.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

async function sendViaTwilio(toPhone: string, fromPhone: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) throw new Error("Twilio not configured");
  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toPhone, From: fromPhone, Body: body }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio error (${res.status})`);
  return { sid: data.sid as string };
}

export type AutomationContext = {
  /** trigger event key (matches sms_automations.trigger_type) */
  trigger: string;
  /** target member (if firing for an app_members row) */
  memberId?: string | null;
  /** target client (if firing for a clients row) */
  clientId?: string | null;
  /** phone to send to; if omitted we look it up on the member/client */
  phone?: string | null;
  /** template variables — merged with auto-resolved {first_name},{full_name},{brand},{setup_link} */
  vars?: Record<string, string>;
};

/**
 * Fire every active automation matching `ctx.trigger`. Best-effort: failures
 * are recorded in sms_log but never throw out of this function so the calling
 * webhook/server-fn can continue.
 */
export async function fireAutomationTrigger(supabaseAdmin: any, ctx: AutomationContext) {
  try {
    const { data: settings } = await supabaseAdmin
      .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings?.enabled || !settings.from_phone) return { fired: 0, reason: "sms_disabled" };

    const { data: automations } = await supabaseAdmin
      .from("sms_automations").select("*")
      .eq("trigger_type", ctx.trigger).eq("active", true);
    if (!automations || automations.length === 0) return { fired: 0, reason: "no_automation" };

    // Resolve recipient
    let toPhone = normalizePhone(ctx.phone ?? null);
    let firstName = "there";
    let fullName = "";
    let optOut = false;

    if (ctx.memberId) {
      const { data: m } = await supabaseAdmin
        .from("app_members").select("id, full_name, email, phone, sms_opt_out").eq("id", ctx.memberId).maybeSingle();
      if (m) {
        if (!toPhone) toPhone = normalizePhone(m.phone);
        fullName = m.full_name ?? "";
        firstName = (m.full_name?.split(" ")[0]) || (m.email?.split("@")[0]) || "there";
        optOut = !!m.sms_opt_out;
      }
    } else if (ctx.clientId) {
      const { data: c } = await supabaseAdmin
        .from("clients").select("id, first_name, full_name, phone, sms_opt_out").eq("id", ctx.clientId).maybeSingle();
      if (c) {
        if (!toPhone) toPhone = normalizePhone(c.phone);
        fullName = c.full_name ?? "";
        firstName = c.first_name ?? c.full_name?.split(" ")[0] ?? "there";
        optOut = !!c.sms_opt_out;
      }
    }

    const baseVars: Record<string, string> = {
      first_name: firstName,
      full_name: fullName,
      brand: settings.brand_name ?? "Your coach",
      setup_link: "",
      ...(ctx.vars ?? {}),
    };

    let fired = 0;
    for (const auto of automations) {
      const body = renderTemplate(auto.body, baseVars);
      const logBase: any = {
        client_id: ctx.clientId ?? null,
        app_member_id: ctx.memberId ?? null,
        to_phone: toPhone ?? "",
        body,
        kind: "automation",
        automation_id: auto.id,
        automation_trigger: ctx.trigger,
      };
      if (optOut) {
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "skipped", error: "opted_out" });
        continue;
      }
      if (!toPhone) {
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "skipped", error: "no_phone" });
        continue;
      }
      try {
        const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "sent", twilio_sid: sid });
        fired++;
      } catch (e: any) {
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "failed", error: e?.message ?? String(e) });
      }
    }
    return { fired };
  } catch (e: any) {
    console.error("[sms-trigger] error", e);
    return { fired: 0, error: e?.message ?? String(e) };
  }
}
