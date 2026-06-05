import {
  Instagram,
  Youtube,
  Facebook,
  Twitter,
  Linkedin,
  Globe,
  Music2,
  Link2,
  type LucideIcon,
} from "lucide-react";

export type SocialPlatformKey =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "twitter_x"
  | "linkedin"
  | "website"
  | "other";

export interface SocialPlatform {
  key: SocialPlatformKey;
  /** Column on the `clients` table that stores the handle/value. */
  field: string;
  label: string;
  /** Hint shown as placeholder. */
  placeholder: string;
  icon: LucideIcon;
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { key: "instagram", field: "instagram", label: "Instagram", placeholder: "@clientname", icon: Instagram },
  { key: "tiktok", field: "tiktok", label: "TikTok", placeholder: "@clientname", icon: Music2 },
  { key: "youtube", field: "youtube", label: "YouTube", placeholder: "@clientname", icon: Youtube },
  { key: "facebook", field: "facebook", label: "Facebook", placeholder: "clientname", icon: Facebook },
  { key: "twitter_x", field: "twitter_x", label: "X / Twitter", placeholder: "@clientname", icon: Twitter },
  { key: "linkedin", field: "linkedin", label: "LinkedIn", placeholder: "clientname", icon: Linkedin },
  { key: "website", field: "website", label: "Website", placeholder: "yoursite.com", icon: Globe },
  { key: "other", field: "other_social_handle", label: "Other", placeholder: "username or link", icon: Link2 },
];

/** Strip @, whitespace, common URL prefixes. */
function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "")
    .replace(/^@+/, "");
}

/**
 * Convert a stored handle/value into a clickable URL when we can confidently
 * do so. Returns null when no safe link can be produced — caller should show
 * the raw text instead.
 */
export function handleToUrl(key: SocialPlatformKey, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // If a full URL was pasted, keep it as-is.
  if (/^https?:\/\//i.test(value)) return value;

  const handle = cleanHandle(value);
  if (!handle) return null;

  switch (key) {
    case "instagram":
      // Disallow obviously bad characters
      return /^[a-zA-Z0-9_.]+$/.test(handle) ? `https://instagram.com/${handle}` : null;
    case "tiktok":
      return /^[a-zA-Z0-9_.]+$/.test(handle) ? `https://tiktok.com/@${handle}` : null;
    case "youtube": {
      // Accept @handle, channel/UC..., user/name, or plain handle
      if (handle.startsWith("UC") && handle.length >= 10) return `https://youtube.com/channel/${handle}`;
      if (/^[a-zA-Z0-9_.-]+$/.test(handle)) return `https://youtube.com/@${handle.replace(/^@/, "")}`;
      return null;
    }
    case "facebook":
      return /^[a-zA-Z0-9_.-]+$/.test(handle) ? `https://facebook.com/${handle}` : null;
    case "twitter_x":
      return /^[a-zA-Z0-9_]+$/.test(handle) ? `https://x.com/${handle}` : null;
    case "linkedin":
      // If they typed in/<slug>, keep it; else assume personal /in/<slug>
      if (/^(in|company|school)\//.test(handle)) return `https://linkedin.com/${handle}`;
      return /^[a-zA-Z0-9_-]+$/.test(handle) ? `https://linkedin.com/in/${handle}` : null;
    case "website":
      // domain.tld or domain.tld/path
      return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(handle) ? `https://${handle}` : null;
    case "other":
      return null;
  }
}

/** Display form of a handle (Instagram, TikTok, etc get the @ prefix). */
export function displayHandle(key: SocialPlatformKey, raw: string | null | undefined): string {
  if (!raw) return "";
  const v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return cleanHandle(v);
  const handle = cleanHandle(v);
  if (key === "instagram" || key === "tiktok" || key === "twitter_x" || key === "youtube") {
    return `@${handle}`;
  }
  return handle;
}

/** Returns the list of platforms that have a non-empty value on the given client row. */
export function clientSocials(client: Record<string, any> | null | undefined) {
  if (!client) return [] as Array<{ platform: SocialPlatform; value: string; url: string | null }>;
  return SOCIAL_PLATFORMS
    .map((p) => {
      const raw: string | undefined = client[p.field];
      const value = (raw ?? "").trim();
      if (!value) return null;
      return { platform: p, value, url: handleToUrl(p.key, value) };
    })
    .filter((x): x is { platform: SocialPlatform; value: string; url: string | null } => !!x);
}

export const SOCIAL_FIELDS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "twitter_x",
  "linkedin",
  "website",
  "other_social_label",
  "other_social_handle",
] as const;