/**
 * Canvas-based share card renderer. No image dependencies — everything is
 * drawn with native Canvas 2D so it works in the Worker preview and in the
 * browser. Portrait (1080×1920) is the primary format; square (1080×1080)
 * is offered as a secondary option.
 */

export type ShareFormat = "portrait" | "square";
export type ShareTheme = "dark" | "light";

export interface ShareCardData {
  eyebrow: string; // e.g. "WEEKLY TRAINING SUMMARY"
  headline: string; // big number or phrase
  subline: string; // one-line context
  stats?: { emoji: string; label: string; value: string }[];
  athleteName?: string;
}

export function renderShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  format: ShareFormat = "portrait",
  theme: ShareTheme = "dark",
) {
  const W = 1080;
  const H = format === "portrait" ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  if (theme === "dark") {
    bg.addColorStop(0, "#0b0d10");
    bg.addColorStop(1, "#1a1d24");
  } else {
    bg.addColorStop(0, "#f7f7f5");
    bg.addColorStop(1, "#ffffff");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const accent = "#f5b301"; // JF Effect gold
  const fg = theme === "dark" ? "#ffffff" : "#0b0d10";
  const muted = theme === "dark" ? "rgba(255,255,255,0.55)" : "rgba(11,13,16,0.55)";

  // Soft radial accent
  const radial = ctx.createRadialGradient(W * 0.85, H * 0.15, 20, W * 0.85, H * 0.15, W * 0.7);
  radial.addColorStop(0, "rgba(245,179,1,0.35)");
  radial.addColorStop(1, "rgba(245,179,1,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  const pad = 72;

  // Brand
  ctx.fillStyle = accent;
  ctx.font = "700 44px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("JF EFFECT", pad, pad + 44);

  // Eyebrow
  ctx.fillStyle = muted;
  ctx.font = "600 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(data.eyebrow.toUpperCase(), pad, pad + 92);

  // Headline (big)
  ctx.fillStyle = fg;
  const headlineY = format === "portrait" ? H * 0.42 : H * 0.5;
  fitText(ctx, data.headline, W - pad * 2, 220, "900");
  ctx.textAlign = "center";
  ctx.fillText(data.headline, W / 2, headlineY);

  // Subline
  ctx.fillStyle = muted;
  ctx.font = "500 30px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  wrapText(ctx, data.subline, W / 2, headlineY + 60, W - pad * 2, 40);

  // Stat row
  if (data.stats && data.stats.length) {
    const rowY = format === "portrait" ? H - 380 : H - 260;
    const colW = (W - pad * 2) / data.stats.length;
    data.stats.forEach((s, i) => {
      const cx = pad + colW * i + colW / 2;
      ctx.textAlign = "center";
      ctx.fillStyle = fg;
      ctx.font = "700 72px system-ui, -apple-system, sans-serif";
      ctx.fillText(s.emoji, cx, rowY);
      ctx.fillStyle = accent;
      ctx.font = "900 42px system-ui, -apple-system, sans-serif";
      ctx.fillText(s.value, cx, rowY + 68);
      ctx.fillStyle = muted;
      ctx.font = "600 22px system-ui, -apple-system, sans-serif";
      ctx.fillText(s.label, cx, rowY + 108);
    });
  }

  // Footer
  ctx.textAlign = "left";
  ctx.fillStyle = muted;
  ctx.font = "600 22px system-ui, -apple-system, sans-serif";
  ctx.fillText(data.athleteName ? `— ${data.athleteName}` : "jfeffect.com", pad, H - pad);

  // Divider ticks
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 116);
  ctx.lineTo(pad + 80, pad + 116);
  ctx.stroke();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, initialSize: number, weight = "900") {
  let size = initialSize;
  do {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 8;
  } while (size > 40);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = w;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

/** Trigger a PNG download of the current canvas. */
export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Attempt the native share sheet with a PNG file; falls back to download. */
export async function shareCanvas(canvas: HTMLCanvasElement, filename: string, title: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  if (!blob) return;
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch {
      // fall through to download
    }
  }
  await downloadCanvas(canvas, filename);
}