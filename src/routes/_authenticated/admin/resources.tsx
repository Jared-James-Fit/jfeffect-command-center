import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/resources")({ component: () => <ComingSoon title="Resource Library" phase="Phase 2" /> });