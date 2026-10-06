import { createFileRoute } from "@tanstack/react-router";
import { SupportInboxRedirect } from "@/route-pages/_authenticated/admin/membership.support";

export const Route = createFileRoute("/_authenticated/admin/membership/support")({ component: SupportInboxRedirect });
