import { describe, expect, it } from "vitest";
import { formatLegalText } from "@/components/legal/legal-document-body";

describe("legal document formatting", () => {
  it("preserves every line of legal wording and separates headings and bullets", () => {
    const body = "1. Scope\nA paragraph.\n\nAI services (OpenAI and Google)\nSome features use AI.\n- OpenAI receives: meal details.\n- Google receives: voice memos.";
    const lines = formatLegalText(body);
    expect(lines.map((line) => line.text).join("\n")).toBe(body);
    expect(lines.map((line) => line.kind)).toEqual(["heading", "text", "space", "heading", "text", "bullet", "bullet"]);
  });
  it("treats unknown and HTML-like content as literal text", () => {
    const body = '<script>alert("test")</script>\n  Existing clause wording.';
    expect(formatLegalText(body)).toEqual([{ kind: "text", text: '<script>alert("test")</script>' }, { kind: "text", text: "  Existing clause wording." }]);
  });
});
