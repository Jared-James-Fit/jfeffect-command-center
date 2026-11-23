import { createFileRoute } from "@tanstack/react-router";

/**
 * One beat of a visit (src/lib/app-pulse): opens the visit on its first beat with the place the
 * host's IP geolocation gives (a city and a point rounded to 0.1°, never the IP), then adds pages
 * and active time. Public: a signed-in person is identified by their own bearer token; anyone else
 * is an anonymous browser id. Never errors back at the page.
 */
export const Route = createFileRoute("/api/public/app-pulse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { recordPulse } = await import("@/lib/app-pulse/pulse.server");
        try {
          await recordPulse(request);
        } catch (e: any) {
          console.error("[app-pulse]", e?.message ?? e);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
