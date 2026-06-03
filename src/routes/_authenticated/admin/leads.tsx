import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/leads")({ component: () => <ComingSoon title="Lead Management" phase="Phase 2" /> });