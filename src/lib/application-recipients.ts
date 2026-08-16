/**
 * Fixed server-side allowlist for NEW coaching-application alerts only.
 *
 * These recipients are hard-coded on purpose: they are never inferred from
 * users, admins, coaches, client phone numbers, or the configurable
 * `coaching_app_notification_recipients` table. Booking alerts continue to
 * use the configurable recipient table and are unaffected.
 */

export const APPLICATION_ALERT_EMAILS = ["jaredjamesfit@gmail.com"] as const;
export const APPLICATION_ALERT_SMS = ["+12042294913", "+12042907443"] as const;

export function isAllowedApplicationEmail(email: string): boolean {
  return (APPLICATION_ALERT_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

export function isAllowedApplicationSms(phone: string): boolean {
  return (APPLICATION_ALERT_SMS as readonly string[]).includes(phone.trim());
}

/** The exact recipient set used for new-application notifications. */
export function applicationAlertRecipients() {
  return {
    emails: [...APPLICATION_ALERT_EMAILS],
    sms: [...APPLICATION_ALERT_SMS],
  };
}
