import { describe, expect, it } from "vitest";
import {
  CLIENT_WORKSPACE_MORE_TABS,
  CLIENT_WORKSPACE_PRIMARY_TABS,
} from "@/components/clients/client-workspace-tab-model";

const ALL_CLIENT_WORKSPACE_TABS = [
  "summary",
  "info",
  "goals-setup",
  "coaching",
  "account",
  "training",
  "analytics",
  "nutrition",
  "metrics",
  "messages",
  "lift-videos",
  "documents",
  "sessions",
  "purchases",
  "billing",
  "agreements",
  "notes",
] as const;

describe("client workspace tabs", () => {
  it("keeps every existing client workspace panel reachable exactly once", () => {
    const tabValues = [
      ...CLIENT_WORKSPACE_PRIMARY_TABS.map((tab) => tab.value),
      ...CLIENT_WORKSPACE_MORE_TABS.map((tab) => tab.value),
    ];

    expect(tabValues).toHaveLength(ALL_CLIENT_WORKSPACE_TABS.length);
    expect(new Set(tabValues)).toEqual(new Set(ALL_CLIENT_WORKSPACE_TABS));
  });

  it("keeps the high-frequency coaching workflows in the primary tab bar", () => {
    expect(CLIENT_WORKSPACE_PRIMARY_TABS.map((tab) => tab.value)).toEqual([
      "summary",
      "training",
      "nutrition",
      "messages",
      "documents",
      "purchases",
    ]);
  });
});
