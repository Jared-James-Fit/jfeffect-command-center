import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/programs")({ component: () => <ComingSoon title="Program Update Tracker" phase="Phase 2" /> });