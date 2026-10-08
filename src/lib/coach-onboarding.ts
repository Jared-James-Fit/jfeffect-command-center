/**
 * Coach onboarding rules, kept pure so they're testable.
 *
 * acceptCoachInvite runs for anyone who signs in through /setup with a
 * coach_id in their metadata, so it must only ever activate a coach row that
 * is still waiting on that person. A deactivated coach who can still sign in
 * must not be able to reactivate themselves by calling it again.
 */
export type CoachRowForAccept = {
  email: string;
  user_id: string | null;
  status: string | null;
  archived: boolean | null;
};

export type CoachAcceptDecision =
  | { action: "activate" }
  | { action: "noop" }
  | { action: "refuse"; reason: "email_mismatch" | "linked_to_other_user" | "not_pending" };

export function decideCoachInviteAcceptance(
  coach: CoachRowForAccept,
  user: { id: string; email: string },
): CoachAcceptDecision {
  if (coach.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { action: "refuse", reason: "email_mismatch" };
  }
  if (coach.user_id && coach.user_id !== user.id) {
    return { action: "refuse", reason: "linked_to_other_user" };
  }
  // Already set up: signing in through /setup again changes nothing.
  if (coach.user_id === user.id && coach.status === "Active" && !coach.archived) {
    return { action: "noop" };
  }
  // Inactive / Suspended / Archived are an admin's decision; only an admin
  // switches them back on. Rows added for call routing start as Active with
  // no login yet, so those can still be linked.
  if (coach.archived || !(coach.status === "Pending Invite" || coach.status === "Active")) {
    return { action: "refuse", reason: "not_pending" };
  }
  return { action: "activate" };
}

/** Coaches a client can be assigned to: not archived, not switched off. */
export function isAssignableCoach(coach: { status: string | null; archived: boolean | null }): boolean {
  return !coach.archived && (coach.status === "Active" || coach.status === "Pending Invite");
}
