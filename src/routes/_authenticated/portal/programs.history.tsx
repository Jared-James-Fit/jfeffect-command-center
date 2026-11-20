import { createFileRoute } from "@tanstack/react-router";
import { ProgramHistoryPage } from "@/components/athlete-programs/program-history";

// Programs a member paused, ended or switched from: resume, start over or remove.
export const Route = createFileRoute("/_authenticated/portal/programs/history")({
  component: ProgramHistoryPage,
});
