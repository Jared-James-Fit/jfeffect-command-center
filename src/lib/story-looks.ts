/**
 * A story's filter attribution (Nov 23 2026): the colour filter ("Cool") and
 * the template ("Game Day") it was made with, kept as the story's metadata
 * (20270518090000_story_looks.sql), never drawn into the picture, and shown as
 * one quiet line under the poster's name in the story viewer, Instagram's way.
 * The poster can leave it off ("Show the filter's name", remembered on the
 * phone). A database without the table yet simply shows nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type StoryLook = { colourKey: string | null; colourLabel: string | null; templateKey: string | null; templateLabel: string | null };
type Row = { post_id: string; colour_key: string | null; colour_label: string | null; template_key: string | null; template_label: string | null };

/** What to say: the template and the colour filter, never the same name twice, never "Original" / "Normal". */
export function storyLookLine(l: Pick<StoryLook, "colourLabel" | "templateLabel"> | null | undefined): string | null {
  if (!l) return null;
  const parts = [l.templateLabel, l.colourLabel]
    .map((p) => p?.trim() ?? "")
    .filter((p) => p && !/^(original|normal)$/i.test(p));
  const seen = new Set<string>();
  const out = parts.filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), true)));
  return out.length ? out.join(" · ") : null;
}

/** Puts the attribution on a story just posted (never fails the story: it's already up). */
export async function saveStoryLook(postId: string, l: StoryLook): Promise<void> {
  if (!storyLookLine(l)) return;
  try {
    await db.rpc("community_story_look_set", {
      _post_id: postId,
      _colour_key: l.colourKey,
      _colour_label: l.colourLabel,
      _template_key: l.templateKey,
      _template_label: l.templateLabel,
    });
  } catch {
    /* the story is up; it just goes without the line */
  }
}

/** The attribution for the stories on screen (one read for the whole rail's worth), by story id. */
export function useStoryLooks(ids: string[], enabled = true): Map<string, StoryLook> {
  const key = [...new Set(ids)].sort();
  const { data } = useQuery({
    queryKey: ["community-story-looks", key.join(",")],
    enabled: enabled && key.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<Row[]> => {
      const { data: rows, error } = await db.rpc("community_story_looks_for", { _post_ids: key.slice(0, 200) });
      return error ? [] : ((rows ?? []) as Row[]);
    },
  });
  const map = new Map<string, StoryLook>();
  for (const r of data ?? [])
    map.set(r.post_id, { colourKey: r.colour_key, colourLabel: r.colour_label, templateKey: r.template_key, templateLabel: r.template_label });
  return map;
}

const SHOW_KEY = "jf-story-show-look";
/** Whether this phone shows the filter's name on new stories (on unless they turned it off). */
export function readShowLook(): boolean {
  try {
    return window.localStorage.getItem(SHOW_KEY) !== "off";
  } catch {
    return true;
  }
}
export function saveShowLook(on: boolean): void {
  try {
    window.localStorage.setItem(SHOW_KEY, on ? "on" : "off");
  } catch {
    /* this visit only */
  }
}
