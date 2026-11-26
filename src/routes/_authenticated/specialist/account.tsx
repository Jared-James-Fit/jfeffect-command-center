import { createFileRoute } from "@tanstack/react-router";
import { SpecialistAccount } from "@/components/specialist/specialist-account";

export const Route = createFileRoute("/_authenticated/specialist/account")({
  head: () => ({ meta: [{ title: "Your account — JF Effect" }] }),
  component: SpecialistAccount,
});
