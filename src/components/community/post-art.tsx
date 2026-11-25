import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { LESSON_PAPER_COLORS, LessonVisualArt } from "@/components/community/lesson-visuals";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { extraScene, type CommunityPost } from "@/lib/community";
import { extraLesson } from "@/lib/lessons";
import { canvasFile, paintInstagramCard, standaloneSvg, svgPicture } from "@/lib/instagram-cards";
import { instagramFileName, postArtCard, type IgCard, type IgFormat } from "@/lib/instagram-export";
import { decodePostArt, findPostArt, isPostArtDecoded, loadPostArt, peekPostArt, postArtAlt, postArtKey, whenStill, type PostArt } from "@/lib/post-art";
import { cardLogo, ensureDisplayFont } from "@/lib/workout-share-card";
import { ensureDeckFonts } from "@/lib/deck-cards";
import { deckOf } from "@/lib/post-decks";
import { cn } from "@/lib/utils";

/** The drawing a card paints in (a lesson's diagram, Saturday's scene), drawn off screen first; null when it has none. */
export function cardArtElement(post: CommunityPost, card: IgCard, slide = 0): ReactNode | null {
  if (card === "deck") {
    // only a deck's diagram slide carries the lesson's drawing
    if (deckOf(post)?.slides[slide]?.type !== "diagram") return null;
    const v = extraLesson(post)?.visual;
    return v && v.kind !== "truth" && v.kind !== "reset" ? <LessonVisualArt visual={v} tone="paper" /> : null;
  }
  if (card === "lesson") {
    const v = extraLesson(post)?.visual;
    return v && v.kind !== "truth" && v.kind !== "reset" ? <LessonVisualArt visual={v} tone="paper" /> : null;
  }
  if (card === "scene") {
    const scene = extraScene(post.series_extra);
    return scene && isSpiritScene(scene) ? <SpiritScene scene={scene} /> : null;
  }
  return null;
}

/**
 * Paint a post's card as a JPEG file. `host`: where its drawing was put (cardArtElement), if it has one.
 * `pause` (the feed's paint): waited on between drawing the card and encoding it, so the main thread is
 * held in two short stretches, each only while the screen is still, never one long one under a swipe.
 */
export async function paintCardFile(post: CommunityPost, card: IgCard, format: IgFormat, unit: "kg" | "lb", host: Element | null, index = 0, pause?: () => Promise<void>, slide = 0): Promise<File | null> {
  const svg = host?.querySelector("svg");
  // the card is light paper: the diagram goes on in its paper colours (dark ink), never the story's white
  const art = svg ? await svgPicture(standaloneSvg(svg, LESSON_PAPER_COLORS, 1080)) : null;
  const canvas = document.createElement("canvas");
  await paintInstagramCard(canvas, { card, format, post, unit, art, slide });
  if (pause) await pause();
  const file = await canvasFile(canvas, instagramFileName(post, index, "image/jpeg"));
  // let the phone have the memory back now, not whenever it collects
  canvas.width = 0;
  canvas.height = 0;
  return file;
}

/** True once the box is within three screens of being seen (and from then on), so a card is painted and decoded before it's scrolled to. */
function useNearScreen(ref: RefObject<HTMLElement | null>, eager: boolean): boolean {
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "300%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

/** How far a box is from the screen, in px (0 when any of it is on it); a box no longer on the page is last. */
function distanceFromScreen(el: Element | null): number {
  if (!el?.isConnected) return Number.POSITIVE_INFINITY;
  const r = el.getBoundingClientRect();
  const h = window.innerHeight;
  const w = window.innerWidth;
  const dy = r.bottom < 0 ? -r.bottom : r.top > h ? r.top - h : 0;
  const dx = r.right < 0 ? -r.right : r.left > w ? r.left - w : 0;
  return dy + dx;
}

/**
 * The picture for this post's card (postArtCard), and what it's doing:
 * kept → shown at once; else painted once it's near the screen (`eager`:
 * right away), only while the screen is still and the nearest first
 * (post-art.ts), so a swipe never lands on a post the phone hasn't finished
 * drawing. `host` is where its drawing goes while it's painted; `box` is
 * where the picture sits.
 */
export function usePostArt(post: CommunityPost, card: IgCard, unit: "kg" | "lb", near: boolean, box?: RefObject<HTMLElement | null>, slide = 0) {
  const key = useMemo(() => postArtKey(post, card, unit, slide), [post, card, unit, slide]);
  const name = instagramFileName(post, slide, "image/jpeg");
  const [art, setArt] = useState<PostArt | null>(() => peekPostArt(key));
  const [painting, setPainting] = useState(false);
  const [failed, setFailed] = useState(false);
  const drawing = useMemo(() => cardArtElement(post, card, slide), [post, card, slide]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const postRef = useRef(post);
  postRef.current = post;

  const [missing, setMissing] = useState(false);

  // a different picture (the caption was edited, another unit): start over
  useEffect(() => {
    setArt(peekPostArt(key));
    setPainting(false);
    setFailed(false);
    setMissing(false);
  }, [key]);

  // as soon as the post is on the page: the one kept on the phone (a read, nothing drawn), so it's ready long before it's seen
  useEffect(() => {
    if (art?.key === key) return;
    let alive = true;
    void findPostArt(key, name).then((found) => {
      if (!alive) return;
      if (found) setArt(found);
      else {
        setMissing(true);
        // what painting it needs, fetched now rather than when it's on screen
        void ensureDisplayFont();
        void cardLogo();
        if (card === "deck") void ensureDeckFonts();
      }
    });
    return () => {
      alive = false;
    };
  }, [key, name, art]);

  // not kept: painted once it's near the screen (only while the screen is still, nearest first)
  useEffect(() => {
    if (near && missing && art?.key !== key) setPainting(true);
  }, [near, missing, art, key]);

  useEffect(() => {
    if (!painting || (drawing && !host)) return;
    let alive = true;
    const rank = () => distanceFromScreen(box?.current ?? null);
    void loadPostArt(key, name, () => paintCardFile(postRef.current, card, "feed", unit, host, slide, whenStill, slide), { whenStill: true, rank }).then((made) => {
      if (!alive) return;
      if (made) setArt(made);
      else setFailed(true);
      setPainting(false);
    });
    return () => {
      alive = false;
    };
  }, [painting, drawing, host, key, name, card, unit, box, slide]);

  return {
    art: art?.key === key ? art : null,
    failed,
    /** Put this on the page while `art` is null: the drawing the card is painted from. */
    host: painting && drawing ? (
      <div ref={setHost} hidden aria-hidden>
        {drawing}
      </div>
    ) : null,
  };
}

/** The picture once it's decoded (decodePostArt), never before: it goes on the page whole, in one frame. Decoded only near the screen (memory). */
function useDecodedArt(art: PostArt | null, near: boolean): PostArt | null {
  const [done, setDone] = useState<string | null>(() => (art && isPostArtDecoded(art.key) ? art.key : null));
  useEffect(() => {
    if (!art || !near || done === art.key) return;
    if (isPostArtDecoded(art.key)) return setDone(art.key);
    let alive = true;
    void decodePostArt(art).then(() => {
      if (alive) setDone(art.key);
    });
    return () => {
      alive = false;
    };
  }, [art, near, done]);
  return art && (done === art.key || isPostArtDecoded(art.key)) ? art : null;
}

/** How long a post's words wait on screen for its card before showing anyway (a slow phone, a card that won't paint). */
export const ART_HOLD_MS = 1500;

/** True once the box has been on screen `ms` while `active` (from then on, until `active` ends). */
function useOnScreenFor(ref: RefObject<HTMLElement | null>, active: boolean, ms: number): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!active) return setOver(false);
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.some((e) => e.isIntersecting);
        if (seen && timer === null) timer = setTimeout(() => setOver(true), ms);
        else if (!seen && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref, active, ms]);
  return over;
}

