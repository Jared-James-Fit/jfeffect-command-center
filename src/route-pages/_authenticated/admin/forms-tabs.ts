// Tab model for the admin Forms workspace. Kept out of the page module so the route file
// (which needs it for validateSearch) stays tiny and the page can load on demand.
//
// Forms is the primary library. Operational inboxes and management screens remain
// reachable through More and existing deep links.
export const TABS = [
  { value: "submissions",            label: "All submissions",     more: true },
  { value: "requests",               label: "Requests",            more: true },
  { value: "builder",                label: "Forms" },
  { value: "applications",           label: "Applications",        more: true },
  { value: "agreements",             label: "External agreements", more: true },
  { value: "reviews",                label: "Reply drafts",         more: true },
  { value: "fillout",                label: "Fillout inbox",        more: true },
  { value: "schedules",              label: "Check-in schedules",   more: true },
  { value: "scheduler",              label: "Scheduler",            more: true },
  // Which model drafts replies and its brand voice: AI infrastructure, the admin's only.
  { value: "ai-settings",            label: "AI settings",          more: true, adminOnly: true },
  { value: "integrations",           label: "Integrations",         more: true },
  // Legacy / hidden keys kept so old links keep working.
  { value: "website-forms",          label: "Website Forms",        hidden: true },
  { value: "native-forms",           label: "Native Forms",         hidden: true },
  { value: "document-forms",         label: "Document Forms",       hidden: true },
  { value: "fillout-submissions",    label: "Fillout Submissions",  hidden: true },
  { value: "coaching-applications",  label: "Coaching Applications",hidden: true },
] as const;
export type TabKey = typeof TABS[number]["value"];

export const DEFAULT_TAB: TabKey = "builder";
// v2: everyone lands on the new Submissions once (the old default, Reviews, is under More now).
export const LAST_TAB_KEY = "jf-admin-forms-last-tab-v3";

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

/** Tabs only the admin login sees (and opens). */
export const isAdminOnlyTab = (t: TabKey) => TABS.some((x) => x.value === t && "adminOnly" in x && x.adminOnly);

export const isMoreTab = (t: TabKey) => TABS.some((x) => x.value === t && "more" in x && x.more);
