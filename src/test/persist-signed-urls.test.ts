import { describe, expect, it } from "vitest";
import { shouldPersistQuery } from "@/lib/query-persister";

const q = (queryKey: unknown[], data: unknown, status = "success") => ({ queryKey, state: { status, data } });
const SIGNED = "https://x.supabase.co/storage/v1/object/sign/community-media/a/b.jpg?token=abc";

describe("signed links never go to disk", () => {
  it("keeps a query holding a signed link in memory only", () => {
    expect(shouldPersistQuery(q(["community-media-urls", "a/b.jpg"], { "a/b.jpg": SIGNED }))).toBe(false);
    expect(shouldPersistQuery(q(["community-feed", null], { pages: [{ posts: [{ author: { avatar_url: SIGNED } }] }] }))).toBe(false);
  });
  it("still saves ordinary data, and never an unfinished or blocked one", () => {
    expect(shouldPersistQuery(q(["community-feed", null], { pages: [{ posts: [{ media_path: "a/b.jpg" }] }] }))).toBe(true);
    expect(shouldPersistQuery(q(["community-feed", null], undefined, "pending"))).toBe(false);
    expect(shouldPersistQuery(q(["tasks", "admin"], []))).toBe(false);
  });
});