/**
 * An automated post's picture, 4:5 like a photo in the feed: its painted
 * card, exactly what Save image and Share to Instagram send, put on the page
 * whole once it's decoded (painted once, then kept on the phone), never blank
 * paper whose words fill in. `fill`: fill the box it's in (a grid tile)
 * instead of keeping 4:5. `zoom`: a pinch lifts it like a photo
 * (useMediaPinchZoom); off for grid tiles. `page`: on a post's own screen in
 * the feed, black (nothing) until it's ready; with `hold` (the picture the
 * post opens on) the post's words and buttons wait for it too (styles.css,
 * `data-pending`, at most ART_HOLD_MS on screen), so the post appears all at once.
 */
export function PostArtImage({ post, card, unit, eager = false, fill = false, zoom = true, page = false, hold = false, slide = 0, className }: { post: CommunityPost; card: IgCard; unit: "kg" | "lb"; eager?: boolean; fill?: boolean; zoom?: boolean; page?: boolean; hold?: boolean; /** A deck's slide (0 = its cover). */ slide?: number; className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const near = useNearScreen(box, eager);
  const { art, failed, host } = usePostArt(post, card, unit, near, box, slide);
  const shown = useDecodedArt(art, near || eager);
  const alt = postArtAlt(post, card, slide);
  const pending = !shown && !failed;
  const gaveUp = useOnScreenFor(box, page && hold && pending, ART_HOLD_MS);
  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-hidden", shown || failed ? "bg-[#f3f1ec]" : page ? "bg-transparent" : "bg-muted", fill && "h-full", className)}
      style={fill ? undefined : { aspectRatio: "4 / 5" }}
      data-post-art={card}
      data-deck-slide={card === "deck" ? slide : undefined}
      data-ready={shown ? "" : undefined}
      data-pending={page && hold && pending && !gaveUp ? "" : undefined}
    >
      {shown ? (
        // data-pinch-zoom: pinch lifts just the picture, the same as a photo post's (SlideMedia)
        <div data-pinch-zoom={zoom ? "" : undefined} className="absolute inset-0">
          <ArtImg src={shown.url} alt={alt} />
        </div>
      ) : failed ? (
        // couldn't paint it on this phone: its words, on the same paper card
        <div className="absolute inset-0 flex items-center px-[9%] text-[#111113]">
          <p className="line-clamp-6 text-balance text-[22px] font-bold leading-tight">{alt}</p>
        </div>
      ) : (
        // nothing while it's coming (no blank paper that fills in): it lands whole
        <div className="absolute inset-0" aria-label="Loading picture" role="img" />
      )}
      {host}
    </div>
  );
}

/** The painted picture: already decoded (useDecodedArt), so it's on the page whole the frame it lands, no fade. */
function ArtImg({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} decoding="sync" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
}

/**
 * An automated post as a grid / Home tile: its painted card filling the
 * tile (the profile grid's 3:4 shows all but a sliver of the 4:5 card's
 * margin). Loaded on its own (post-tile.tsx stays small).
 */
export function AutoPostTile({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const card = postArtCard(post);
  return card ? <PostArtImage post={post} card={card} unit={unit} fill zoom={false} /> : <div className="h-full w-full bg-[#f3f1ec]" />;
}
