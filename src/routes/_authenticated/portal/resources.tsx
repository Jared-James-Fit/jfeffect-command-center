import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/portal/resources")({ component: () => <ComingSoon title="Resources" phase="Phase 2" /> });