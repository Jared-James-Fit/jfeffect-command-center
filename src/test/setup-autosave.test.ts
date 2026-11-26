import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, RETRY_MS, createAutosave } from "@/lib/equipment/setup-autosave";
import { OUTBOX_KEEP_MS, parseOutbox, permanentRefusal } from "@/lib/equipment/setup-outbox";
import { draftChanged, formKey, savedForm, type SetupDraft } from "@/lib/equipment/setup-draft";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(opts: { fail?: () => boolean; slow?: number } = {}) {
  const sent: string[] = [];
  const statuses: string[] = [];
  const a = createAutosave<string>({
    savedKey: "v0",
    onStatus: (s) => statuses.push(s),
    save: async (v) => {
      if (opts.slow) await new Promise((r) => setTimeout(r, opts.slow));
      if (opts.fail?.()) throw new Error("Failed to fetch");
      sent.push(v);
    },
  });
  return { a, sent, statuses };
}

describe("the setup autosave", () => {
  it("sends a moment after typing pauses, once, the newest version", async () => {
    const { a, sent } = setup();
    a.change("v1", "v1");
    await vi.advanceTimersByTimeAsync(200);
    a.change("v2", "v2");
    await vi.advanceTimersByTimeAsync(200);
    a.change("v3", "v3");
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent).toEqual(["v3"]);
    expect(a.status()).toBe("saved");
  });

  it("never sends what's already saved (typed back to how it was)", async () => {
    const { a, sent } = setup();
    a.change("v1", "v1");
    a.change("v0", "v0");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(sent).toEqual([]);
  });

  it("flush sends at once (closing the sheet, switching equipment)", async () => {
    const { a, sent } = setup();
    a.change("v1", "v1");
    const ok = await a.flush();
    expect(ok).toBe(true);
    expect(sent).toEqual(["v1"]);
  });

  it("one save at a time; what's typed while one is on its way goes right after", async () => {
    const { a, sent } = setup({ slow: 500 });
    a.change("v1", "v1");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    expect(a.status()).toBe("saving");
    a.change("v2", "v2");
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toEqual(["v1"]);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 600);
    expect(sent).toEqual(["v1", "v2"]);
    expect(a.busy()).toBe(false);
  });

  it("a flush during a save waits for it and sends the newest too", async () => {
    const { a, sent } = setup({ slow: 300 });
    a.change("v1", "v1");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    a.change("v2", "v2");
    const done = a.flush();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(true);
    expect(sent).toEqual(["v1", "v2"]);
  });

  it("a failed save is tried again by itself, the change kept meanwhile", async () => {
    let down = true;
    const { a, sent } = setup({ fail: () => down });
    a.change("v1", "v1");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(a.status()).toBe("error");
    expect(a.pending()?.key).toBe("v1");
    down = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]);
    expect(sent).toEqual(["v1"]);
    expect(a.status()).toBe("saved");
    expect(a.busy()).toBe(false);
  });

  it("a flush with no signal says so (the sheet keeps it on the phone)", async () => {
    const { a } = setup({ fail: () => true });
    a.change("v1", "v1");
    await expect(a.flush()).resolves.toBe(false);
    expect(a.pending()?.key).toBe("v1");
  });

  it("reset: what's saved now is the base (a restore, another piece of equipment); nothing waits", async () => {
    const { a, sent } = setup();
    a.change("v1", "v1");
    a.reset("r1");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(sent).toEqual([]);
    a.change("r1", "r1");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(sent).toEqual([]);
  });

  it("disposed: no more timers", async () => {
    const { a, sent } = setup();
    a.change("v1", "v1");
    a.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(sent).toEqual([]);
  });
});

describe("the draft's stored form", () => {
  const d = (over: Partial<SetupDraft> = {}): SetupDraft => ({ fields: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "" }], notes: "", photos: [], ...over });
  it("an offered setting left empty or spaces in the note change nothing", () => {
    expect(draftChanged(d({ notes: "  " }), d())).toBe(false);
    expect(draftChanged(d({ fields: [{ label: "J-hooks", value: "9" }] }), d())).toBe(false);
  });
  it("a value, a note or a photo is a change; its order too", () => {
    expect(draftChanged(d({ notes: "feet wide" }), d())).toBe(true);
    expect(draftChanged(d({ photos: ["c/a.jpg"] }), d())).toBe(true);
    expect(draftChanged(d({ photos: ["c/b.jpg", "c/a.jpg"] }), d({ photos: ["c/a.jpg", "c/b.jpg"] }))).toBe(true);
  });
  it("photos stored once each, 4 at most", () => {
    expect(savedForm(d({ photos: ["c/a", "c/a", "c/b", "c/c", "c/d", "c/e"] })).photos).toEqual(["c/a", "c/b", "c/c", "c/d"]);
    expect(formKey(d())).toBe(JSON.stringify({ settings: [{ label: "J-hooks", value: "9" }], notes: null, photos: [] }));
  });
});

describe("a change waiting on the phone", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const raw = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ clientId: "c", exerciseId: "e", equipmentId: null, settings: [{ label: "J-hooks", value: "9" }], notes: "x", photos: ["c/a.jpg"], at: now - 60_000, ...over });
  it("comes back while it's fresh", () => {
    expect(parseOutbox(raw(), now)).toMatchObject({ clientId: "c", exerciseId: "e", equipmentId: null, notes: "x", photos: ["c/a.jpg"] });
  });
  it("a week old is let go, and anything unreadable", () => {
    expect(parseOutbox(raw({ at: now - OUTBOX_KEEP_MS - 1 }), now)).toBeNull();
    expect(parseOutbox("{", now)).toBeNull();
    expect(parseOutbox(raw({ clientId: 5 }), now)).toBeNull();
  });
  it("a refusal for good lets it go; no signal keeps it", () => {
    expect(permanentRefusal({ code: "42501", message: "You can't change this athlete's equipment" })).toBe(true);
    expect(permanentRefusal({ code: "P0002" })).toBe(true);
    expect(permanentRefusal(new Error("Failed to fetch"))).toBe(false);
  });
});
