import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("the phone top bar is a real fixed bar, so iOS never blurs it", () => {
  const shell = read("src/components/app-shell.tsx");
  const css = read("src/styles.css");

  it("is fixed at the top edge, opaque, full width, the notch inside it", () => {
    expect(shell).toContain(
      'className="shell-bar fixed inset-x-0 top-[var(--app-chrome-top)] z-40 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/60 bg-background px-2 md:hidden"',
    );
    expect(shell).toContain('style={{ paddingTop: "var(--app-safe-top)" }}\n          data-shell-bar');
    // no blur or see-through background: Safari reads either as several colours
    const bar = shell.slice(shell.indexOf('className="shell-bar'), shell.indexOf("data-shell-bar\n"));
    expect(bar).not.toContain("backdrop-blur");
    expect(bar).not.toMatch(/bg-background\/\d/);
  });

  it("holds its room in the page, at its own height whatever the keyboard does", () => {
    expect(shell).toContain('style={{ height: "calc(var(--app-safe-top) + 3rem + 1px)" }} data-shell-bar-room');
    // the bar is h-12 (3rem) plus its 1px border: the same 49px --shell-topbar-h says
    expect(css).toContain(":root { --shell-topbar-h: 49px; }");
  });

  it("slides away reading down like Crew's bar, and steps aside while typing", () => {
    expect(shell).toContain('import { useBarHidden } from "@/components/community/crew-header";');
    expect(shell).toContain("const shellBarHidden = useBarHidden(!pageBar);");
    expect(shell).toContain('data-hidden={shellBarHidden ? "" : undefined}');
    expect(css).toContain(".shell-bar[data-hidden] { transform: translateY(calc(-100% - var(--app-chrome-top))); }");
    expect(css).toContain('html[data-keyboard-open="true"] .shell-bar { visibility: hidden; }');
  });

  it("the light / dark switch is neutral, weighing the same as the bar's other buttons", () => {
    const toggle = read("src/components/theme-toggle.tsx");
    expect(toggle).toContain('"bg-secondary",');
    expect(toggle).not.toContain("oklch(0.32_0.03_275)");
    expect(toggle).not.toContain("shadow-[inset_");
  });
});
