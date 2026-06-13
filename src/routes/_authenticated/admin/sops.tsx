import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
import { SettingsTabs } from "@/components/settings/settings-tabs";
export const Route = createFileRoute("/_authenticated/admin/sops")({
  component: () => (
    <>
      <SettingsTabs />
      <ComingSoon title="SOPs & Business Systems" phase="Phase 3" />
    </>
  ),
});
