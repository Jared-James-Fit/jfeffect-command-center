import { createFileRoute } from "@tanstack/react-router";
import { ProgramLibraryRedirect } from "@/route-pages/_authenticated/admin/program-library";

export const Route = createFileRoute("/_authenticated/admin/program-library")({ component: ProgramLibraryRedirect });
