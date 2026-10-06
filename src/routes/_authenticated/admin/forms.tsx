import { createFileRoute } from "@tanstack/react-router";
import { LEGACY_TAB_ALIAS, LAST_TAB_KEY, isTab, type TabKey } from "@/route-pages/_authenticated/admin/forms-tabs";
import { FormsWorkspacePage } from "@/route-pages/_authenticated/admin/forms";

export const Route = createFileRoute("/_authenticated/admin/forms")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey; sub?: string } => {
    const t = raw?.tab;
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    if (typeof t === "string" && LEGACY_TAB_ALIAS[t]) {
      return { tab: LEGACY_TAB_ALIAS[t], sub };
    }
    if (isTab(t)) return { tab: t, sub };
    // URL takes priority; only consult localStorage when search is missing.
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(LAST_TAB_KEY);
        if (stored && LEGACY_TAB_ALIAS[stored]) return { tab: LEGACY_TAB_ALIAS[stored], sub };
        if (isTab(stored)) return { tab: stored, sub };
      } catch {}
    }
    return { tab: "reviews", sub };
  },
  component: FormsWorkspacePage,
});
