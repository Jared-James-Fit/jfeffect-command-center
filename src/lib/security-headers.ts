// Headers every page (HTML response) carries, added in src/server.ts.
//
// frame-ancestors: no other site may show JF Effect inside a frame. Sign-in
// lives in the page's own storage, so a framed jfeffect.com is a signed-in
// one, and a hostile page could lay its own buttons over it (clickjacking).
// The Lovable editor shows the preview builds in its own frame, so preview
// hosts also allow Lovable; the published site allows only itself. The
// iPhone app loads jfeffect.com as its top-level page, never in a frame.
// (No X-Frame-Options: it can't name more than one origin, and every browser
// the app supports reads frame-ancestors.)
//
// Permissions-Policy: switches off device features the app never uses, so a
// script or embed can't ask for them. Camera and microphone are left alone:
// the app films sets and records voice memos, and coach forms embedded from
// Fillout take photos.

const LOVABLE_EDITOR_ORIGINS = [
  "https://lovable.dev",
  "https://*.lovable.dev",
  "https://*.lovable.app",
  "https://*.lovableproject.com",
];

/** The published site (and its subdomains) frames only itself. */
export function isProductionHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "jfeffect.com" || h.endsWith(".jfeffect.com");
}

export function frameAncestorsFor(hostname: string): string {
  return ["'self'", ...(isProductionHost(hostname) ? [] : LOVABLE_EDITOR_ORIGINS)].join(" ");
}

export const PERMISSIONS_POLICY = "geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), midi=()";

/** The headers to add to an HTML response for this request URL. */
export function pageSecurityHeaders(requestUrl: string): Record<string, string> {
  let hostname = "";
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    /* an unparseable URL gets the strictest answer below */
  }
  return {
    "Content-Security-Policy": `frame-ancestors ${frameAncestorsFor(hostname)}`,
    "Permissions-Policy": PERMISSIONS_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

/**
 * The response with the page headers added when it's an HTML page. Headers
 * already set (by the route or the host) win. Other responses (server
 * functions, files, webhooks) are returned untouched.
 */
export function withPageSecurityHeaders(response: Response, requestUrl: string): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(pageSecurityHeaders(requestUrl))) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
