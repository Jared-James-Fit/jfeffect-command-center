import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/sales-calls")({ component: () => <ComingSoon title="Sales Call Tracker" phase="Phase 2" /> });