// Tab model for the admin Forms workspace. Kept out of the page module so the route file
// (which needs it for validateSearch) stays tiny and the page can load on demand.
export const TABS = [
  // Promoted: the three surfaces used daily.
  { value: "website-forms",          label: "Website Forms" },
  { value: "applications",           label: "Applications" },
  { value: "submissions",            label: "Submissions" },
  { value: "reviews",                label: "Reviews" },
  { value: "builder",                label: "Builder" },
  { value: "agreements",             label: "Agreements" },
  { value: "integrations",           label: "Integrations" },
  { value: "scheduler",              label: "Scheduler" },
  { value: "ai-settings",            label: "AI Settings" },
  // Legacy / hidden keys kept so old links keep working.
  { value: "native-forms",           label: "Native Forms",         hidden: true },
  { value: "document-forms",         label: "Document Forms",       hidden: true },
  { value: "fillout-submissions",    label: "Fillout Submissions",  hidden: true },
  { value: "coaching-applications",  label: "Coaching Applications",hidden: true },
] as const;
export type TabKey = typeof TABS[number]["value"];

export const LAST_TAB_KEY = "jf-admin-forms-last-tab";

// Legacy tab keys → canonical tabs. Keeps old bookmarks and redirect stubs
// working when the user lands here directly.
export const LEGACY_TAB_ALIAS: Record<string, TabKey> = {
  "native-forms": "builder",
  "document-forms": "builder",
  "fillout-submissions": "submissions",
  "coaching-applications": "applications",
};

export function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

