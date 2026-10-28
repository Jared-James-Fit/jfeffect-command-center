/**
 * A meal plan pasted from ChatGPT's copy button (or any Markdown export)
 * back to the plain text it was written as. ChatGPT copies a single line
 * break as a trailing backslash ("75 g Oats (dry weight)\") and escapes
 * punctuation ("1\. Weigh chicken…"), which showed as a slash after every
 * food and broke the macro lines. Also drops **bold** and "## " heading
 * marks. Plain text passes through unchanged.
 *
 * The database does the same on every save (`nutrition_plain_text`,
 * 20270104092000_nutrition_plain_text.sql); keep the two in step
 * (plain-paste.test.ts runs the shared cases).
 */
export function plainPastedText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // A line break written as a trailing backslash.
      .replace(/[ \t]*\\[ \t]*$/gm, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/^#{1,6}[ \t]+/gm, "")
      // A backslash before ASCII punctuation is Markdown's escape.
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
  );
}

/** `plainPastedText` for a nullable column value. */
export function plainOrNull<T extends string | null | undefined>(text: T): T {
  return (typeof text === "string" ? plainPastedText(text) : text) as T;
}
