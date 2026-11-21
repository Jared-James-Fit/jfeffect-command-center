/**
 * What someone confirms before importing a program, and what the app says
 * about it, in one place (the import screen shows it, the server stores the
 * exact words with the import). A checkbox is a record that the person said
 * so, not a legal guarantee: the protections that matter are that an imported
 * program is private to its owner, never added to the program library, and
 * shared with the crew only by its owner's own explicit choice (with a
 * reminder that they need the right to share it). Pure.
 */

export const IMPORT_RIGHTS_TEXT =
  "I confirm that I created this program or have the necessary rights or permission to upload and use it in JF Effect.";

export const IMPORT_RIGHTS_EXPLAINER =
  "Buying a program usually lets you follow it yourself, not share it. Your imported program stays private to you.";

/** How long what's uploaded is kept (said on the import screen and enforced by the cleanup). */
export const IMPORT_FILE_DAYS = 7;
export const IMPORT_ROW_DAYS = 30;

export const IMPORT_PRIVACY_TEXT = `Your file is only used to build this program. It's deleted from our servers when you save or discard the import, and within ${IMPORT_FILE_DAYS} days either way. What was read from it is kept ${IMPORT_ROW_DAYS} days so you can come back to it. If it needs AI to read it, it's sent to our AI provider, OpenAI, to be read and isn't used to train their models.`;

/** The reminder before sharing a program that was imported. */
export const IMPORTED_SHARE_WARNING =
  "This program was imported from a file. Only share it with the crew if you wrote it or have permission to share it: buying a program usually doesn't include that.";
