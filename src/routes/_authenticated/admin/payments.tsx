import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/payments")({ component: () => <ComingSoon title="Payments" phase="Phase 3" /> });