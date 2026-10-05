import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNotesSync, noteToRow, normalizeIds, reconcile, rowToNote, toSyncId,
  type Base, type NoteRow, type NotesApi, type SyncNote, type SyncStatus,
} from "@/lib/task-notes-sync";

// ------------------------------------------------------------ test doubles

class FakeServer {
  rows = new Map<string, NoteRow>();
  calls: string[] = [];
  down = false;
  missingTable = false;
  private guard() {
    if (this.missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (this.down) throw new Error("network down");
  }
  api(): NotesApi {
    return {
      fetch: async () => { this.calls.push("fetch"); this.guard(); return [...this.rows.values()].map((r) => ({ ...r })); },
      insert: async (n) => {
        this.calls.push("insert"); this.guard();
        if (this.rows.has(n.id)) return null;
        const row = { ...noteToRow(n), version: 1 };
        this.rows.set(n.id, row);
        return { ...row };
      },
      update: async (n, v) => {
        this.calls.push("update"); this.guard();
        const cur = this.rows.get(n.id);
        if (!cur || cur.version !== v) return null;
        const row = { ...noteToRow(n), version: v + 1 };
        this.rows.set(n.id, row);
        return { ...row };
      },
      remove: async (id, v) => {
        this.calls.push("remove"); this.guard();
        const cur = this.rows.get(id);
        if (!cur || cur.version !== v) return false;
        this.rows.delete(id);
        return true;
      },
    };
  }
}

let seq = 0;
const nid = () => toSyncId(`generated-${++seq}`);
const mk = (id: string, title: string, body = "", updatedAt = 1000, deletedAt?: number): SyncNote =>
  ({ id: toSyncId(id), title, body, updatedAt, ...(deletedAt ? { deletedAt } : {}) });

function device(server: FakeServer, initial: SyncNote[] = [], extra: { base?: Base; trustLocalDeletes?: boolean } = {}) {
  const d = {
    notes: initial,
    base: extra.base ?? ({} as Base),
    statuses: [] as SyncStatus[],
    engine: null as unknown as ReturnType<typeof createNotesSync>,
    edit(id: string, patch: Partial<SyncNote>) {
      d.notes = d.notes.map((n) => (n.id === toSyncId(id) ? { ...n, ...patch, updatedAt: Date.now() } : n));
    },
    byTitle: (t: string) => d.notes.find((n) => n.title === t),
  };
  d.engine = createNotesSync({
    api: server.api(),
    loadBase: () => d.base,
    saveBase: (b) => { d.base = b; },
    getLocal: () => d.notes,
    setLocal: (n) => { d.notes = n; },
    newId: nid,
    onStatus: (s) => d.statuses.push(s),
    isUnavailable: (e) => (e as { code?: string }).code === "42P01",
    trustLocalDeletes: extra.trustLocalDeletes,
    retryMs: 50,
  });
  return d;
}
const titles = (ns: SyncNote[]) => ns.map((n) => n.title).sort();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T12:00:00Z")); seq = 0; });
afterEach(() => { vi.useRealTimers(); });

// ------------------------------------------------------------------- tests

describe("note ids", () => {
  it("maps old non-uuid ids to a stable uuid, and leaves real uuids alone", () => {
    const legacy = "1728000000000-0.8123";
    expect(toSyncId(legacy)).toBe(toSyncId(legacy));
    expect(toSyncId(legacy)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(toSyncId(legacy)).not.toBe(toSyncId("1728000000001-0.8123"));
    const real = "3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b";
    expect(toSyncId(real)).toBe(real);
    const notes = [{ id: real }, { id: legacy }];
    expect(normalizeIds(notes).map((n) => n.id)).toEqual([real, toSyncId(legacy)]);
    const clean = [{ id: real }];
    expect(normalizeIds(clean)).toBe(clean);
  });

  it("round-trips a note through a database row without changing it", () => {
    const n = mk("a", "Title", "Body", 1728000123456, 1728000999123);
    expect(rowToNote({ ...noteToRow(n), version: 3 })).toEqual(n);
    const live = mk("b", "Live", "x", 1728000123456);
    expect(rowToNote({ ...noteToRow(live), version: 1 })).toEqual(live);
  });
});

describe("first sync uploads this device's notes without changing them", () => {
  it("keeps ids, text and edit times, and never duplicates on a second run", async () => {
    const server = new FakeServer();
    const phone = device(server, [mk("a", "PR Prompt", "Have the app...", 111), mk("b", "", "Film squat", 222)]);
    const before = JSON.stringify(phone.notes);
    await phone.engine.fullSync();
    expect(server.rows.size).toBe(2);
    expect(server.rows.get(toSyncId("a"))).toMatchObject({ title: "PR Prompt", body: "Have the app...", version: 1 });
    expect(Date.parse(server.rows.get(toSyncId("a"))!.edited_at)).toBe(111);
    expect(JSON.stringify(phone.notes)).toBe(before);
    const inserts = server.calls.filter((c) => c === "insert").length;
    await phone.engine.fullSync();
    await phone.engine.fullSync();
    expect(server.rows.size).toBe(2);
    expect(server.calls.filter((c) => c === "insert").length).toBe(inserts);
  });

  it("combines notes that were written separately on two devices", async () => {
    const server = new FakeServer();
    const phone = device(server, [mk("p1", "From phone")]);
    const desktop = device(server, [mk("d1", "From desktop")]);
    await phone.engine.fullSync();
    await desktop.engine.fullSync();
    await phone.engine.fullSync();
    expect(titles(phone.notes)).toEqual(["From desktop", "From phone"]);
    expect(titles(desktop.notes)).toEqual(["From desktop", "From phone"]);
  });

  it("does not upload blank notes", async () => {
    const server = new FakeServer();
    const phone = device(server, [mk("blank", "", "  ")]);
    await phone.engine.fullSync();
    expect(server.rows.size).toBe(0);
    expect(phone.notes).toHaveLength(1);
  });
});

describe("edits move between devices", () => {
  async function pair() {
    const server = new FakeServer();
    const desktop = device(server, [mk("n1", "Plan", "v1", 100)]);
    await desktop.engine.fullSync();
    const phone = device(server);
    await phone.engine.fullSync();
    return { server, desktop, phone };
  }

  it("a new note, an edit and a trash/restore on desktop all reach the phone", async () => {
    const { desktop, phone } = await pair();
    desktop.notes = [...desktop.notes, mk("n2", "Second", "hello", 200)];
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    expect(titles(phone.notes)).toEqual(["Plan", "Second"]);

    desktop.edit("n1", { body: "v2" });
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    expect(phone.byTitle("Plan")!.body).toBe("v2");

    desktop.edit("n1", { deletedAt: Date.now() });
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    expect(phone.byTitle("Plan")!.deletedAt).toBeTruthy();

    desktop.edit("n1", { deletedAt: undefined });
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    expect(phone.byTitle("Plan")!.deletedAt).toBeUndefined();
  });

  it("deleting for good on desktop removes it from the phone, and the reverse", async () => {
    const { server, desktop, phone } = await pair();
    desktop.notes = [];
    await desktop.engine.pushLocal();
    expect(server.rows.size).toBe(0);
    await phone.engine.fullSync();
    expect(phone.notes).toHaveLength(0);

    desktop.notes = [mk("n3", "Again", "x")];
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    phone.notes = [];
    await phone.engine.pushLocal();
    await desktop.engine.fullSync();
    expect(desktop.notes).toHaveLength(0);
  });

  it("an edit made after another device deleted the note is kept, not discarded", async () => {
    const { server, desktop, phone } = await pair();
    desktop.notes = [];
    await desktop.engine.pushLocal();
    phone.edit("n1", { body: "I kept typing on my phone" });
    await phone.engine.fullSync();
    expect(phone.byTitle("Plan")!.body).toBe("I kept typing on my phone");
    expect(server.rows.get(toSyncId("n1"))!.body).toBe("I kept typing on my phone");
  });
});

describe("two devices edit the same note: no text is ever lost", () => {
  it("a stale push is rejected, the newer edit wins and the other text is kept as a copy", async () => {
    const server = new FakeServer();
    const desktop = device(server, [mk("n1", "Plan", "original", 100)]);
    await desktop.engine.fullSync();
    const phone = device(server);
    await phone.engine.fullSync();

    desktop.edit("n1", { body: "desktop edit" });
    await desktop.engine.pushLocal();

    phone.edit("n1", { body: "phone edit" }); // phone hasn't heard about the desktop edit yet
    await phone.engine.pushLocal(); // update rejected as stale → full sync

    expect(server.rows.get(toSyncId("n1"))!.body).toBe("desktop edit");
    expect(phone.byTitle("Plan")!.body).toBe("desktop edit");
    const copy = phone.notes.find((n) => n.title === "Plan (conflict copy)");
    expect(copy?.body).toBe("phone edit");
    expect([...server.rows.values()].some((r) => r.body === "phone edit")).toBe(true);

    await desktop.engine.fullSync();
    expect(titles(desktop.notes)).toEqual(titles(phone.notes));
  });

  it("offline edits on a device that was away are kept as a copy when it reconnects", async () => {
    const server = new FakeServer();
    const desktop = device(server, [mk("n1", "Plan", "original", 100)]);
    await desktop.engine.fullSync();
    const phone = device(server);
    await phone.engine.fullSync();
    server.down = true;
    phone.edit("n1", { body: "offline phone edit" });
    await phone.engine.pushLocal();
    expect(phone.engine.status()).toBe("offline");
    expect(phone.byTitle("Plan")!.body).toBe("offline phone edit"); // still safe locally

    server.down = false;
    desktop.edit("n1", { body: "desktop edit" });
    await desktop.engine.pushLocal();
    await phone.engine.fullSync();
    expect(phone.byTitle("Plan")!.body).toBe("desktop edit");
    expect(phone.byTitle("Plan (conflict copy)")!.body).toBe("offline phone edit");
  });

  it("typing during a fetch is never overwritten by the (older) fetched copy", async () => {
    const server = new FakeServer();
    const phone = device(server, [mk("n1", "Plan", "v1", 100)]);
    await phone.engine.fullSync();
    const api = server.api();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: NotesApi = { ...api, fetch: async () => { const rows = await api.fetch(); await gate; return rows; } };
    const typing = device(server, phone.notes, { base: phone.base });
    typing.engine = createNotesSync({
      api: slow, loadBase: () => typing.base, saveBase: (b) => { typing.base = b; },
      getLocal: () => typing.notes, setLocal: (n) => { typing.notes = n; }, newId: nid,
    });
    const syncing = typing.engine.fullSync();
    typing.edit("n1", { body: "typed while fetching" });
    release();
    await syncing;
    expect(typing.byTitle("Plan")!.body).toBe("typed while fetching");
    expect(server.rows.get(toSyncId("n1"))!.body).toBe("typed while fetching");
  });
});

describe("failure handling", () => {
  it("offline: local notes stay put, status says so, and it catches up on its own", async () => {
    const server = new FakeServer();
    const phone = device(server, [mk("n1", "Plan", "v1", 100)]);
    server.down = true;
    await phone.engine.fullSync();
    expect(phone.engine.status()).toBe("offline");
    expect(phone.notes).toHaveLength(1);
    server.down = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(phone.engine.status()).toBe("idle");
    expect(server.rows.size).toBe(1);
    phone.engine.dispose();
  });

  it("table not created yet: stops quietly and leaves local notes alone", async () => {
    const server = new FakeServer();
    server.missingTable = true;
    const phone = device(server, [mk("n1", "Plan")]);
    await phone.engine.fullSync();
    expect(phone.engine.status()).toBe("unavailable");
    const calls = server.calls.length;
    await phone.engine.pushLocal();
    phone.engine.onRemoteEvent();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls.length).toBe(calls);
    expect(phone.notes).toHaveLength(1);
  });

  it("never deletes on the server when the local copy couldn't be read", async () => {
    const server = new FakeServer();
    const desktop = device(server, [mk("n1", "Keep me", "x"), mk("n2", "And me", "y")]);
    await desktop.engine.fullSync();
    // Same device, but its local cache failed to load (empty) while its base is intact.
    const broken = device(server, [], { base: desktop.base, trustLocalDeletes: false });
    await broken.engine.fullSync();
    await broken.engine.pushLocal();
    expect(server.rows.size).toBe(2);
    expect(titles(broken.notes)).toEqual(["And me", "Keep me"]);
  });
});

describe("realtime events", () => {
  it("ignores echoes of its own writes, and syncs on a change from another device", async () => {
    const server = new FakeServer();
    const desktop = device(server, [mk("n1", "Plan", "v1", 100)]);
    await desktop.engine.fullSync();
    const phone = device(server);
    await phone.engine.fullSync();
    const fetches = () => server.calls.filter((c) => c === "fetch").length;
    const before = fetches();

    phone.engine.onRemoteEvent({ eventType: "UPDATE", new: { id: toSyncId("n1"), version: 1 } });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetches()).toBe(before); // already at version 1

    desktop.edit("n1", { body: "v2" });
    await desktop.engine.pushLocal();
    phone.engine.onRemoteEvent({ eventType: "UPDATE", new: { id: toSyncId("n1"), version: 2 } });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetches()).toBe(before + 1);
    expect(phone.byTitle("Plan")!.body).toBe("v2");

    phone.engine.onRemoteEvent(); // e.g. a (re)subscribe: always refetch
    await vi.advanceTimersByTimeAsync(400);
    expect(fetches()).toBe(before + 2);
  });
});

describe("reconcile (pure)", () => {
  it("leaves in-sync notes alone and records them as the new base", () => {
    const n = mk("a", "T", "B", 5);
    const row: NoteRow = { ...noteToRow(n), version: 4 };
    const plan = reconcile([n], [row], {}, nid);
    expect(plan.next).toEqual([n]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.base[n.id]).toMatchObject({ version: 4 });
  });
});
