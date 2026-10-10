import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261029150000_community_gif_voice.sql");
const attach = read("src/components/community/post-attach.tsx");
const sheet = read("src/components/community/comments-sheet.tsx");

describe("GIFs and voice memos in comments and on posts", () => {
  it("a GIF is only ever one from the app's library, never any link", () => {
    expect(sql).toContain("SELECT g.thumb_url INTO v_thumb FROM public.chat_gifs g WHERE g.media_url = v_path LIMIT 1;");
    expect(sql).toContain("IF v_gif IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_gifs g WHERE g.media_url = v_gif) THEN");
  });
  it("a voice memo is your own upload, up to two minutes", () => {
    expect(sql).toContain("IF v_type = 'audio' AND (v_dur IS NULL OR v_dur <= 0 OR v_dur > 121) THEN RAISE EXCEPTION 'Voice memos are up to 2 minutes'; END IF;");
    expect(sql).toContain("IF split_part(v_audio, '/', 1) <> uid::text THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;");
    expect(read("src/lib/community-media.ts")).toContain("export const VOICE_MAX_SECONDS = 120;");
    expect(read("src/components/community/voice-memo.tsx")).toContain("if (rec.recording && rec.elapsed >= VOICE_MAX_SECONDS) void finish();");
  });
  it("only a post's author puts a GIF or voice memo on it", () => {
    expect(sql).toContain("WHERE p.id = _post_id AND p.author_user_id = public.community_main_account(uid) FOR UPDATE;");
    expect(read("src/components/community/post-actions.tsx")).toContain("attach={mine ? { initial: attachOfPost(post), key: post.id } : undefined}");
  });
  it("comments: photo, GIF or voice; the mic sits where Send goes until there's something to send", () => {
    expect(sheet).toContain("<MicButton onClick={() => void recorder.start()}");
    expect(sheet).toContain("<GifPicker");
    expect(sheet).toContain('if (m.type === "audio") return <VoiceMemoPlayer');
  });
  it("posts: GIF and voice in every composer (share studio, edit, coach notes), saved after the post", () => {
    expect(read("src/components/community/share-studio.tsx")).toContain("extras, attach: att.save });");
    expect(read("src/components/community/edit-post-sheet.tsx")).toContain("await att.save(post.id);");
    expect(read("src/components/community/note-editor.tsx")).toContain("if (attach && id) await att.save(id);");
    for (const f of ["lock-in.tsx", "share-workout-picker.tsx", "use-workout-studio.ts"]) expect(read(`src/components/community/${f}`)).toContain("attach: a.attach });");
    expect(read("src/lib/community.queries.ts")).toContain("await i.attach?.(postId);");
  });
  it("nothing uploads until the post saves; a replaced memo is tidied up; deleting a post takes its memo", () => {
    expect(attach).toContain("const path = voice?.blob ? await uploadVoiceMemo(voice.blob, user.id) : voice?.path ?? null;");
    expect(attach).toContain("if (initial?.audio_path && initial.audio_path !== path) await removeCommunityFiles([initial.audio_path]);");
    expect(read("src/lib/community.queries.ts")).toContain("await removeCommunityFiles([...postFiles(post), post.audio?.path]);");
  });
  it("the feed and the post show them", () => {
    expect(read("src/components/community/post-card.tsx")).toContain('<PostExtras post={post} className="mt-3" />');
    expect(read("src/components/community/post-detail.tsx")).toContain("<PostExtras post={post}");
    expect(sql).toContain("'gif_url', n.gif_url,");
  });
});
