/**
 * Server-only helpers for the Coaching Agreement.
 *
 * NEVER import from the browser or at module scope from a `*.functions.ts` file:
 * this uses the service-role client and Node crypto. Load it inside handlers with
 * `await import("@/lib/coaching-agreement.server")`.
 */
import { createHash } from "node:crypto";
import * as React from "react";
import { render } from "@react-email/components";
import { TEMPLATES } from "@/lib/email-templates/registry";
import {
  AGREEMENT_CONTENT_JSON,
  AGREEMENT_EFFECTIVE_DATE,
  AGREEMENT_VERSION,
  COACH,
} from "@/lib/coaching-agreement/content";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Fingerprint of the agreement text clients are currently asked to sign. */
export const CURRENT_CONTENT_HASH = sha256Hex(AGREEMENT_CONTENT_JSON);

export type RegisteredVersion = { id: string; version: string; hash: string };

let cachedVersion: RegisteredVersion | null = null;

/**
 * Registers the current agreement text (once per version) and returns its row id.
 * The table is immutable and keyed by both version and hash, so if someone edits
 * the published wording without bumping AGREEMENT_VERSION the insert fails loudly
 * here instead of two different texts sharing one version number.
 */
export async function ensureCurrentVersion(admin: any): Promise<RegisteredVersion> {
  if (cachedVersion) return cachedVersion;

  const select = "id, version, content_hash";
  const { data: existing, error: readError } = await admin
    .from("coaching_agreement_versions")
    .select(select)
    .eq("content_hash", CURRENT_CONTENT_HASH)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) {
    cachedVersion = { id: existing.id, version: existing.version, hash: existing.content_hash };
    return cachedVersion;
  }

  const { data: inserted, error } = await admin
    .from("coaching_agreement_versions")
    .insert({
      version: AGREEMENT_VERSION,
      content_hash: CURRENT_CONTENT_HASH,
      content_json: AGREEMENT_CONTENT_JSON,
      effective_date: AGREEMENT_EFFECTIVE_DATE,
    })
    .select(select)
    .single();

  if (error) {
    // Lost a race with another request that registered the same text: fine.
    const { data: raced } = await admin
      .from("coaching_agreement_versions")
      .select(select)
      .eq("content_hash", CURRENT_CONTENT_HASH)
      .maybeSingle();
    if (raced) {
      cachedVersion = { id: raced.id, version: raced.version, hash: raced.content_hash };
      return cachedVersion;
    }
    if ((error as any).code === "23505") {
      throw new Error(
        `The agreement text changed but version ${AGREEMENT_VERSION} is already published. Bump AGREEMENT_VERSION before publishing the new wording.`,
      );
    }
    throw new Error(error.message);
  }

  cachedVersion = { id: inserted.id, version: inserted.version, hash: inserted.content_hash };
  return cachedVersion;
}

/** Network + device details recorded with the signature, taken from the request, never the browser. */
export async function getRequestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const forwarded = getRequestHeader("x-forwarded-for");
    const ip =
      getRequestHeader("cf-connecting-ip") ||
      (forwarded ? forwarded.split(",")[0]?.trim() : "") ||
      getRequestHeader("x-real-ip") ||
      null;
    const userAgent = getRequestHeader("user-agent") || null;
    return {
      ip: ip ? ip.slice(0, 64) : null,
      userAgent: userAgent ? userAgent.slice(0, 400) : null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export function publicOrigin(): string {
  return process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com";
}

/** "October 6, 2026 at 3:05 p.m. CT" in the business time zone. */
export function winnipegLabel(iso: string): string {
  const date = new Date(iso);
  const text = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: COACH.timezone,
  }).format(date);
  return `${text} CT`;
}

const SITE_NAME = "JF Effect";
const SENDER_DOMAIN = "notify.jfeffect.com";
const FROM_DOMAIN = "jfeffect.com";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type AgreementEmailResult =
  | { sent: true; messageId: string }
  | {
      sent: false;
      reason: "no_email" | "suppressed" | "no_template" | "already_sent" | "failed";
      error?: string;
    };

/**
 * Renders a registered template and puts it on the transactional queue, using the
 * same dedupe / suppression / unsubscribe-token steps as the other app emails.
 * Never throws: an email must not break the action that triggered it.
 */
export async function enqueueAgreementEmail(
  admin: any,
  args: {
    template: "agreement-signed" | "agreement-requested";
    recipient: string | null | undefined;
    dedupeKey: string;
    data: Record<string, unknown>;
    force?: boolean;
  },
): Promise<AgreementEmailResult> {
  try {
    if (!args.recipient) return { sent: false, reason: "no_email" };
    const template = TEMPLATES[args.template];
    if (!template) return { sent: false, reason: "no_template" };

    const recipient = args.recipient;
    const normalized = recipient.toLowerCase();

    if (!args.force) {
      const { data: claimed, error: claimError } = await admin
        .from("notification_dedupe")
        .insert({
          key: args.dedupeKey,
          channel: "email",
          member_id: null,
          metadata: { template: args.template },
        })
        .select("key");
      if (claimError || !claimed || claimed.length === 0) {
        return { sent: false, reason: "already_sent" };
      }
    }

    const { data: suppressed } = await admin
      .from("suppressed_emails")
      .select("id")
      .eq("email", normalized)
      .maybeSingle();
    if (suppressed) return { sent: false, reason: "suppressed" };

    let unsubscribeToken: string;
    const { data: existingToken } = await admin
      .from("email_unsubscribe_tokens")
      .select("token, used_at")
      .eq("email", normalized)
      .maybeSingle();
    if (existingToken?.token && !existingToken.used_at) {
      unsubscribeToken = existingToken.token;
    } else {
      const fresh = randomToken();
      await admin
        .from("email_unsubscribe_tokens")
        .upsert(
          { token: fresh, email: normalized },
          { onConflict: "email", ignoreDuplicates: true },
        );
      const { data: stored } = await admin
        .from("email_unsubscribe_tokens")
        .select("token")
        .eq("email", normalized)
        .maybeSingle();
      unsubscribeToken = stored?.token ?? fresh;
    }

    const element = React.createElement(template.component, args.data);
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject =
      typeof template.subject === "function" ? template.subject(args.data) : template.subject;

    const messageId = crypto.randomUUID();
    await admin.from("email_send_log").insert({
      message_id: messageId,
      template_name: args.template,
      recipient_email: recipient,
      status: "pending",
    });

    const { error: enqueueError } = await admin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: messageId,
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: "transactional",
        label: args.template,
        idempotency_key: args.dedupeKey,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    });

    if (enqueueError) {
      await admin.from("email_send_log").insert({
        message_id: messageId,
        template_name: args.template,
        recipient_email: recipient,
        status: "failed",
        error_message: "enqueue failed: " + enqueueError.message,
      });
      return { sent: false, reason: "failed", error: enqueueError.message };
    }
    return { sent: true, messageId };
  } catch (e: any) {
    console.error("[coaching-agreement-email] failed", e);
    return { sent: false, reason: "failed", error: e?.message ?? String(e) };
  }
}
