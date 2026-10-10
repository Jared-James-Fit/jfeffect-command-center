import { describe, expect, it } from "vitest";
import { alertItem, filterSupportItems, parseSupportSub, supportCounts, supportSub, ticketItem } from "@/lib/support-inbox";

const ticket = (o: any) => ticketItem({ id: "t1", status: "open", created_at: "2026-10-01T00:00:00Z", member: { full_name: "Bob Smith" }, ...o });
const alert = (o: any) => alertItem({ id: "a1", status: "open", client_id: "c1", created_at: "2026-10-02T00:00:00Z", clients: { full_name: "Jen M" }, ...o }, "Workout logger failed", "Couldn't load");

describe("support inbox", () => {
  it("puts open tickets and unresolved alerts under Needs you", () => {
    const items = [ticket({}), ticket({ id: "t2", status: "answered" }), ticket({ id: "t3", status: "closed" }), alert({}), alert({ id: "a2", status: "resolved" })];
    expect(filterSupportItems(items, "needs").map((i) => i.id)).toEqual(["a1", "t1"]);
    expect(filterSupportItems(items, "members").map((i) => i.id).sort()).toEqual(["t1", "t2"]);
    expect(filterSupportItems(items, "alerts").map((i) => i.id)).toEqual(["a1"]);
    expect(filterSupportItems(items, "done").map((i) => i.id).sort()).toEqual(["a2", "t3"]);
    expect(supportCounts(items)).toEqual({ needs: 2, members: 2, alerts: 1, done: 2 });
  });

  it("previews the last message and marks staff replies", () => {
    const t = ticket({ last_message: { body: "Thanks!\n see you", sender_role: "admin", category: "reply" } });
    expect(t.preview).toBe("You: Thanks! see you");
    expect(ticket({ last_message: { body: "App crashed", sender_role: "member", category: "bug" } }).title).toBe("Bug report");
    expect(alert({ client_id: null }).name).toBe("System check");
  });

  it("round-trips the open conversation in the URL", () => {
    const id = "0076110b-cd9c-4459-9ac4-42df8bee5ca5";
    expect(parseSupportSub(supportSub("alert", id))).toEqual({ kind: "alert", id });
    expect(parseSupportSub("gifs")).toBeNull();
  });
});
