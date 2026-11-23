import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withPageSecurityHeaders } from "./lib/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * The visit counter (/api/public/app-pulse) reads the host's IP geolocation. Cloudflare puts it on
 * the incoming request's `cf` object, which the framework may not pass through, so for that one
 * path it's copied onto headers the handler reads. Headers of the same name a browser sent are
 * dropped first, so nobody can claim a place.
 */
function withGeoHeaders(request: Request): Request {
  try {
    if (request.method !== "POST" || !new URL(request.url).pathname.startsWith("/api/public/app-pulse")) return request;
    const headers = new Headers(request.headers);
    for (const k of ["x-jf-geo-country", "x-jf-geo-region", "x-jf-geo-city", "x-jf-geo-lat", "x-jf-geo-lng"]) headers.delete(k);
    const cf = (request as any).cf as Record<string, unknown> | undefined;
    if (cf) {
      const set = (k: string, v: unknown) => {
        if (v != null && v !== "") headers.set(k, encodeURIComponent(String(v)));
      };
      set("x-jf-geo-country", cf.country);
      set("x-jf-geo-region", cf.region);
      set("x-jf-geo-city", cf.city);
      set("x-jf-geo-lat", cf.latitude);
      set("x-jf-geo-lng", cf.longitude);
    }
    return new Request(request, { headers });
  } catch {
    return request;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(withGeoHeaders(request), env, ctx);
      return withPageSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request.url);
    } catch (error) {
      console.error(error);
      return withPageSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request.url,
      );
    }
  },
};
