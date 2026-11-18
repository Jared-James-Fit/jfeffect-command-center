/**
 * Text a model API will take. A `.slice()` through an emoji (two UTF-16 code units) leaves half of
 * it, a lone surrogate, and OpenAI refuses the whole request body ("failed to parse JSON value"),
 * so every model fails on the same text. Pure, tested (well-formed.test.ts).
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The text with any half of a character dropped; whole emoji and everything else kept as is. */
export function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "");
}
