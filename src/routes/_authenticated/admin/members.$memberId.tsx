import { createFileRoute } from "@tanstack/react-router";
import { MemberProfileRoute } from "@/route-pages/_authenticated/admin/members.$memberId";

export const Route = createFileRoute("/_authenticated/admin/members/$memberId")({ component: MemberProfileRoute });
