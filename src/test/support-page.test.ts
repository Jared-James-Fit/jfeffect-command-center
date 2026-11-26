import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("the public /support page", () => {
  const page = read("src/routes/support.tsx");
  it("is a route that shows the support email as a mailto link", () => {
    expect(page).toContain('createFileRoute("/support")');
    expect(page).toContain('SUPPORT_EMAIL = "support@jfeffect.com"');
    expect(page).toContain("mailto:${SUPPORT_EMAIL}");
    expect(page).toContain('title="Support"');
  });
  it("is registered in the route tree, outside the signed-in layout", () => {
    const tree = read("src/routeTree.gen.ts");
    expect(tree).toContain("'/support': typeof SupportRoute");
    expect(tree).toContain("getParentRoute: () => rootRouteImport");
    expect(tree).not.toMatch(/'\/_authenticated\/support'/);
    expect(page).not.toContain("redirect(");
  });
  it("is linked from the public footer", () => {
    expect(read("src/components/sales/sales-page-shell.tsx")).toContain('to="/support"');
  });
});
