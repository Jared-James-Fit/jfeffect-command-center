import { createFileRoute } from "@tanstack/react-router";
import { RecipesRedirect } from "@/route-pages/_authenticated/admin/recipes";

export const Route = createFileRoute("/_authenticated/admin/recipes")({ component: RecipesRedirect });
