/**
 * Acquisition channels (Business intelligence, Nov 25 2026): where a visit came from, read the same
 * way everywhere. Pure. Its SQL twin is public.bi_channel (20270530090000_business_intelligence.sql);
 * CHANNEL_CASES are run against both (business-intelligence.test.ts here, and on the database when
 * the migration is applied), so they never drift.
 *
 * Inputs are what a visit already records: the referrer's host (never the full address), the
 * ?utm_source / ?utm_medium of the link that opened it, and a ?from= / ?ref= the business put on its
 * own links. Precedence, first match wins:
 *   1. a paid medium (cpc, ppc, paid, paid_social, ads, display, sponsored…) is Paid advertising,
 *      whatever platform it ran on (the platform is the source detail);
 *   2. an email medium / source, or a mail app or webmail referrer, is Email;
 *   3. a named source (utm_source or from=): Instagram, YouTube, TikTok, Facebook, Google, another
 *      search engine, another social network;
 *   4. the referrer's host, the same way; any other site is a Referral;
 *   5. a source nobody recognises is Other / unknown (it says something, we can't tell what);
 *   6. nothing at all is Direct (typed, a bookmark, the installed app, or a referrer the browser
 *      hid: those can't be told apart, and the page says so).
 */

export const CHANNELS = [
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "google",
  "search",
  "social",
  "paid",
  "email",
  "referral",
  "other",
  "direct",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  google: "Google search",
  search: "Other search",
  social: "Other social",
  paid: "Paid advertising",
  email: "Email",
  referral: "Referral",
  other: "Other / unknown source",
  direct: "Direct",
};

export const CHANNEL_HELP: Record<Channel, string> = {
  instagram: "Instagram links, bio links and stories (instagram.com, l.instagram.com, ?utm_source=instagram, ?from=ig).",
  youtube: "YouTube videos, descriptions and Shorts (youtube.com, youtu.be).",
  tiktok: "TikTok profiles and videos (tiktok.com).",
  facebook: "Facebook and Messenger (facebook.com, l.facebook.com, m.me).",
  google: "Unpaid Google search results.",
  search: "Bing, DuckDuckGo, Yahoo, Ecosia and other search engines.",
  social: "X / Twitter, Threads, Reddit, LinkedIn, Pinterest, Snapchat.",
  paid: "Any link tagged as paid (utm_medium cpc, ppc, paid, paid_social, ads, display, sponsored).",
  email: "Email links (utm_medium=email, Gmail and other mail apps).",
  referral: "Another website linked to JF Effect.",
  other: "A tagged link whose source isn't one we recognise (e.g. a custom ?from= value).",
  direct: "Typed in, a bookmark, the installed app, or a link whose referrer the browser hid.",
};

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid[_ -]?social|paidsocial|paid[_ -]?search|ads?|display|banner|sponsored|boost(ed)?|promoted)$/;
const EMAIL_MEDIUM = /^(e-?mail|newsletter)$/;

const SOURCE_RULES: [RegExp, Channel][] = [
  [/^(e-?mail|newsletter|mailchimp|klaviyo|convertkit)$/, "email"],
  [/^(ig|insta|instagram|instagram[_ -]?(bio|story|stories|reel|reels|dm|post|ads?))$/, "instagram"],
  [/^(yt|youtube|youtube[_ -]?(shorts?|video|description))$/, "youtube"],
  [/^(tt|tiktok|tik[_ -]?tok)$/, "tiktok"],
  [/^(fb|facebook|meta|messenger|facebook[_ -]?(group|page|ads?))$/, "facebook"],
  [/^(google|google[_ -]?(search|organic))$/, "google"],
  [/^(bing|duckduckgo|ddg|yahoo|ecosia|brave|yandex|baidu)$/, "search"],
  [/^(twitter|x|threads|reddit|linkedin|pinterest|snapchat|discord)$/, "social"],
];

const HOST_RULES: [RegExp, Channel][] = [
  [/(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me)$|^com\.google\.android\.gm$|^com\.microsoft\.office\.outlook$/, "email"],
  [/(^|\.)instagram\.com$|^com\.instagram\.android$/, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$|^com\.google\.android\.youtube$/, "youtube"],
  [/(^|\.)(tiktok\.com|tiktokv\.com)$|^com\.zhiliaoapp\.musically$/, "tiktok"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|m\.me)$|^com\.facebook\.(katana|orca)$/, "facebook"],
  [/(^|\.)google\.[a-z.]{2,6}$|^com\.google\.android\.googlequicksearchbox$/, "google"],
  [/(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$/, "search"],
  [/(^|\.)(t\.co|twitter\.com|x\.com|threads\.net|threads\.com|reddit\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|pin\.it|snapchat\.com|discord\.com)$/, "social"],
];

