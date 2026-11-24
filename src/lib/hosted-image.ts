/**
 * Photos uploaded to Lovable's asset host (`*.asset.json` → `/__l5e/assets-v1/…`)
 * are kept at their original size (1080 px PNGs of ~1 MB, a 1.5 MB × 2 MB
 * JPEG…), but the host resizes on request: `?w=480` sends a 480 px copy, and it
 * picks AVIF or WebP from the browser's Accept header (`vary: Accept`), never
 * upscaling past the original. So a 400 px tile asks for a 400–800 px copy
 * instead of the whole file: transformation-1.png is 1.2 MB as uploaded and
 * ~19 KB as a 480 px AVIF (measured Nov 23 2026).
 *
 * Anything that isn't on the asset host (a bundled /assets/… file, another
 * site's URL) is returned as it is, with no srcset.
 */

const HOSTED_PATH = "/__l5e/assets-v1/";

/** The widths every hosted photo is asked for: few, so the CDN keeps each copy warm. */
export const HOSTED_WIDTHS = [320, 480, 640, 960, 1280] as const;

export function isHostedImage(url: string | null | undefined): url is string {
  return typeof url === "string" && url.includes(HOSTED_PATH);
}

/** The hosted photo at `width` px wide (the original when it's narrower), else the URL unchanged. */
export function hostedImageUrl(url: string, width: number): string {
  if (!isHostedImage(url)) return url;
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("w", String(Math.round(width)));
  return `${path}?${params.toString()}`;
}

/** `srcset` for a hosted photo over the given widths; undefined for anything else. */
export function hostedSrcSet(url: string, widths: readonly number[] = HOSTED_WIDTHS): string | undefined {
  if (!isHostedImage(url)) return undefined;
  return widths.map((w) => `${hostedImageUrl(url, w)} ${w}w`).join(", ");
}

/**
 * `src` / `srcSet` / `sizes` for an `<img>`: `sizes` is how wide the image is
 * drawn (CSS), `fallback` the width for a browser that ignores srcset. A photo
 * that isn't hosted gets just its `src`.
 */
export function hostedImageProps(
  url: string,
  { sizes, fallback = 640, widths = HOSTED_WIDTHS }: { sizes: string; fallback?: number; widths?: readonly number[] },
): { src: string; srcSet?: string; sizes?: string } {
  if (!isHostedImage(url)) return { src: url };
  return { src: hostedImageUrl(url, fallback), srcSet: hostedSrcSet(url, widths), sizes };
}
