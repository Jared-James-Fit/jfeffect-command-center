import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/sops")({ component: () => <ComingSoon title="SOPs & Business Systems" phase="Phase 3" /> });