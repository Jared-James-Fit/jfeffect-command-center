/**
 * Auth emails used to link straight to Supabase's one-time /auth/v1/verify
 * URL. Outlook/Hotmail Safe Links, Gmail and corporate scanners open every
 * link in an email before the person does, which spends the token — so the
 * client clicks and sees "This setup link has expired".
 *
 * Instead we send them to our own /setup or /reset-password page with the
 * token_hash. Those pages only exchange the token (verifyOtp) when the person
 * taps "Continue", which a scanner never does.
 */

const SAFE_PATHS = ["/setup", "/reset-password"] as const;
const ALLOWED_HOSTS = [/(^|\.)jfeffect\.com$/i, /\.lovable\.app$/i, /^localhost$/i];
const TYPES = new Set(["invite", "magiclink", "recovery", "signup"]);

export function scannerSafeAuthLink(input: {
  url?: string | null;
  tokenHash?: string | null;
  actionType?: string | null;
  redirectTo?: string | null;
  siteUrl: string;
}): string | null {
  const raw = input.url ?? "";
  let verify: URL | null = null;
  try { verify = raw ? new URL(raw) : null; } catch { verify = null; }

  const type = (verify?.searchParams.get("type") || input.actionType || "").toLowerCase();
  if (!TYPES.has(type)) return null;
  // In Supabase's verify URL the `token` query param is the token hash.
  const tokenHash = input.tokenHash || verify?.searchParams.get("token") || null;
  // PKCE tokens need the browser's code verifier — leave those links alone.
  if (!tokenHash || tokenHash.startsWith("pkce_")) return null;

  let target: URL;
  try {
    target = new URL(input.redirectTo || verify?.searchParams.get("redirect_to") || "", input.siteUrl);
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) return null;
  let path = target.pathname.replace(/\/+$/, "") || "/";
  if (!(SAFE_PATHS as readonly string[]).includes(path)) {
    // Default redirect (site root) → the matching safe page. Anything more
    // specific (member onboarding etc.) keeps the original link.
    if (path !== "/") return null;
    path = type === "recovery" ? "/reset-password" : "/setup";
  }
  const out = new URL(path, target.origin);
  out.searchParams.set("token_hash", tokenHash);
  out.searchParams.set("type", type);
  return out.toString();
}
