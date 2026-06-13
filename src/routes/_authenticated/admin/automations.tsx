import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
import { SettingsTabs } from "@/components/settings/settings-tabs";
export const Route = createFileRoute("/_authenticated/admin/automations")({
  component: () => (
    <>
      <SettingsTabs />
      <ComingSoon title="Automation Ideas" phase="Phase 3" />
    </>
  ),
});
