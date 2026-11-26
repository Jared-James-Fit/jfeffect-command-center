/** Setup scope, not access control. All services keep the same client identity. */
export function accountSetupRequirements(tier: string | null | undefined, packageSlugs: readonly string[], hasHandling: boolean) {
  const coaching = tier !== "self_serve";
  const nutritionOnly = coaching && !hasHandling && packageSlugs.length > 0 && packageSlugs.every(s => s === "nutrition");
  return {
    memberSetup: !coaching,
    basicInfo: coaching || hasHandling,
    headshot: coaching || hasHandling,
    coachingGoals: coaching,
    // Intake is account context, not access to a paid coaching service.
    generalGoals: coaching || hasHandling,
    trainingSchedule: coaching && !nutritionOnly,
    nutritionOnly,
  };
}


/** The server supplies only active upcoming handling meets, in date order. */
export function firstPendingHandlingMeet<T extends { id: string; done: boolean }>(meets: readonly T[]): T | undefined {
  return meets.find(meet => !meet.done);
}

/** One progress calculation for the Home checklist and non-blocking launch reminder. */
export function accountSetupProgress<T extends { key: string; done: boolean; optional?: boolean }>(items: readonly T[]) {
  const required = items.filter(item => !item.optional);
  const open = required.filter(item => !item.done);
  return { required, open, done: required.length - open.length, needsReminder: open.some(item => item.key !== "agreement") };
}
