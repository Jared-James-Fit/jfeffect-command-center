// Tab ids for the admin client workspace. Lives outside the page so the route file stays tiny.
export const TAB_VALUES = ["summary", "training", "nutrition", "metrics", "documents", "sessions", "purchases", "info", "goals-setup", "coaching", "notes", "account"] as const;
export type TabValue = typeof TAB_VALUES[number];
