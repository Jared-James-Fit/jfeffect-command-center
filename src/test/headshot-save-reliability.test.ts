import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { submitCapture } from "@/lib/headshots/headshots.server";

function fakeDb(status: string, method = "coach_assisted", commitError: string | null = null) {
  const display = "login/headshot-capture.jpg";
  const h = { id: "capture", client_id: "client", user_id: "actor", status, method, photo_path: "client/capture/photo.jpg", display_path: display, flags: [] };
  const c = { id: "client", user_id: "login", profile_picture_url: status === "accepted" ? display : null };
  const upload = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => {
    if (commitError) return { data: null, error: { message: commitError } };
    c.profile_picture_url = display;
    return { data: null, error: null };
  });
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "clients" ? c : h }) }) }),
    }),
    storage: { from: () => ({ upload, download: async () => ({ data: new Blob(["photo"]), error: null }) }) },
    rpc,
  };
  return { db: db as any, rpc, upload, c };
}
const args = { headshotId: "capture", actor: "actor", device: null, staffAccepts: true };

describe("account headshot persistence", () => {
  it("resumes a coach-assisted capture that reached pending but did not finish saving", async () => {
    const { db, rpc, upload, c } = fakeDb("pending");
    expect(await submitCapture(db, args)).toMatchObject({ ok: true, status: "accepted" });
    expect(upload).toHaveBeenCalledWith("login/headshot-capture.jpg", expect.any(Blob), expect.objectContaining({ upsert: true }));
    expect(rpc).toHaveBeenCalledWith("commit_account_headshot", expect.objectContaining({ _headshot: "capture", _actor: "actor" }));
    expect(c.profile_picture_url).toBe("login/headshot-capture.jpg");
  });
  it("does not report success when the final database save fails", async () => {
    const { db, c } = fakeDb("pending", "coach_assisted", "temporary database error");
    await expect(submitCapture(db, args)).rejects.toThrow("temporary database error");
    expect(c.profile_picture_url).toBeNull();
  });
  it("keeps client captures waiting for review, rather than bypassing approval", async () => {
    const { db, rpc, upload } = fakeDb("pending", "guided");
    expect(await submitCapture(db, { ...args, staffAccepts: false })).toMatchObject({ ok: true, status: "pending" });
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("recognizes an already saved capture after a lost response", async () => {
    const { db, rpc } = fakeDb("accepted");
    expect(await submitCapture(db, args)).toMatchObject({ ok: true, status: "accepted" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never resumes a capture belonging to another actor", async () => {
    const { db, rpc } = fakeDb("pending");
    expect(await submitCapture(db, { ...args, actor: "other" })).toMatchObject({ ok: false, reason: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps the camera mounted when the setup banner completes", () => {
    const source = readFileSync("src/components/portal/setup-checklist-banner.tsx", "utf8");
    expect(source).toContain("return <>{whenHidden}{camera.element}</>;");
  });
});
