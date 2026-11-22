/**
 * What someone confirms before importing a meal plan, and what the app says
 * about it, in one place (the import screen shows it, the server stores the
 * exact words with the import). Adapted from the program importer's
 * (program-import/rights.ts): a tick is a record that the person said so, not
 * a legal guarantee. What protects the plan's author is that an imported plan
 * is private to the person who imported it and never shared. Pure.
 */

export const MEAL_IMPORT_RIGHTS_TEXT =
  "I confirm that I wrote this meal plan or have the right or permission to upload and use it in JF Effect.";

export const MEAL_IMPORT_RIGHTS_EXPLAINER =
  "A plan from a dietitian, a coach or an app is usually yours to follow, not to share. Your imported plan stays private to you.";

/** The coach's version: they're bringing in a plan for a client. */
export const MEAL_IMPORT_RIGHTS_TEXT_STAFF =
  "I confirm that I wrote this meal plan or have the right or permission to use it for this client in JF Effect.";

/** How long what's uploaded is kept (said on the import screen and enforced by the cleanup). */
export const MEAL_IMPORT_FILE_DAYS = 7;
export const MEAL_IMPORT_ROW_DAYS = 30;

export const MEAL_IMPORT_PRIVACY_TEXT = `Your file is only used to bring in this plan. It's deleted from our servers when you open the plan to edit or discard the import, and within ${MEAL_IMPORT_FILE_DAYS} days either way. What was read from it is kept ${MEAL_IMPORT_ROW_DAYS} days so you can come back to it. If it needs a full read, it's sent to our AI provider, OpenAI, to be read and isn't used to train their models.`;

/** The two kinds of rights text the server accepts (the database stores which one was ticked). */
export function rightsTextFor(audience: "member" | "staff"): string {
  return audience === "staff" ? MEAL_IMPORT_RIGHTS_TEXT_STAFF : MEAL_IMPORT_RIGHTS_TEXT;
}
