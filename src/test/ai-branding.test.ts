/**
 * AI is the engine, not the product (Nov 22 2026). Features are named for what
 * they do, never decorated as AI; only Cleo is presented as an AI assistant.
 * See AGENTS.md ("AI is the engine…").
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "test" && dir === SRC) continue;
    if (name === "node_modules") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.(tsx?|jsx?)$/.test(name) && name !== "routeTree.gen.ts") out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));

/** The icons that say "AI" in today's UI: never used, anywhere. */
const AI_ICONS = new Set(["Sparkles", "Sparkle", "WandSparkles", "Wand", "Wand2", "Bot", "BotMessageSquare", "BotOff", "Brain", "BrainCircuit", "BrainCog"]);

function lucideImports(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("AI is the engine, not the product", () => {
  it("no sparkle, wand, robot or brain icon anywhere in the app", () => {
    const hits = FILES.flatMap((f) => lucideImports(f.text).filter((n) => AI_ICONS.has(n)).map((n) => `${f.path}: ${n}`));
    expect(hits).toEqual([]);
  });

  it("features are named for what they do, not for the AI behind them", () => {
    const OLD = [
      "Edit with AI",
      "Change it with AI",
      "Fill in with AI",
      "Write it with AI",
      "Draft with AI",
      "Fix the meals with AI",
      "Ask AI to interpret",
      "Copy AI coaching prompt",
      "Read with AI",
      "AI interpretation",
      "AI-assisted draft",
    ];
    // The running programs' coach guide is installed program text (20270321090000_jf_effect_running_library.sql,
    // generated from this file and already in production's templates): renaming it here wouldn't change what
    // a coach reads, so it stays until the coach edits those templates.
    const INSTALLED = new Set(["lib/jf-programs/running.ts"]);
    const hits = FILES.filter((f) => !INSTALLED.has(f.path)).flatMap((f) =>
      f.text
        .split("\n")
        .map((line, i) => ({ line, i }))
        // Comments may name the old label to explain the history; screens may not.
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter(({ line }) => OLD.some((o) => line.includes(o)))
        .map(({ line, i }) => `${f.path}:${i + 1}: ${line.trim().slice(0, 120)}`),
    );
    expect(hits).toEqual([]);
  });

  it("no AI-style glow: no gradient orb on Cleo, no violet tint for anything AI-made", () => {
    const chat = FILES.find((f) => f.path === "components/admin/books/summer-chat.tsx")!.text;
    expect(chat).not.toMatch(/bg-gradient|from-amber-300|to-pink-500/);
    const label = FILES.find((f) => f.path === "components/legal/ai-assistance-label.tsx")!.text;
    expect(label).not.toMatch(/violet|purple/);
  });

  it("Cleo is the one AI identity, and says so where people talk to it", () => {
    const avatar = FILES.find((f) => f.path === "components/summer/cleo-avatar.tsx")!.text;
    expect(avatar).toContain('CLEO_ROLE_LINE = "AI assistant"');
    for (const p of ["components/admin/books/summer-chat.tsx", "route-pages/_authenticated/admin/messages.tsx"]) {
      expect(FILES.find((f) => f.path === p)!.text, p).toContain("CLEO_ROLE_LINE");
    }
  });
});
