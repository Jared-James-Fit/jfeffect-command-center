/**
 * What a link to one of our pages looks like when it's sent: iMessage, texts,
 * Instagram, WhatsApp, Messenger, Slack. A short, clean title ("JF Effect",
 * "Book a time with JF Effect"), one plain line under it and the JF logo.
 *
 * Every page's share tags come from here, never typed per page: the keyword
 * titles ("Personal Trainer Selkirk MB | …") are for Google and live only in
 * a page's own <title>, never on a share card. The router keeps the deepest
 * route's tag for each name, so a page's shareMeta() replaces the root's.
 */
export const SITE_URL = "https://jfeffect.com";
export const SITE_NAME = "JF Effect";

/** The logo as it is, at 1024px so it's sharp on every phone. */
export const SHARE_IMAGE = {
  url: `${SITE_URL}/icon-1024.png`,
  width: 1024,
  height: 1024,
  alt: "JF Effect",
} as const;

/** The line under the title when a page has nothing more specific to say. */
export const DEFAULT_SHARE_DESCRIPTION = "Strength, muscle, fat loss and powerlifting coaching.";

/** Share titles stay short enough to show whole on a phone's link card. */
export const SHARE_TITLE_MAX = 40;

type MetaTag = { property: string; content: string } | { name: string; content: string };

export function shareMeta({
  title,
  description = DEFAULT_SHARE_DESCRIPTION,
  path,
}: {
  /** What the card says, e.g. "Book a time with JF Effect". */
  title: string;
  /** One plain line (WhatsApp, Messenger and Slack show it; iMessage doesn't). */
  description?: string;
  /** The page's own address ("/book/discovery-call"), so a share is that page, never the home page. */
  path?: string;
}): MetaTag[] {
  const tags: MetaTag[] = [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (path) tags.push({ property: "og:url", content: `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}` });
  return tags;
}

/** The logo and card type, once on the root so every page inherits them. */
export function shareImageMeta(): MetaTag[] {
  return [
    { property: "og:image", content: SHARE_IMAGE.url },
    { property: "og:image:width", content: String(SHARE_IMAGE.width) },
    { property: "og:image:height", content: String(SHARE_IMAGE.height) },
    { property: "og:image:alt", content: SHARE_IMAGE.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: SHARE_IMAGE.url },
  ];
}

/** A legal document's card: "JF Effect Privacy Policy", or its own title when it already says JF. */
export function legalShareTitle(docTitle: string): string {
  const t = docTitle.trim() || "Legal";
  return /\bJF\b/.test(t) ? t : `${SITE_NAME} ${t}`;
}
