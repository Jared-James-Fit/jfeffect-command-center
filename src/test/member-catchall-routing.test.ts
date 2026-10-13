import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

// The same shape as the app: /m/welcome (Stripe's success_url) is its own
// top-level route; /m/* lives under the pathless _authenticated layout with
// an index and a catch-all that only exist so the layout can redirect.
function build() {
  const root = createRootRoute();
  const welcome = createRoute({ getParentRoute: () => root, path: "/m/welcome" });
  const authed = createRoute({ getParentRoute: () => root, id: "_authenticated" });
  const m = createRoute({ getParentRoute: () => authed, path: "/m" });
  const mIndex = createRoute({ getParentRoute: () => m, path: "/" });
  const mSplat = createRoute({ getParentRoute: () => m, path: "$" });
  const form = createRoute({ getParentRoute: () => m, path: "forms/$assignmentId/complete" });
  const routeTree = root.addChildren([welcome, authed.addChildren([m.addChildren([mIndex, mSplat, form])])]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
}

const leaf = (router: ReturnType<typeof build>, path: string) => {
  const matches = router.matchRoutes(path, {});
  return matches[matches.length - 1]?.routeId;
};

describe("the /m catch-all never swallows a real page", () => {
  it("Stripe's /m/welcome and the Fillout landing keep their own pages; any other /m link reaches the redirecting layout", () => {
    const router = build();
    expect(leaf(router, "/m/welcome")).toBe("/m/welcome");
    expect(leaf(router, "/m/forms/abc/complete")).toBe("/_authenticated/m/forms/$assignmentId/complete");
    expect(leaf(router, "/m")).toBe("/_authenticated/m/");
    expect(leaf(router, "/m/billing")).toBe("/_authenticated/m/$");
    expect(leaf(router, "/m/workouts/e/1/2")).toBe("/_authenticated/m/$");
  });
});
