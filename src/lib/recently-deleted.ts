/**
 * Recently deleted, in words (20270226090000_account_recently_deleted.sql):
 * nothing is deleted on the spot; an account waits 30 days, restorable the
 * whole time, then it's deleted for good. Pure (recently-deleted.test.ts).
 */
import { format } from "date-fns";

export const RESTORE_DAYS = 30;
const DAY_MS = 86_400_000;

/** Whole days until it's deleted for good (0 = today). */
export function daysLeft(purgeAfter: string | Date, now: Date = new Date()): number {
  const t = typeof purgeAfter === "string" ? Date.parse(purgeAfter) : purgeAfter.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

/** "Deletes in 23 days", "Deletes tomorrow", "Deletes today". */
export function deletesInLabel(purgeAfter: string | Date, now: Date = new Date()): string {
  const n = daysLeft(purgeAfter, now);
  if (n <= 0) return "Deletes today";
  if (n === 1) return "Deletes tomorrow";
  return `Deletes in ${n} days`;
}

/** "Dec 10" */
export function purgeDay(purgeAfter: string | Date): string {
  const d = typeof purgeAfter === "string" ? new Date(purgeAfter) : purgeAfter;
  return Number.isFinite(d.getTime()) ? format(d, "MMM d") : "in 30 days";
}

/** The date it would be deleted if deleted now. */
export function purgeDateFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESTORE_DAYS * DAY_MS);
}

/** What deleting your own account does, said before the tap. */
export function selfDeleteCopy(now: Date = new Date()): {
  title: string;
  lines: string[];
  action: string;
} {
  const day = purgeDay(purgeDateFrom(now));
  return {
    title: "Delete your account?",
    lines: [
      `It goes to Recently deleted for ${RESTORE_DAYS} days. Sign back in any time before ${day} and tap Restore, and everything comes back: your workouts, PRs, programs and posts.`,
      `After ${day} it's deleted for good and can't be brought back.`,
      "While it waits you're signed out and hidden from the Crew.",
    ],
    action: "Delete account",
  };
}

/** What an admin's Delete does, said before the tap. */
export function adminDeleteCopy(
  name: string | null | undefined,
  now: Date = new Date(),
): {
  title: string;
  lines: string[];
  action: string;
} {
  const who = name?.trim() || "this account";
  const day = purgeDay(purgeDateFrom(now));
  return {
    title: `Delete ${who}?`,
    lines: [
      `It moves to Recently deleted for ${RESTORE_DAYS} days: off the list, signed out of the app and hidden from the Crew. Restore it any time before ${day} and everything comes back.`,
      `After ${day} it's deleted for good. Chats are never deleted: if they have any, the record stays deactivated instead.`,
    ],
    action: "Move to Recently deleted",
  };
}

/** After it's in the bin. */
export function deletedToast(
  name: string | null | undefined,
  purgeAfter: string | null | undefined,
): string {
  const who = name?.trim() || "Account";
  return `${who} is in Recently deleted. Restore it any time before ${purgeAfter ? purgeDay(purgeAfter) : "30 days are up"}.`;
}

/** The screen someone sees signing in while their account is in the bin. */
export function restoreGateCopy(
  r: { purge_after: string; source: "self" | "admin" | string },
  now: Date = new Date(),
): {
  title: string;
  body: string;
} {
  const day = purgeDay(r.purge_after);
  const left = daysLeft(r.purge_after, now);
  const when = left <= 0 ? "today" : left === 1 ? "tomorrow" : `on ${day}`;
  return r.source === "admin"
    ? {
        title: "Your account was deleted",
        body: `JF Effect deleted your account. It'll be gone for good ${when}. If you think this is a mistake, contact support before then and we can bring it back.`,
      }
    : {
        title: "Your account is set to be deleted",
        body: `You deleted your account. It'll be gone for good ${when}. Restore it and everything comes back just as you left it.`,
      };
}
