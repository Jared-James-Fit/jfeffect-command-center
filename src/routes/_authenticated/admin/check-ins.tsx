import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/check-ins")({ component: () => <ComingSoon title="Check-In Review" phase="Phase 2" /> });