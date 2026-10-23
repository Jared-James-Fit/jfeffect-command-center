import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { LESSON_DARK_COLORS, LessonVisualArt } from "@/components/community/lesson-visuals";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { extraScene, type CommunityPost } from "@/lib/community";
import { extraLesson } from "@/lib/lessons";
import { canvasFile, paintInstagramCard, standaloneSvg, svgPicture } from "@/lib/instagram-cards";
import { instagramFileName, postArtCard, type IgCard, type IgFormat } from "@/lib/instagram-export";
import { findPostArt, loadPostArt, peekPostArt, postArtAlt, postArtKey, type PostArt } from "@/lib/post-art";
import { cn } from "@/lib/utils";

/** The drawing a card paints in (a lesson's diagram, Saturday's scene), drawn off screen first; null when it has none. */
export function cardArtElement(post: CommunityPost, card: IgCard): ReactNode | null {
  if (card === "lesson") {
    const v = extraLesson(post)?.visual;
    return v && v.kind !== "truth" && v.kind !== "reset" ? <LessonVisualArt visual={v} tone="dark" /> : null;
  }
  if (card === "scene") {
    const scene = extraScene(post.series_extra);
    return scene && isSpiritScene(scene) ? <SpiritScene scene={scene} /> : null;
  }
  return null;
}

/** Paint a post's card as a JPEG file. `host`: where its drawing was put (cardArtElement), if it has one. */
export async function paintCardFile(post: CommunityPost, card: IgCard, format: IgFormat, unit: "kg" | "lb", host: Element | null, index = 0): Promise<File | null> {
  const svg = host?.querySelector("svg");
  const art = svg ? await svgPicture(standaloneSvg(svg, LESSON_DARK_COLORS, 1080)) : null;
  const canvas = document.createElement("canvas");
  await paintInstagramCard(canvas, { card, format, post, unit, art });
  const file = await canvasFile(canvas, instagramFileName(post, index, "image/jpeg"));
  // let the phone have the memory back now, not whenever it collects
  canvas.width = 0;
  canvas.height = 0;
  return file;
}

/** True once the box is within a screen or so of being seen (and from then on). */
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
      { rootMargin: "120%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

/**
 * The picture for this post's card (postArtCard), and what it's doing:
 * kept → shown at once; else painted once it's near the screen (`eager`:
 * right away). `host` is where its drawing goes while it's painted.
 */
export function usePostArt(post: CommunityPost, card: IgCard, unit: "kg" | "lb", near: boolean) {
  const key = useMemo(() => postArtKey(post, card, unit), [post, card, unit]);
  const name = instagramFileName(post, 0, "image/jpeg");
  const [art, setArt] = useState<PostArt | null>(() => peekPostArt(key));
  const [painting, setPainting] = useState(false);
  const [failed, setFailed] = useState(false);
  const drawing = useMemo(() => cardArtElement(post, card), [post, card]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const postRef = useRef(post);
  postRef.current = post;

  // a different picture (the caption was edited, another unit): start over
  useEffect(() => {
    setArt(peekPostArt(key));
    setPainting(false);
    setFailed(false);
  }, [key]);

  // near the screen: the one kept on the phone, else paint it
  useEffect(() => {
    if (!near || art?.key === key) return;
    let alive = true;
    void findPostArt(key, name).then((found) => {
      if (!alive) return;
      if (found) setArt(found);
      else setPainting(true);
    });
    return () => {
      alive = false;
    };
  }, [near, key, name, art]);

  useEffect(() => {
    if (!painting || (drawing && !host)) return;
    let alive = true;
    void loadPostArt(key, name, () => paintCardFile(postRef.current, card, "feed", unit, host)).then((made) => {
      if (!alive) return;
      if (made) setArt(made);
      else setFailed(true);
      setPainting(false);
    });
    return () => {
      alive = false;
    };
  }, [painting, drawing, host, key, name, card, unit]);

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

/**
 * An automated post's picture, 4:5 like a photo in the feed: its painted
 * card, exactly what Save image and Share to Instagram send. Dark, with the
 * cards' glow, until it's ready (painted once, then kept on the phone).
 * `fill`: fill the box it's in (a grid tile) instead of keeping 4:5.
 * `zoom`: a pinch lifts it like a photo (useMediaPinchZoom); off for grid tiles.
 */
export function PostArtImage({ post, card, unit, eager = false, fill = false, zoom = true, className }: { post: CommunityPost; card: IgCard; unit: "kg" | "lb"; eager?: boolean; fill?: boolean; zoom?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const near = useNearScreen(box, eager);
  const { art, failed, host } = usePostArt(post, card, unit, near);
  const alt = postArtAlt(post, card);
  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-hidden bg-[#09090b]", fill && "h-full", className)}
      style={fill ? undefined : { aspectRatio: "4 / 5" }}
      data-post-art={card}
      data-ready={art ? "" : undefined}
    >
      {art ? (
        // data-pinch-zoom: pinch lifts just the picture, the same as a photo post's (SlideMedia)
        <div data-pinch-zoom={zoom ? "" : undefined} className="absolute inset-0">
          <ArtImg src={art.url} alt={alt} />
        </div>
      ) : failed ? (
        // couldn't paint it on this phone: its words, on the same dark card
        <div className="absolute inset-0 flex items-center px-[9%] text-white">
          <p className="line-clamp-6 text-balance text-[22px] font-black leading-tight">{alt}</p>
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(85%_70%_at_100%_0%,rgba(239,51,64,0.32),transparent_60%)]" aria-label="Loading picture" role="img" />
      )}
      {host}
    </div>
  );
}

/** The painted picture: fades in once it's decoded (a kept one shows at once). */
function ArtImg({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
      }}
      data-loaded={loaded ? "" : undefined}
      className="media-fade absolute inset-0 h-full w-full object-cover"
    />
  );
}

/**
 * An automated post as a grid / Home tile: its painted card filling the
 * tile (the profile grid's 3:4 shows all but a sliver of the 4:5 card's
 * margin). Loaded on its own (post-tile.tsx stays small).
 */
export function AutoPostTile({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const card = postArtCard(post);
  return card ? <PostArtImage post={post} card={card} unit={unit} fill zoom={false} /> : <div className="h-full w-full bg-[#09090b]" />;
}
