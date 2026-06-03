import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/calendar")({ component: () => <ComingSoon title="Calendar" phase="Phase 2" /> });