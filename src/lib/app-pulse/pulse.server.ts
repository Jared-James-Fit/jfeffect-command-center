/**
 * Records a visit's beat (/api/public/app-pulse; rules in pulse-rules.ts). Server only.
 *
 * - Who: the bearer token's login when it's valid (verified like every server function), else an
 *   anonymous browser id. Staff, members, clients and logins waiting on an application are told
 *   apart in the database (app_pulse_audience); a test login is never recorded.
 * - Where: only on the visit's first beat, from the host's geolocation (Cloudflare's request.cf,
 *   or its visitor-location headers), kept to a city and a point rounded to 0.1°. Never the IP.
 *   This host gives only the country, so a visit is put on the map at its device's time zone's
 *   main city when that zone is in the same country (zonePlace, tz-places.ts), else it stays a
 *   country with no point. A browser sending Global Privacy Control or Do Not Track gets no place.
 * - Limits: 120 beats a minute per address on this server instance, 20 KB a body; the database
 *   caps a visit at 600 pages and 5 minutes of active time a beat.
 */
import { z } from "zod";
import { coarsePlace } from "./pulse-rules";
import { zonePlace } from "./tz-places";

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse|pingdom|uptime/i;
const MAX_BODY = 20_000;

const text = (max: number) => z.string().max(max).optional().nullable();
const Body = z.object({
  session: z.string().uuid(),
  visitor: z.string().uuid(),
  views: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        feature: z.string().min(1).max(60),
        at: z.string().max(40).optional(),
      }),
    )
    .max(60)
    .default([]),
  seconds: z.number().int().min(0).max(100_000).default(0),
  optOut: z.boolean().optional(),
  start: z
    .object({
      surface: z.enum(["site", "app", "admin"]),
      entry: text(200),
      platform: z.enum(["ios_app", "android_app", "home_screen", "browser"]).optional().nullable(),
      device: z.enum(["phone", "tablet", "desktop"]).optional().nullable(),
      os: z.enum(["ios", "android", "macos", "windows", "linux", "chromeos", "other"]).optional().nullable(),
      referrer: text(500),
      source: text(80),
      utm_source: text(120),
      utm_medium: text(120),
      utm_campaign: text(120),
      tz: text(60),
    })
    .optional(),
});

const hits = new Map<string, { at: number; n: number }>();
function throttled(key: string, max = 120): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { at: now, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > 60_000) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > max;
}

const audienceCache = new Map<string, { aud: string; at: number }>();

async function userOf(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } });
    const { data, error } = await c.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return String(data.claims.sub);
  } catch {
    return null;
  }
}

/** The host's place for this request: Cloudflare's own object first, then its headers. */
export function placeOf(request: Request): ReturnType<typeof coarsePlace> {
  const cf = (request as any).cf ?? {};
  const h = request.headers;
  return coarsePlace({
    country: cf.country ?? h.get("x-jf-geo-country") ?? h.get("cf-ipcountry"),
    region: cf.region ?? h.get("x-jf-geo-region") ?? h.get("cf-region"),
    city: cf.city ?? h.get("x-jf-geo-city") ?? h.get("cf-ipcity"),
    latitude: cf.latitude ?? h.get("x-jf-geo-lat") ?? h.get("cf-iplatitude"),
    longitude: cf.longitude ?? h.get("x-jf-geo-lng") ?? h.get("cf-iplongitude"),
  });
}

function referrerHost(raw: string | null | undefined): string | null {
  try {
    const host = new URL(String(raw ?? "")).hostname.replace(/^www\./, "");
    if (!host || /(^|\.)jfeffect\.com$/.test(host)) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export async function recordPulse(request: Request): Promise<void> {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return;
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (throttled(ip || "unknown")) return;
  const raw = await request.text();
  if (!raw || raw.length > MAX_BODY) return;
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return;
  }
  const userId = await userOf(request);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  let audience = "visitor";
  if (userId) {
    const c = audienceCache.get(userId);
    if (c && Date.now() - c.at < 10 * 60_000) audience = c.aud;
    else {
      const { data } = await db.rpc("app_pulse_audience", { _uid: userId });
      audience = String(data ?? "pending");
      audienceCache.set(userId, { aud: audience, at: Date.now() });
      if (audienceCache.size > 5000) audienceCache.clear();
    }
  } else if (parsed.optOut) {
    return;
  }
  if (audience === "test") return;

  const s = parsed.start;
  const place = s && !parsed.optOut ? placeOf(request) : { country: null, region: null, city: null, lat: null, lng: null };
  if (s && !parsed.optOut && place.lat == null) {
    const z = zonePlace(s.tz, place.country);
    if (z) Object.assign(place, { city: place.city ?? z.city, lat: z.lat, lng: z.lng });
  }
  const views = parsed.views.map((v) => {
    let at = v.at ? new Date(v.at) : new Date();
    if (Number.isNaN(at.getTime())) at = new Date();
    return { path: v.path, feature: v.feature, at: at.toISOString() };
  });
  await db.rpc("app_pulse_record", {
    _session: parsed.session,
    _visitor: parsed.visitor,
    _user: userId,
    _audience: audience,
    _surface: s?.surface ?? "app",
    _platform: s?.platform ?? null,
    _device: s?.device ?? null,
    _os: s?.os ?? null,
    _entry_path: s?.entry ?? null,
    _entry_feature: views[0]?.feature ?? null,
    _referrer_host: referrerHost(s?.referrer),
    _utm_source: s?.utm_source ?? s?.source ?? null,
    _utm_medium: s?.utm_medium ?? null,
    _utm_campaign: s?.utm_campaign ?? null,
    _country: place.country,
    _region: place.region,
    _city: place.city,
    _lat: place.lat,
    _lng: place.lng,
    _views: views,
    _active_seconds: parsed.seconds,
  });
}
