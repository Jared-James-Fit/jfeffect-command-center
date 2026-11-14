import { describe, expect, it } from "vitest";
import { alertItem, filterSupportItems, parseSupportSub, supportCounts, supportSub } from "@/lib/support-inbox";

const alert = (o: any) => alertItem({ id: "a1", status: "open", client_id: "c1", created_at: "2026-10-02T00:00:00Z", clients: { full_name: "Jen M" }, ...o }, "Workout logger failed", "Couldn't load");

describe("app alerts (Communication → Alerts)", () => {
  it("puts unresolved alerts under Needs you and resolved ones under Resolved", () => {
    const items = [alert({}), alert({ id: "a2", status: "resolved" }), alert({ id: "a3", status: "in_progress", created_at: "2026-10-03T00:00:00Z" })];
    expect(filterSupportItems(items, "needs").map((i) => i.id)).toEqual(["a3", "a1"]);
    expect(filterSupportItems(items, "done").map((i) => i.id)).toEqual(["a2"]);
    expect(supportCounts(items)).toEqual({ needs: 2, done: 1 });
  });

  it("names the client, or System check for one with no client", () => {
    expect(alert({}).name).toBe("Jen M");
    expect(alert({ client_id: null }).name).toBe("System check");
  });

  it("round-trips the open alert in the URL; member tickets aren't here any more", () => {
    const id = "0076110b-cd9c-4459-9ac4-42df8bee5ca5";
    expect(parseSupportSub(supportSub(id))).toEqual({ kind: "alert", id });
    expect(parseSupportSub(`t:${id}`)).toBeNull();
    expect(parseSupportSub("gifs")).toBeNull();
  });
});
