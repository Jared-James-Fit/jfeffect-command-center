/** Setup scope, not access control. All services keep the same client identity. */
export function accountSetupRequirements(tier: string | null | undefined, packageSlugs: readonly string[], hasHandling: boolean) {
  const coaching = tier !== "self_serve";
  const nutritionOnly = coaching && packageSlugs.length > 0 && packageSlugs.every(s => s === "nutrition");
  return {
    memberSetup: !coaching,
    basicInfo: coaching || hasHandling,
    headshot: coaching || hasHandling,
    coachingGoals: coaching,
    trainingSchedule: coaching && !nutritionOnly,
    nutritionOnly,
  };
}


/** The server supplies only active upcoming handling meets, in date order. */
export function firstPendingHandlingMeet<T extends { id: string; done: boolean }>(meets: readonly T[]): T | undefined {
  return meets.find(meet => !meet.done);
}
