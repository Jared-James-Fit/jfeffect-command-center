/**
 * Global helper that appends the logged-in client's identity to any Fillout
 * URL so every form opened from inside the app knows exactly which client
 * submitted it. The internal `client_id` is the primary matching key —
 * email / first / last are only for prefill convenience.
 *
 * Usage:
 *   buildFilloutUrl(form.external_url, client)
 */

export type FilloutClient = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

/** Returns true for any Fillout-hosted form URL. */
export function isFilloutUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "fillout.com" || host.endsWith(".fillout.com");
  } catch {
    return false;
  }
}

function splitName(full: string | null | undefined): { first: string; last: string } {
  const s = (full ?? "").trim();
  if (!s) return { first: "", last: "" };
  const parts = s.split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/**
 * Appends client identity params to a Fillout URL. Non-Fillout URLs are
 * returned unchanged so this helper is safe to call on any external link.
 * Existing params on the base URL are preserved.
 */
export function buildFilloutUrl(
  baseUrl: string | null | undefined,
  client: FilloutClient | null | undefined,
  opts: { force?: boolean } = {},
): string {
  if (!baseUrl) return "";
  if (!client?.id) return baseUrl;
  if (!opts.force && !isFilloutUrl(baseUrl)) return baseUrl;

  try {
    const url = new URL(baseUrl);
    const { first, last } = splitName(client.full_name);
    const firstName = (client.first_name ?? first ?? "").trim();
    const lastName = (client.last_name ?? last ?? "").trim();
    const params: Record<string, string> = {
      client_id: client.id,
      client_email: (client.email ?? "").trim(),
      first_name: firstName,
      last_name: lastName,
    };
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}