/**
 * The coach's two style references for the daily pictures (sent in chat on
 * Nov 5): A, a vibrant graphic 2D gym (crisp ink outlines, flat cel shading,
 * coral and gold against teal, hard shafts of sunlight, a dense lived-in
 * room); B, a cinematic 2D anime frame (thin clean lines, two-tone cel
 * shading, a golden-hour sky, warm rim light, orange against teal).
 *
 * Server only and inlined into the server bundle (`?inline`), never served
 * as a public file. On the first run they're placed in the Crew bucket under
 * the posting account and set as each art direction's reference
 * (daily-visuals.server.ts seedStyleRefs), once (STYLE_REFS_SEED): a
 * reference the coach uploads or removes in the card stays his choice.
 */
import graphic from "@/assets/daily-style/graphic.jpg?inline";
import anime from "@/assets/daily-style/anime.jpg?inline";

export const DEFAULT_STYLE_REFS = { graphic, anime } as const;
export const STYLE_REFS_SEED = "refs_v1";
