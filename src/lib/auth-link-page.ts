/**
 * Shared by the pages a setup or reset link opens (/setup, /reset-password).
 *
 * Every page has to download and start the app (about 270 KB compressed) before it can do
 * anything, which is slow on a phone opening a link from Gmail. So the server renders the
 * real "Continue" screen straight from the link instead of a "Verifying…" placeholder, and
 * the page opens its connection to Supabase early so the step after Continue is quick.
 */

export type AuthLinkSearch = { token_hash?: string; type?: string; rt?: string };

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;

/** Route validateSearch: reads the link's token params the same way on the server and the client. */
export function readAuthLinkSearch(search: Record<string, unknown>): AuthLinkSearch {
  return { token_hash: asString(search.token_hash), type: asString(search.type), rt: asString(search.rt) };
}

/** A link carrying a token hash opens straight on Continue (an SMS reset token is checked first). */
export function opensOnContinue(search: AuthLinkSearch): boolean {
  return !!search.token_hash && !search.rt;
}

/** <link rel="preconnect"> to Supabase, so the token exchange after Continue skips the handshake. */
export function supabasePreconnectLinks(): Array<{ rel: string; href: string; crossOrigin: "anonymous" }> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return [];
  try {
    return [{ rel: "preconnect", href: new URL(url).origin, crossOrigin: "anonymous" }];
  } catch {
    return [];
  }
}