function norm(v: string | null | undefined, max = 120): string {
  return String(v ?? "").trim().toLowerCase().slice(0, max);
}

/** A referrer as a bare host: "https://l.instagram.com/?u=…" → "l.instagram.com"; android-app:// keeps its package. */
export function hostOf(referrer: string | null | undefined): string {
  const r = norm(referrer, 500);
  if (!r) return "";
  const m = r.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/);
  const host = (m ? m[1] : r.split(/[/?#:]/)[0]).replace(/^www\./, "");
  return /^[a-z0-9.-]{1,120}$/.test(host) ? host : "";
}

export function channelOf(input: {
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  from?: string | null;
}): Channel {
  const medium = norm(input.utmMedium);
  const source = norm(input.utmSource) || norm(input.from, 80);
  const host = hostOf(input.referrerHost);
  if (medium && PAID_MEDIUM.test(medium)) return "paid";
  if (medium && EMAIL_MEDIUM.test(medium)) return "email";
  if (source) {
    for (const [re, ch] of SOURCE_RULES) if (re.test(source)) return ch;
  }
  if (host && !/(^|\.)jfeffect\.com$/.test(host)) {
    for (const [re, ch] of HOST_RULES) if (re.test(host)) return ch;
    return "referral";
  }
  if (source || medium) return "other";
  return "direct";
}

/** Channel order for display: what's tracked by name first, then the catch-alls. */
export function channelLabel(c: string | null | undefined): string {
  return (CHANNEL_LABEL as Record<string, string>)[String(c ?? "")] ?? "Not recorded";
}

/**
 * The cases both twins must agree on (the database runs them through bi_channel when the migration
 * is applied, and the test runs them through channelOf).
 */
export const CHANNEL_CASES: { in: { referrerHost?: string; utmSource?: string; utmMedium?: string; from?: string }; out: Channel }[] = [
  { in: {}, out: "direct" },
  { in: { referrerHost: "l.instagram.com" }, out: "instagram" },
  { in: { referrerHost: "instagram.com" }, out: "instagram" },
  { in: { referrerHost: "com.instagram.android" }, out: "instagram" },
  { in: { utmSource: "IG" }, out: "instagram" },
  { in: { from: "instagram_bio" }, out: "instagram" },
  { in: { utmSource: "instagram", utmMedium: "paid_social" }, out: "paid" },
  { in: { utmSource: "facebook", utmMedium: "cpc" }, out: "paid" },
  { in: { referrerHost: "m.youtube.com" }, out: "youtube" },
  { in: { referrerHost: "youtu.be" }, out: "youtube" },
  { in: { utmSource: "youtube" }, out: "youtube" },
  { in: { referrerHost: "tiktok.com" }, out: "tiktok" },
  { in: { utmSource: "tiktok" }, out: "tiktok" },
  { in: { referrerHost: "l.facebook.com" }, out: "facebook" },
  { in: { referrerHost: "m.me" }, out: "facebook" },
  { in: { referrerHost: "google.com" }, out: "google" },
  { in: { referrerHost: "google.ca" }, out: "google" },
  { in: { referrerHost: "com.google.android.gm" }, out: "email" },
  { in: { referrerHost: "duckduckgo.com" }, out: "search" },
  { in: { referrerHost: "bing.com" }, out: "search" },
  { in: { referrerHost: "t.co" }, out: "social" },
  { in: { referrerHost: "reddit.com" }, out: "social" },
  { in: { utmMedium: "email", utmSource: "weekly" }, out: "email" },
  { in: { utmSource: "newsletter" }, out: "email" },
  { in: { referrerHost: "linktr.ee" }, out: "referral" },
  { in: { referrerHost: "someblog.ca" }, out: "referral" },
  { in: { from: "flyer" }, out: "other" },
  { in: { utmSource: "podcast_xyz" }, out: "other" },
  { in: { referrerHost: "jfeffect.com" }, out: "direct" },
];
