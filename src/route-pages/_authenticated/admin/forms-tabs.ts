// Tab model for the admin Forms workspace. Kept out of the page module so the route file
// (which needs it for validateSearch) stays tiny and the page can load on demand.
//
// Five tabs the coach uses: Submissions (everything clients send in, the default),
// Requests (what was sent and who hasn't filled it), Forms (the forms themselves),
// Applications and Agreements. The rest sit under "More".
export const TABS = [
  { value: "submissions",            label: "Submissions" },
  { value: "requests",               label: "Requests" },
  { value: "builder",                label: "Forms" },
  { value: "applications",           label: "Applications" },
  { value: "agreements",             label: "Agreements" },
  { value: "reviews",                label: "AI drafts",            more: true },
  { value: "fillout",                label: "Fillout inbox",        more: true },
  { value: "scheduler",              label: "Scheduler",            more: true },
  { value: "ai-settings",            label: "AI settings",          more: true },
  { value: "integrations",           label: "Integrations",         more: true },
  // Legacy / hidden keys kept so old links keep working.
  { value: "website-forms",          label: "Website Forms",        hidden: true },
  { value: "native-forms",           label: "Native Forms",         hidden: true },
  { value: "document-forms",         label: "Document Forms",       hidden: true },
  { value: "fillout-submissions",    label: "Fillout Submissions",  hidden: true },
  { value: "coaching-applications",  label: "Coaching Applications",hidden: true },
] as const;
export type TabKey = typeof TABS[number]["value"];

export const DEFAULT_TAB: TabKey = "submissions";
// v2: everyone lands on the new Submissions once (the old default, Reviews, is under More now).
export const LAST_TAB_KEY = "jf-admin-forms-last-tab-v2";

// Legacy tab keys → canonical tabs. Keeps old bookmarks and redirect stubs
// working when the user lands here directly.
export const LEGACY_TAB_ALIAS: Record<string, TabKey> = {
  "native-forms": "builder",
  "document-forms": "builder",
  "website-forms": "builder",
  "fillout-submissions": "fillout",
  "coaching-applications": "applications",
};

/** The Forms tab's sub-list an old key meant (`sub`). */
export const LEGACY_SUB: Record<string, string> = {
  "document-forms": "document-forms",
  "website-forms": "website",
};

export function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

export const isMoreTab = (t: TabKey) => TABS.some((x) => x.value === t && "more" in x && x.more);
