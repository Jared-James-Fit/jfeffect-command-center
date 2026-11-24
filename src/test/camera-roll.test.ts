import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  READ_CHUNK,
  ROLL_VIDEO_MAX_BYTES,
  base64ToBytes,
  chunkRanges,
  estimateVideoBytes,
  hasNativePhotos,
  loadRollFile,
  rollTap,
  tileClock,
  type RollAsset,
} from "@/lib/native-photos";
import { opensLibraryOnTap } from "@/components/community/composer-pick";

const read = (p: string) => readFileSync(p, "utf8");
const g = globalThis as any;

/** The app's bridge as the iPhone build puts it on the page: Capacitor with JfPhotos on its plugin list. */
function withPlugin(plugin: Record<string, unknown> | null, native = true) {
  g.window = {
    Capacitor: {
      isNativePlatform: () => native,
      isPluginAvailable: (n: string) => !!plugin && n === "JfPhotos",
      Plugins: plugin ? { JfPhotos: plugin } : {},
    },
    matchMedia: () => ({ matches: true }),
  };
}

afterEach(() => {
  delete g.window;
});

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** A plugin answering from an in-memory file, read in the chunks asked for. */
function fakePlugin(file: Uint8Array, opened: Record<string, unknown>) {
  const calls: string[] = [];
  const plugin = {
    calls,
    addListener: vi.fn(async (_e: string, _cb: unknown) => ({ remove: vi.fn() })),
    open: vi.fn(async (o: unknown) => {
      calls.push(`open ${JSON.stringify(o)}`);
      return opened;
    }),
    read: vi.fn(async ({ offset, length }: { offset: number; length: number }) => {
      calls.push(`read ${offset}+${length}`);
      const part = file.subarray(offset, offset + length);
      return { data: b64(part), eof: offset + part.length >= file.length };
    }),
    close: vi.fn(async ({ token }: { token: string }) => {
      calls.push(`close ${token}`);
    }),
  };
  return plugin;
}

const photo: RollAsset = {
  id: "A1/L0/001",
  kind: "image",
  width: 4032,
  height: 3024,
  duration: 0,
  created: 1_763_900_000_000,
};
const clip: RollAsset = {
  id: "B2/L0/001",
  kind: "video",
  width: 1080,
  height: 1920,
  duration: 31,
  created: 1_763_900_000_000,
};

describe("which tap does what in the camera roll (Instagram's New post)", () => {
  it("one at a time: a tap shows that photo instead, a tap on the one picked keeps it", () => {
    expect(rollTap({ multi: false, picked: [], showing: null, key: "a", max: 10 })).toEqual({
      kind: "add",
      replace: [],
    });
    expect(rollTap({ multi: false, picked: ["a"], showing: "a", key: "b", max: 10 })).toEqual({
      kind: "add",
      replace: ["a"],
    });
    expect(rollTap({ multi: false, picked: ["a"], showing: "a", key: "a", max: 10 })).toEqual({
      kind: "focus",
    });
  });
  it("with Select on: a tap adds, a tap on one picked shows it, a tap on the one showing takes it off", () => {
    expect(rollTap({ multi: true, picked: ["a"], showing: "a", key: "b", max: 10 })).toEqual({
      kind: "add",
      replace: [],
    });
    expect(rollTap({ multi: true, picked: ["a", "b"], showing: "b", key: "a", max: 10 })).toEqual({
      kind: "focus",
    });
    expect(rollTap({ multi: true, picked: ["a", "b"], showing: "b", key: "b", max: 10 })).toEqual({
      kind: "remove",
    });
  });
  it("a full post never takes another (and one at a time never fills up)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `k${i}`);
    expect(rollTap({ multi: true, picked: ten, showing: "k0", key: "new", max: 10 })).toEqual({
      kind: "full",
    });
    expect(rollTap({ multi: false, picked: ["k0"], showing: "k0", key: "new", max: 1 }).kind).toBe(
      "add",
    );
  });
});

