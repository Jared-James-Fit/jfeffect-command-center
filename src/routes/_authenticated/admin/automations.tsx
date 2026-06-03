import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/automations")({ component: () => <ComingSoon title="Automation Ideas" phase="Phase 3" /> });