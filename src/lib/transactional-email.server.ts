/**
 * Server-only: render one of the branded email templates (email-templates/
 * registry.ts) and put it on the transactional queue, the same way the setup
 * reminder does. Idempotent by `idempotencyKey` (notification_dedupe), honours
 * the suppression list, and never throws: the result says what happened so a
 * caller can tell the coach ("the email didn't go, send the link by DM").
 *
 * NEVER import at module scope from `*.functions.ts` or the browser.
 */
import * as React from "react";
import { render } from "@react-email/components";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { emailEnvelope } from "@/lib/email-identity";

export type TemplateEmailResult =
  | { sent: true; messageId: string }
  | {
      sent: false;
      reason: "no_template" | "suppressed" | "already_sent" | "failed";
      error?: string;
    };

function token(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendTemplateEmail(
  supabaseAdmin: any,
  opts: {
    template: string;
    to: string;
    data: Record<string, unknown>;
    /** Same key, one email. Leave out for a send that may repeat (a new code). */
    idempotencyKey?: string;
    /** Never written to the log (codes, sign-in links). */
    sensitive?: boolean;
  },
): Promise<TemplateEmailResult> {
  try {
    const template = TEMPLATES[opts.template];
    if (!template) return { sent: false, reason: "no_template" };
    const recipient = opts.to.trim();
    const normalized = recipient.toLowerCase();

    if (opts.idempotencyKey) {
      const { data: claimed, error } = await supabaseAdmin
        .from("notification_dedupe")
        .insert({
          key: opts.idempotencyKey,
          channel: "email",
          metadata: { template: opts.template },
        })
        .select("key");
      if (error || !claimed || claimed.length === 0) return { sent: false, reason: "already_sent" };
    }

    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails")
      .select("id")
      .eq("email", normalized)
      .maybeSingle();
    if (suppressed) return { sent: false, reason: "suppressed" };

    let unsubscribeToken: string;
    const { data: existing } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("token, used_at")
      .eq("email", normalized)
      .maybeSingle();
    if (existing?.token && !existing.used_at) {
      unsubscribeToken = existing.token;
    } else {
      const fresh = token();
      await supabaseAdmin
        .from("email_unsubscribe_tokens")
        .upsert(
          { token: fresh, email: normalized },
          { onConflict: "email", ignoreDuplicates: true },
        );
      const { data: stored } = await supabaseAdmin
        .from("email_unsubscribe_tokens")
        .select("token")
        .eq("email", normalized)
        .maybeSingle();
      unsubscribeToken = stored?.token ?? fresh;
    }

    const element = React.createElement(template.component, opts.data);
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject =
      typeof template.subject === "function" ? template.subject(opts.data) : template.subject;
    const messageId = crypto.randomUUID();

    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: opts.template,
      recipient_email: recipient,
      status: "pending",
    });

    const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: messageId,
        to: recipient,
        ...emailEnvelope(template.identity ?? "support"),
        subject,
        html,
        text,
        purpose: "transactional",
        label: opts.template,
        idempotency_key: opts.idempotencyKey ?? messageId,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    });
    if (enqueueError) {
      await supabaseAdmin.from("email_send_log").insert({
        message_id: messageId,
        template_name: opts.template,
        recipient_email: recipient,
        status: "failed",
        error_message: "enqueue failed: " + enqueueError.message,
      });
      // let a retry with the same key go through
      if (opts.idempotencyKey) {
        await supabaseAdmin
          .from("notification_dedupe")
          .delete()
          .eq("key", opts.idempotencyKey)
          .then(
            () => null,
            () => null,
          );
      }
      return { sent: false, reason: "failed", error: enqueueError.message };
    }
    return { sent: true, messageId };
  } catch (e: any) {
    console.error(
      "[template-email] failed",
      opts.template,
      opts.sensitive ? "(sensitive)" : (e?.message ?? e),
    );
    if (opts.idempotencyKey) {
      await supabaseAdmin
        .from("notification_dedupe")
        .delete()
        .eq("key", opts.idempotencyKey)
        .then(
          () => null,
          () => null,
        );
    }
    return { sent: false, reason: "failed", error: e?.message ?? String(e) };
  }
}
