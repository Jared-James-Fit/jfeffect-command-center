/**
 * `auth.admin.inviteUserByEmail` fails for an existing account, and callers
 * then fall back to a password-recovery email. That fallback is only valid
 * for that one case: `resetPasswordForEmail` returns success for an address
 * with no account and sends nothing, so falling back on any other error
 * (email hook down, rate limit, bad address) reports "sent" when nothing was.
 */
export function isAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code === "email_exists" || code === "user_already_exists") return true;
  return typeof message === "string" && /already (been )?registered|already exists/i.test(message);
}
