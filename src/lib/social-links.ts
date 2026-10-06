/** Public name + social profiles shown on the marketing pages. One place to edit. */
export const COACH_NAME = "Jared McIntyre";

export const SOCIAL = {
  instagram: {
    label: "Instagram",
    handle: "@jaredmcintyre_",
    url: "https://www.instagram.com/jaredmcintyre_/",
  },
  youtube: {
    label: "YouTube",
    handle: "@jared.mcintyre",
    url: "https://www.youtube.com/@jared.mcintyre",
  },
} as const;

export const SOCIAL_URLS = [SOCIAL.instagram.url, SOCIAL.youtube.url];

/** Where "I have a question first" goes: a DM is the lowest-friction way to inquire. */
export const INQUIRY_DM_URL = SOCIAL.instagram.url;
