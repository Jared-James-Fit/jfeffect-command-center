import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENE_PICTURE, imageSize, scenePicturePrompt } from "@/lib/post-pictures";
import { gatewayImage } from "@/lib/post-pictures.server";
import { SPIRIT_SCENE_KEYS } from "@/components/community/spirit-scenes";

const read = (p: string) => readFileSync(p, "utf8");

describe("Saturday's scene as a real picture", () => {
  it("has a picture for every scene, asked for with no words in it", () => {
    for (const key of SPIRIT_SCENE_KEYS) expect(SCENE_PICTURE[key]?.length).toBeGreaterThan(40);
    const prompt = scenePicturePrompt("bamboo_roots", "growth you cant see yet\\nis still growth");
    expect(prompt).toContain("bamboo sprout");
    expect(prompt).toContain('The post says: "growth you cant see yet\\nis still growth"');
    expect(prompt).toContain("Absolutely no text, letters, numbers, logos or watermarks");
    expect(prompt).toContain("4:5");
  });

  it("reads a picture's type and size from its first bytes", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0, 0, 0, 6, 0]);
    expect(imageSize(png)).toEqual({ mime: "image/png", width: 1024, height: 1536 });

    // SOI, an APP0 segment, then SOF0 with height 1350 and width 1080
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x05, 0x46, 0x04, 0x38, 3, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ mime: "image/jpeg", width: 1080, height: 1350 });

    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x03, 0, 0xff, 0x03, 0]);
    expect(imageSize(webp)).toEqual({ mime: "image/webp", width: 1024, height: 1024 });

    expect(imageSize(new TextEncoder().encode("<html>nope</html>"))).toBeNull();
  });

  it("finds the picture in the image model's reply, wherever it puts it", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(gatewayImage({ choices: [{ message: { images: [{ type: "image_url", image_url: { url } }] } }] })).toBe("iVBORw0KGgo=");
    expect(gatewayImage({ choices: [{ message: { content: [{ type: "image_url", image_url: { url } }] } }] })).toBe("iVBORw0KGgo=");
    expect(gatewayImage({ choices: [{ message: { content: `here you go ${url}` } }] })).toBe("iVBORw0KGgo=");
    expect(gatewayImage({ choices: [{ message: { content: "I can't draw that" } }] })).toBeNull();
  });

  it("is made ahead, on a schedule, one at a time, and never over the coach's own photo", () => {
    const server = read("src/lib/post-pictures.server.ts");
    expect(server).toContain('if (post.media_path && !madeHere(post.media_path)) return { ok: false');
    expect(server).toContain("if (media.some((m) => !madeHere(m?.path))) return { ok: false");
    expect(server).toContain('return { skipped: "waiting after a failed try", last }');
    expect(server).toContain('settings.paused || !(settings.series_on ?? []).includes("saturday_spirit")');
    expect(read("src/routes/api/public/hooks/post-pictures-tick.ts")).toContain("authorizeHookRequest(request)");
    expect(read("supabase/migrations/20261230090000_post_pictures_tick.sql")).toContain("'post-pictures-tick'");
    // the coach can ask for another, on the post and a week ahead in Posts
    expect(read("src/components/community/post-actions.tsx")).toContain("data-new-picture");
    expect(read("src/components/community/coach-weekly-posts.tsx")).toContain("<SaturdayPicture item={next} on={on} />");
    expect(read("src/lib/post-pictures.functions.ts")).toContain('r.role === "admin" || r.role === "coach"');
  });
});