describe("reading a pick back through the bridge", () => {
  it("chunks cover the file exactly, in order", () => {
    expect(chunkRanges(0)).toEqual([]);
    expect(chunkRanges(10, 4)).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
      { offset: 8, length: 2 },
    ]);
    const big = chunkRanges(READ_CHUNK * 2 + 7);
    expect(big.map((r) => r.length)).toEqual([READ_CHUNK, READ_CHUNK, 7]);
  });

  it("base64 decodes to the same bytes, with or without the browser's own decoder", () => {
    const bytes = new Uint8Array(4097).map((_, i) => (i * 37) % 256);
    expect(Array.from(base64ToBytes(b64(bytes)))).toEqual(Array.from(bytes));
    const native = (Uint8Array as any).fromBase64;
    (Uint8Array as any).fromBase64 = undefined;
    try {
      expect(Array.from(base64ToBytes(b64(bytes)))).toEqual(Array.from(bytes));
    } finally {
      (Uint8Array as any).fromBase64 = native;
    }
  });

  it("a photo comes back as the JPEG the plugin made, named as in Photos, its file closed after", async () => {
    const jpeg = new Uint8Array(READ_CHUNK + 1234).map((_, i) => i % 251);
    const plugin = fakePlugin(jpeg, {
      token: "t1",
      name: "IMG_4521.jpg",
      mime: "image/jpeg",
      size: jpeg.length,
      width: 3072,
      height: 2304,
      duration: 0,
    });
    withPlugin(plugin);
    const seen: number[] = [];
    const res = await loadRollFile(photo, { onProgress: (p) => seen.push(p) });
    expect("file" in res).toBe(true);
    const file = (res as { file: File }).file;
    expect(file.name).toBe("IMG_4521.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(jpeg.length);
    expect(
      Array.from(new Uint8Array(await file.arrayBuffer()).subarray(READ_CHUNK - 2, READ_CHUNK + 2)),
    ).toEqual(Array.from(jpeg.subarray(READ_CHUNK - 2, READ_CHUNK + 2)));
    expect(plugin.calls).toEqual([
      `open {"id":"A1/L0/001","maxSide":3072,"maxBytes":0}`,
      `read 0+${READ_CHUNK}`,
      `read ${READ_CHUNK}+1234`,
      "close t1",
    ]);
    expect(seen.at(-1)).toBe(1);
  });

  it("a video names its own file (IMG_1234.MOV): the video tools read it as a library pick, never as filmed in the app", async () => {
    const mov = new Uint8Array(2048);
    const plugin = fakePlugin(mov, {
      token: "t2",
      name: "IMG_1234.MOV",
      mime: "video/quicktime",
      size: mov.length,
      width: 1080,
      height: 1920,
      duration: 31,
    });
    withPlugin(plugin);
    const res = (await loadRollFile(clip)) as { file: File };
    expect(res.file.name).toBe("IMG_1234.MOV");
    expect(res.file.type).toBe("video/quicktime");
    expect(plugin.open).toHaveBeenCalledWith({
      id: clip.id,
      maxSide: 3072,
      maxBytes: ROLL_VIDEO_MAX_BYTES,
    });
  });

  it("a video past the limit is offered to Apple's picker instead, never read into memory", async () => {
    const plugin = fakePlugin(new Uint8Array(0), { tooBig: true, size: ROLL_VIDEO_MAX_BYTES + 1 });
    withPlugin(plugin);
    expect(await loadRollFile(clip)).toEqual({ tooBig: true });
    expect(plugin.read).not.toHaveBeenCalled();
    // a 4K video of ten minutes isn't even copied out of Photos
    const long: RollAsset = { ...clip, width: 2160, height: 3840, duration: 600 };
    expect(estimateVideoBytes(long)).toBeGreaterThan(ROLL_VIDEO_MAX_BYTES * 1.5);
    plugin.open.mockClear();
    expect(await loadRollFile(long)).toEqual({ tooBig: true });
    expect(plugin.open).not.toHaveBeenCalled();
  });

  it("a newer tap stops a load between chunks, and its file is still closed", async () => {
    const data = new Uint8Array(READ_CHUNK * 3);
    const plugin = fakePlugin(data, {
      token: "t3",
      name: "IMG_1.jpg",
      mime: "image/jpeg",
      size: data.length,
      width: 10,
      height: 10,
      duration: 0,
    });
    withPlugin(plugin);
    let reads = 0;
    plugin.read.mockImplementation(
      async ({ offset, length }: { offset: number; length: number }) => {
        reads++;
        return { data: b64(data.subarray(offset, offset + length)), eof: false };
      },
    );
    await expect(loadRollFile(photo, { cancelled: () => reads >= 1 })).rejects.toThrow("cancelled");
    expect(reads).toBe(1);
    expect(plugin.close).toHaveBeenCalledWith({ token: "t3" });
  });
});

