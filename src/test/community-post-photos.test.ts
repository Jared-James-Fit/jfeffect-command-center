import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261027100000_community_post_photos.sql");

describe("photos on every post, same rules as sharing a workout", () => {
  it("one check everywhere: up to 10, at most 3 videos, only your own new uploads (files already on it may stay)", () => {
    expect(sql).toContain("IF jsonb_array_length(_media) > 10 THEN RAISE EXCEPTION 'Up to 10 photos or videos on a post'; END IF;");
    expect(sql).toContain("RAISE EXCEPTION 'Up to 3 videos on a post';");
    expect(sql).toContain("AND NOT v_keep @> jsonb_build_array(jsonb_build_object('path', e->>'path'))");
    // internal helpers aren't callable from the app
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_clean_media(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_apply_media(uuid, jsonb) FROM PUBLIC, anon, authenticated;");
  });

  it("swapping a post's photos: its author any time, staff only on a coach note; points never move", () => {
    expect(sql).toContain("IF NOT (public.community_is_post_author(_post_id) OR (v_kind = 'note' AND public.is_community_staff())) THEN");
    // only the media columns (and edited_at) change: the points trigger watches visibility / archive / kind / client
    const fn = sql.slice(sql.indexOf("FUNCTION public.community_set_post_media"), sql.indexOf("-- ── The coach's \"+ Post\""));
    expect(fn).not.toMatch(/SET[^;]*\b(visibility|archived_at|kind|client_id)\s*=/);
    expect(read("src/components/community/edit-post-sheet.tsx")).toContain("if (draft.changed) await draft.save((media) => setMedia.mutateAsync({ postId: post.id, media }));");
    expect(read("src/components/community/post-actions.tsx")).toContain("if (media) await setMedia.mutateAsync({ postId: post.id, media });");
  });

  it("old app versions keep working: every new parameter has a default", () => {
    expect(sql).toContain("community_create_note(_body text, _poll text[] DEFAULT NULL, _media jsonb DEFAULT NULL)");
    expect(sql).toContain("community_birthday_act(_id uuid, _action text, _body text DEFAULT NULL, _dm_body text DEFAULT NULL, _media jsonb DEFAULT NULL)");
    expect(sql).toContain("community_series_update_item(_id uuid, _body text, _active boolean DEFAULT true, _media jsonb DEFAULT NULL)");
    // and the app only sends _media when photos changed
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("...(a.media ? { _media: a.media } : {}),");
  });

  it("birthday posts: photos ride with the draft (new wording keeps them) and go out on the post", () => {
    expect(sql).toContain("v_media := CASE WHEN _media IS NULL THEN b.media ELSE public.community_clean_media(_media, uid, b.media) END;");
    expect(sql).toContain("IF jsonb_array_length(b.media) > 0 THEN PERFORM public.community_apply_media(v_post, b.media); END IF;");
    const sheet = read("src/components/community/birthday-posts.tsx");
    expect(sheet).toContain('<MediaStrip tray={draft.tray} className="mt-3" label="Add photos or videos" />');
    // a draft can be saved without approving it, so photos aren't lost on close
    expect(sheet).toContain('void run("save", "Saved for later")');
  });

  it("daily posts: photos go out with the next run, once", () => {
    expect(sql).toContain("IF jsonb_array_length(coalesce(v_item.media, '[]'::jsonb)) > 0 THEN PERFORM public.community_apply_media(v_id, v_item.media); END IF;");
    expect(sql).toContain("use_count = use_count + 1, media = '[]'::jsonb WHERE id = v_item.id;");
    expect(read("src/components/community/coach-weekly-posts.tsx")).toContain("Photos go out with this post once. The text stays for next time.");
  });

  it("coaches can preview draft photos before they're a post, through the function the storage rule already asks (the rule itself is unchanged)", () => {
    expect(sql).not.toContain("CREATE POLICY");
    expect(sql).toContain("OR (public.is_community_staff() AND (");
    expect(sql).toContain("WHERE b.status IN ('ready', 'scheduled')");
  });

  it("coach posts show their photos in the feed, the post, the grid and Home", () => {
    expect(read("src/components/community/post-card.tsx")).toContain("{post.media_type && <div className=\"mt-2\"><PostMedia post={post} thumbUrl={thumbUrl} /></div>}");
    expect(read("src/components/community/post-detail.tsx")).toContain("{post.media_type && <div className=\"mt-2\"><PostMedia post={post} thumbUrl={thumb} full /></div>}");
    expect(read("src/components/community/post-tile.tsx")).toContain('post.kind === "note" && post.media_type && thumb ?');
    expect(read("src/components/community/community-entry.tsx")).toContain("const photo = !!(post.media_type && thumb);");
  });

  it("the coach's + Post takes photos", () => {
    expect(read("src/components/community/admin-community-hub.tsx")).toContain('media={{ initial: null, key: "new-post" }}');
  });
});
