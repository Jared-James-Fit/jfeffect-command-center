import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wellFormed } from "@/lib/well-formed";

describe("wellFormed", () => {
  it("drops half an emoji left by a cut and keeps whole ones", () => {
    // Ashley's 600-character message ended in 🫡: .slice(0, 600) kept its first half only.
    const message = `${"x".repeat(599)}🫡`;
    const cut = message.slice(0, 600);
    expect(cut.isWellFormed()).toBe(false);
    expect(wellFormed(cut)).toBe("x".repeat(599));
    expect(JSON.parse(JSON.stringify(wellFormed(cut)))).toBe("x".repeat(599));
    expect(wellFormed("on! 🫡 💪🔥 é ✓")).toBe("on! 🫡 💪🔥 é ✓");
    expect(wellFormed("\uDC00start")).toBe("start");
    expect(wellFormed("a\uD83Db\uDE00")).toBe("ab");
  });

  it("everything Cleo sends a model goes through it: each lookup's answer, the instructions and the chat", () => {
    for (const f of ["src/lib/cleo-tools.server.ts", "src/lib/cleo-program.server.ts"]) expect(readFileSync(f, "utf8")).toContain("return wellFormed(clip(await fn(args)));");
    const cleo = readFileSync("src/lib/summer.server.ts", "utf8");
    expect(cleo).toContain("const system = wellFormed([");
    expect(cleo).toContain('content: wellFormed(m.content)');
    expect(cleo).toContain("const ask = wellFormed(");
  });
});