describe("the camera roll only where the app links it", () => {
  it("the web, the home-screen app and older app builds keep Apple's picker on +", () => {
    expect(hasNativePhotos()).toBe(false);
    withPlugin(null);
    expect(hasNativePhotos()).toBe(false);
    expect(opensLibraryOnTap()).toBe(true);
    withPlugin({ status: vi.fn() }, false);
    expect(hasNativePhotos()).toBe(false);
  });
  it("the iPhone app with the plugin: + opens New post on the grid, never Apple's menu", () => {
    withPlugin({ status: vi.fn() });
    expect(hasNativePhotos()).toBe(true);
    expect(opensLibraryOnTap()).toBe(false);
  });
  it("video tiles say their length", () => {
    expect(tileClock(0)).toBe("0:00");
    expect(tileClock(31.4)).toBe("0:31");
    expect(tileClock(725)).toBe("12:05");
  });
});

describe("the iPhone build links the plugin", () => {
  const swift = read("native/jf-photos/ios/Sources/JfPhotosPlugin/JfPhotosPlugin.swift");
  const workflow = read(".github/workflows/ios-build.yml");
  const lib = read("src/lib/native-photos.ts");

  it("Capacitor's CLI finds the class (the first @objc(…) in the file) and the page finds it as JfPhotos", () => {
    expect(/@objc\(([A-Za-z0-9_-]+)\)/.exec(swift)?.[1]).toBe("JfPhotosPlugin");
    expect(swift).toContain('public let jsName = "JfPhotos"');
    expect(lib).toContain('isPluginAvailable?.("JfPhotos")');
    const pkg = JSON.parse(read("native/jf-photos/package.json"));
    expect(pkg.capacitor.ios.src).toBe("ios");
    expect(read("native/jf-photos/JfPhotos.podspec")).toContain("s.name = 'JfPhotos'");
  });

  it("every method the page calls is one the plugin answers", () => {
    const listed = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]);
    for (const m of [
      "status",
      "requestAccess",
      "manageLimited",
      "openSettings",
      "albums",
      "list",
      "open",
      "read",
      "close",
    ]) {
      expect(listed).toContain(m);
      expect(swift).toContain(`@objc func ${m}(_ call: CAPPluginCall)`);
    }
  });

  it("the workflow lists it, links its pod, checks it's in the app, and uploads a branch build only when asked", () => {
    expect(workflow).toContain('| {"JfPhotosPlugin"}');
    expect(workflow).toContain("pod 'JfPhotos', :path => '../../native/jf-photos'");
    expect(workflow).toContain('"JfPhotosPlugin"');
    expect(workflow).toContain("JfPhotos.framework");
    expect(workflow).toContain("PHPhotoLibraryPreventAutomaticLimitedAccessAlert");
    expect(workflow).toMatch(
      /Export and Upload to TestFlight\n\s+if: \$\{\{ github\.event_name == 'push' \|\| inputs\.upload \}\}/,
    );
    // the app's plugin list is written by the build itself (cap add's sync never runs: no dist folder),
    // after the platform is generated and before the archive
    expect(workflow.indexOf('| {"JfPhotosPlugin"}')).toBeGreaterThan(workflow.indexOf("npx cap add ios"));
    expect(workflow.indexOf('| {"JfPhotosPlugin"}')).toBeLessThan(workflow.indexOf("Build and Archive iOS app"));
  });

  it("the web app's own dependencies never change", () => {
    expect(JSON.parse(read("package.json")).dependencies["jf-photos"]).toBeUndefined();
  });

  it("New post shows the grid in the app and keeps its picks as slides", () => {
    const composer = read("src/components/community/post-composer.tsx");
    expect(composer).toContain("useState(() => hasNativePhotos())");
    expect(composer).toMatch(/roll \? \(\s*<CameraRoll/);
    expect(read("src/components/community/slide-tray.tsx")).toContain(
      "opts?.onAdded?.(fresh.map((f) => f.id))",
    );
  });
});
