import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createUploadQueue, ProgressStore } from "@/hooks/use-draft-uploads";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const groupThread = readFileSync("src/components/group-message-thread.tsx", "utf8");
const plusMenu = readFileSync("src/components/composer-plus-menu.tsx", "utf8");
const sendMenu = readFileSync("src/components/chat-send-menu.tsx", "utf8");
const messagesRoute = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
const messagesRouteFile = readFileSync("src/routes/_authenticated/admin/messages.tsx", "utf8");
const communication = readFileSync("src/routes/_authenticated/admin/communication.tsx", "utf8");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("background upload queue", () => {
  it("runs at most two uploads at once and starts the next as one finishes", async () => {
    const queue = createUploadQueue(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];
    const results = gates.map((g, i) =>
      queue.run(() => { started.push(i); return g.promise; }, new AbortController().signal),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[0].resolve("a");
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve("b");
    gates[2].resolve("c");
    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c"]);
  });

  it("never starts a queued upload that was cancelled, and frees its slot", async () => {
    const queue = createUploadQueue(1);
    const first = deferred<string>();
    const cancelled = new AbortController();
    let ranCancelled = false;
    const a = queue.run(() => first.promise, new AbortController().signal);
    const b = queue.run(async () => { ranCancelled = true; return "b"; }, cancelled.signal);
    const c = queue.run(async () => "c", new AbortController().signal);
    cancelled.abort();
    first.resolve("a");
    await expect(a).resolves.toBe("a");
    await expect(b).rejects.toThrow("Upload cancelled.");
    await expect(c).resolves.toBe("c");
    expect(ranCancelled).toBe(false);
  });

  it("frees the slot when an upload fails", async () => {
    const queue = createUploadQueue(1);
    const failed = queue.run(async () => { throw new Error("boom"); }, new AbortController().signal);
    const next = queue.run(async () => "ok", new AbortController().signal);
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});

describe("upload progress store", () => {
  it("is monotonic and only notifies on real changes", () => {
    const store = new ProgressStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.set("x", 10.2);
    store.set("x", 10.4); // rounds to the same value
    store.set("x", 5); // never goes backwards
    store.set("x", 150);
    expect(store.get("x")).toBe(100);
    expect(notified).toBe(2);
  });
});

describe("messenger composer", () => {
  it("does not block Send while media uploads", () => {
    for (const src of [thread, groupThread]) {
      expect(src).toContain("useDraftUploads");
      expect(src).toContain("uploads.take()");
      expect(src).toContain("uploads.drafts.length > 0 ?");
    }
    // The 1:1 thread awaits uploads inside the send, behind an optimistic bubble.
    expect(thread).toContain("await Promise.all(drafts.map((d) => d.done))");
    expect(thread).toContain("local_upload_ids");
  });

  it("drops composer media when switching conversations", () => {
    expect(thread).toMatch(/setAttachments\(\[\]\);\s*resetUploads\(\);\s*\}, \[clientId, role, resetUploads\]\)/);
  });

  it("removes Action Request from the messenger", () => {
    expect(plusMenu).not.toContain("Action Request");
    expect(plusMenu).not.toContain('key: "action"');
    expect(sendMenu).not.toContain("ClientActionRequestComposer");
    expect(sendMenu).not.toMatch(/Action request/i);
  });

  it("labels each tile by what it does", () => {
    for (const label of ["Photos & Videos", "Document", "Request Check-In", "Request Signature", "Share Recipe", "Meet Link"]) {
      expect(plusMenu).toContain(`"${label}"`);
    }
    expect(plusMenu).not.toContain('label: "File"');
  });
});

describe("messages first open", () => {
  it("redirects /admin/messages before render instead of from an effect", () => {
    expect(messagesRouteFile).toContain("beforeLoad");
    expect(messagesRouteFile).toContain("throw redirect(");
    expect(messagesRouteFile).not.toContain("function MessagesRedirect");
  });

  it("only bundles the Messages tab with the communication page", () => {
    const pages = "@/route-pages/_authenticated/admin";
    expect(communication).toContain(`import { MessagesInbox } from "${pages}/messages";`);
    for (const mod of [`${pages}/broadcasts`, "@/components/support/support-messenger"]) {
      expect(communication).not.toContain(`from "${mod}"`);
      expect(communication).toContain(`import("${mod}")`);
    }
    // Popups and chat media moved to Settings: never bundled here.
    for (const mod of ["membership.support", "support-alerts", "chat-gifs", "chat-sounds", "popups"].map((m) => `${pages}/${m}`)) {
      expect(communication).not.toContain(`"${mod}"`);
    }
  });

  it("shows a loading skeleton instead of an empty-thread flash and prefetches on press", () => {
    expect(thread).toContain("messagesPending");
    expect(messagesRoute).toContain("onPointerDown={() => prefetchThread(client.id)}");
  });
});

describe("messenger stays current after the app resumes", () => {
  it("resyncs only when a channel rejoins, not on the first join", async () => {
    const { onRealtimeRejoin } = await import("@/hooks/use-resync-on-resume");
    let resyncs = 0;
    const status = onRealtimeRejoin(() => resyncs++);
    status("SUBSCRIBED"); // initial join: data was just fetched
    status("CHANNEL_ERROR");
    status("TIMED_OUT");
    expect(resyncs).toBe(0);
    status("SUBSCRIBED"); // rejoined after a drop: events may be missing
    expect(resyncs).toBe(1);
  });

  it("wires resume + rejoin resync into the inbox, threads and group list", () => {
    const groupPane = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    for (const src of [messagesRoute, thread, groupThread, groupPane]) {
      expect(src).toContain("useResyncOnResume(");
      expect(src).toContain(".subscribe(onRealtimeRejoin(");
    }
  });

  it("re-checks lists on open instead of trusting a cache realtime wasn't updating", () => {
    const groupPane = readFileSync("src/components/group-chats-pane.tsx", "utf8");
    expect(messagesRoute.match(/refetchOnMount: "always"/g)?.length).toBe(3);
    expect(groupPane).toContain('refetchOnMount: "always"');
    expect(groupThread).toContain('refetchOnMount: "always"');
  });
});

describe("clearing deleted-message placeholders", () => {
  it("offers Remove on placeholders to admins only, via the audited admin delete", () => {
    expect(thread).toContain('role === "admin" && !m.id.startsWith("optimistic-")');
    expect(thread).toContain("void performAdminDelete([m.id])");
  });
});

describe("media replies and video playback", () => {
  const viewer = readFileSync("src/components/media-viewer.tsx", "utf8");
  const tile = readFileSync("src/components/chat-video-tile.tsx", "utf8");
  const shared = readFileSync("src/components/chat-shared.tsx", "utf8");

  it("opens videos full screen and autoplays instead of an inline player", () => {
    expect(tile).toContain('viewer.open(url, { kind: "video"');
    expect(viewer).toContain("autoPlay");
    expect(viewer).toContain("function VideoViewer");
    for (const src of [thread, shared]) {
      expect(src).toContain("<ChatVideoTile");
      expect(src).not.toMatch(/<video[^>]*controls/);
    }
  });

  it("shows a thumbnail for replies to photos and videos, including old replies", async () => {
    const { replyMediaFor } = await import("@/lib/messages");
    const video = { attachments: [{ type: "video", url: "", storage_path: "c1/a.mov" }] } as any;
    // Original loaded: use it (replies sent before previews carried a path).
    expect(replyMediaFor({ sender_role: "client", body: "", attachment_type: "video" }, video))
      .toEqual({ type: "video", path: "c1/a.mov", url: undefined });
    // Original not loaded: fall back to the path stored on the preview.
    expect(replyMediaFor({ sender_role: "client", body: "", attachment_type: "image", attachment_path: "c1/b.jpg" }, null))
      .toEqual({ type: "image", path: "c1/b.jpg", url: undefined });
    // Nothing to show for text, files or unknown media.
    expect(replyMediaFor({ sender_role: "client", body: "hi" }, null)).toBeNull();
    expect(replyMediaFor({ sender_role: "client", body: "", attachment_type: "pdf" }, { attachments: [{ type: "pdf", url: "x" }] } as any)).toBeNull();
    expect(thread).toContain("<ReplyThumb");
  });
});
