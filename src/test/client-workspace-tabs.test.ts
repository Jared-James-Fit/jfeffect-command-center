import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIENT_WORKSPACE_MORE_TABS,
  CLIENT_WORKSPACE_PRIMARY_TABS,
  LEGACY_WORKSPACE_TABS,
} from "@/components/clients/client-workspace-tab-model";

const ALL_CLIENT_WORKSPACE_TABS = [
  "summary",
  "training",
  "nutrition",
  "metrics",
  "documents",
  "sessions",
  "purchases",
  "info",
  "goals-setup",
  "coaching",
  "notes",
  "account",
] as const;

describe("client workspace tabs", () => {
  it("keeps every client workspace tab reachable exactly once", () => {
    const tabValues = [
      ...CLIENT_WORKSPACE_PRIMARY_TABS.map((tab) => tab.value),
      ...CLIENT_WORKSPACE_MORE_TABS.map((tab) => tab.value),
    ];
    expect(tabValues).toHaveLength(ALL_CLIENT_WORKSPACE_TABS.length);
    expect(new Set(tabValues)).toEqual(new Set(ALL_CLIENT_WORKSPACE_TABS));
  });

  it("keeps the coaching workflows and Account in the primary tab bar, profile pages under More", () => {
    expect(CLIENT_WORKSPACE_PRIMARY_TABS.map((tab) => tab.value)).toEqual([
      "summary",
      "training",
      "nutrition",
      "metrics",
      "documents",
      "sessions",
      "purchases",
      "account",
    ]);
    expect(CLIENT_WORKSPACE_MORE_TABS.map((tab) => tab.value)).toEqual(["info", "goals-setup", "coaching", "notes"]);
    expect(CLIENT_WORKSPACE_PRIMARY_TABS.find((tab) => tab.value === "account")?.label).toBe("Account");
  });

  it("flags Account with a dot until the client is set up", () => {
    const bar = readFileSync("src/components/clients/client-workspace-tabs.tsx", "utf8");
    expect(bar).toContain("const flag = attention?.[item.value];");
    const profile = readFileSync("src/route-pages/_authenticated/admin/clients.$id.tsx", "utf8");
    expect(profile).toContain("access.needsAttention || form.needs_admin_help ? access.statusLabel : undefined");
  });

  it("redirects merged tabs to where their content lives now", () => {
    expect(LEGACY_WORKSPACE_TABS["program-setup"]).toBe("training");
    expect(LEGACY_WORKSPACE_TABS.analytics).toBe("metrics");
    expect(LEGACY_WORKSPACE_TABS["lift-videos"]).toBe("metrics");
    expect(LEGACY_WORKSPACE_TABS.agreements).toBe("documents");
    expect(LEGACY_WORKSPACE_TABS.billing).toBe("purchases");
    for (const target of Object.values(LEGACY_WORKSPACE_TABS)) {
      expect(ALL_CLIENT_WORKSPACE_TABS).toContain(target);
    }
  });

  it("no longer exposes a messages tab (messaging lives in the inbox)", () => {
    const tabValues = [
      ...CLIENT_WORKSPACE_PRIMARY_TABS.map((tab) => tab.value),
      ...CLIENT_WORKSPACE_MORE_TABS.map((tab) => tab.value),
    ];
    expect(tabValues).not.toContain("messages");
  });
});
