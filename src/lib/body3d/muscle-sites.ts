/**
 * Which training muscle (training-load.ts' FineMuscle) each part of the
 * anatomical drawing belongs to (pure, tested). Parts that aren't a trained
 * muscle (joints, tendons, bone, the neck's small muscles) map to nothing and
 * are drawn as skin.
 */
import type { FineMuscle } from "@/lib/analytics/training-load";

export const SITE_MUSCLE: Record<string, FineMuscle> = {
  rectus_femoris: "Quads",
  vastus_lateralis: "Quads",
  vmo: "Quads",
  quad_tendon: "Quads",
  hamstring_outer: "Hamstrings",
  hamstring_inner: "Hamstrings",
  high_hamstring: "Hamstrings",
  glute_max: "Glutes",
  glute_med: "Glutes",
  glute_min: "Glutes",
  tfl: "Glutes",
  hip_outer: "Glutes",
  piriformis: "Glutes",
  adductors: "Adductors",
  groin: "Adductors",
  sartorius: "Adductors",
  calf_inner: "Calves",
  calf_outer: "Calves",
  soleus: "Calves",
  chest: "Chest",
  upper_chest: "Chest",
  pec_minor: "Chest",
  lats: "Lats",
  teres_major: "Lats",
  upper_trap: "Upper back",
  mid_trap: "Upper back",
  lower_trap: "Upper back",
  rhomboids: "Upper back",
  infraspinatus: "Upper back",
  teres_minor: "Upper back",
  supraspinatus: "Upper back",
  levator_scap: "Upper back",
  erectors_mid: "Erectors",
  erectors_low: "Erectors",
  ql: "Erectors",
  front_delt: "Front delts",
  side_delt: "Side delts",
  rear_delt: "Rear delts",
  biceps: "Biceps",
  brachialis: "Biceps",
  triceps: "Triceps",
  forearm_flexors: "Forearms",
  forearm_extensors: "Forearms",
  brachioradialis: "Forearms",
  abs: "Abs",
  obliques: "Abs",
  serratus: "Abs",
};

export function muscleOfSite(site: string | null | undefined): FineMuscle | null {
  return site ? (SITE_MUSCLE[site] ?? null) : null;
}
