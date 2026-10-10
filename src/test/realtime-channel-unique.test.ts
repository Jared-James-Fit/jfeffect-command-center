import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: (name: string) => ({ name }) },
}));

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "test") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("listen-only realtime channels never share a name", () => {
  it("gives every call its own channel name", async () => {
    const { listenChannel } = await import("@/lib/realtime-channel");
    const a = listenChannel("admin-nav-badges-u1") as any;
    const b = listenChannel("admin-nav-badges-u1") as any;
    expect(a.name).not.toBe(b.name);
    expect(a.name.startsWith("admin-nav-badges-u1#")).toBe(true);
  });

  it("only presence / broadcast channels still open a fixed name (they need the shared topic)", () => {
    const fixed = walk("src")
      .filter((p) => !p.endsWith("realtime-channel.ts"))
      .flatMap((p) => {
        const s = readFileSync(p, "utf8");
        return [...s.matchAll(/supabase\s*\.channel\(/g)].map(() => p.replace(/\\/g, "/"));
      });
    expect([...new Set(fixed)].sort()).toEqual([
      "src/components/message-thread.tsx", // typing (broadcast)
      "src/hooks/use-chat-presence.tsx", // who's online
      "src/hooks/use-group-presence.tsx", // who's online in a group
      "src/lib/community.queries.ts", // comment sync (broadcast, ref-counted)
    ]);
  });

  it("the admin nav badges (opened by the shell and the Communication page at once) use it", () => {
    expect(readFileSync("src/hooks/use-admin-nav-badges.ts", "utf8")).toContain("listenChannel(`admin-nav-badges-${user.id}`)");
  });
});
