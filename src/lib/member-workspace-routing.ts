import type { TabValue } from "@/components/clients/client-tab-values";
const tabs: Record<string, TabValue> = { summary: "summary", subscription: "purchases", access: "account", setup: "info", sms: "account", notes: "notes" };
export function memberWorkspaceTab(tab?: string | null): TabValue {
  return tab && Object.prototype.hasOwnProperty.call(tabs, tab) ? tabs[tab]! : "summary";
}
