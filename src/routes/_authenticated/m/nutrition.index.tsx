import { createFileRoute } from "@tanstack/react-router";
import { MemberNutritionPage } from "@/components/nutrition/member-nutrition-page";

export const Route = createFileRoute("/_authenticated/m/nutrition/")({
  component: MemberNutritionPage,
});
