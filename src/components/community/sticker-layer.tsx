import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Text and stickers, Instagram-style, placed right on the share card: text
 * (4 styles, 5 colours) and stickers (LOCKED IN, the time, the date, JF
 * EFFECT, the workout, a couple of lines, emoji). Drag to move, pinch to
 * resize and rotate (second finger anywhere), drop on the bin to delete, tap
 * text to edit it.
 *
 * Items live in card space (fractions of the 1080×1920 story card), so the
 * preview, the Instagram story (drawn on top of the card) and the community
 * photo (baked into the photo through the card's crop) all match.
 */

const REF = 1080; // card width; item sizes are designed against it
const CARD_H = 1920;
/** Where new items land (fractions of the card): the upper half, clear of the card's own text. */
const SLOTS = [[0.5, 0.36], [0.5, 0.24], [0.5, 0.48], [0.32, 0.3], [0.68, 0.42], [0.5, 0.14]] as const;
const PX = 2; // bitmaps are rendered at 2x for sharp exports
const DISPLAY = `"Anton", "Impact", "Arial Narrow Bold", sans-serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif`;
const RED = "#ef3340";
export const TEXT_COLORS = ["#ffffff", "#000000", RED, "#facc15", "#22c55e"] as const;
export const TEXT_STYLES = ["Bold", "Box", "Display", "Outline"] as const;
const EMOJI = ["🔥", "💪", "🏋️", "⚡", "🎯", "😤", "🫡", "🏆"] as const;

export type DecorContext = { time: string; date: string; workoutTitle?: string | null };

export type StickerItem = {
  id: number;
  kind: "text" | "sticker";
  text?: string;
  style?: number;
  color?: string;
  sticker?: string;
  /** The rendered bitmap (2x), drawn straight onto the card or photo. */
  canvas: HTMLCanvasElement;
  url: string;
  bw: number;
  bh: number;
  /** Centre, as fractions of the card. */
  x: number;
  y: number;
  s: number;
  r: number;
};
type Item = StickerItem;

type Bitmap = { url: string; bw: number; bh: number; canvas: HTMLCanvasElement };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function finish(c: HTMLCanvasElement): Bitmap {
  return { canvas: c, url: c.toDataURL("image/png"), bw: c.width, bh: c.height };
}

function readable(bg: string) {
  return bg === "#ffffff" || bg === "#facc15" || bg === "#22c55e" ? "#0a0a0a" : "#ffffff";
}

/** Longest text a text item takes (it wraps, so long notes are fine). */
export const TEXT_MAX = 400;
/** Text wraps at this width on the 1080px card, in the editor and on the card alike. */
const WRAP = 900;

/**
 * One set of metrics (card px) for each text style, used by both the canvas
 * bitmap and the live editor, so what you type is exactly what lands on the
 * card: same font, size, line height, padding and wrapping.
 */
export function textMetrics(style: number) {
  const display = style === 2;
  return {
    display,
    size: display ? 104 : 68,
    lineH: display ? 1.0 : 1.18,
    padX: style === 1 ? 34 : 18,
    padY: style === 1 ? 20 : 14,
    radius: 26,
    family: display ? DISPLAY : SANS,
    weight: display ? 400 : 800,
  };
}

/** Word-wrap like the browser does: on spaces, breaking words longer than a line. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= max) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line);
      // a single word wider than the line: break it by characters
      let w = word;
      while (ctx.measureText(w).width > max && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && ctx.measureText(w.slice(0, n)).width > max) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Text in one of the styles, rendered to a bitmap (2x), wrapped like the editor. */
export function renderText(text: string, style: number, color: string): Bitmap {
  const m = textMetrics(style);
  const size = m.size * PX;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const f = `${m.weight} ${size}px ${m.family}`;
  ctx.font = f;
  const raw = (text.replace(/\s+$/g, "") || " ").slice(0, TEXT_MAX);
  const lines = wrapText(ctx, m.display ? raw.toUpperCase() : raw, WRAP * PX).slice(0, 40);
  const lineH = size * m.lineH;
  const padX = m.padX * PX;
  const padY = m.padY * PX;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
  const h = Math.ceil(lineH * lines.length + padY * 2);
  c.width = Math.max(w, 2);
  c.height = Math.max(h, 2);
  ctx.font = f;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style === 1) {
    ctx.fillStyle = color;
    roundRect(ctx, 0, 0, c.width, c.height, m.radius * PX);
    ctx.fill();
  }
  lines.forEach((l, i) => {
    const y = padY + lineH * (i + 0.5);
    if (style === 3) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 9 * PX;
      ctx.strokeStyle = color === "#000000" ? "#ffffff" : "#000000";
      ctx.strokeText(l, c.width / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(l, c.width / 2, y);
    } else if (style === 1) {
      ctx.fillStyle = readable(color);
      ctx.fillText(l, c.width / 2, y);
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 14 * PX;
      ctx.shadowOffsetY = 3 * PX;
      ctx.fillStyle = color;
      ctx.fillText(l, c.width / 2, y);
      ctx.shadowColor = "transparent";
    }
  });
  return finish(c);
}

function pillSticker(text: string, opts: { bg: string; ink: string; display?: boolean; size?: number; icon?: (ctx: CanvasRenderingContext2D, x: number, cy: number, s: number) => number; logo?: HTMLImageElement | null; stroke?: string }) {
  const size = (opts.size ?? (opts.display ? 84 : 46)) * PX;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const f = opts.display ? `400 ${size}px ${DISPLAY}` : `900 ${size}px ${SANS}`;
  ctx.font = f;
  try {
    (ctx as any).letterSpacing = opts.display ? "0px" : `${3 * PX}px`;
  } catch {
    /* fine without tracking */
  }
  const tw = ctx.measureText(text).width;
  const iconW = opts.icon || opts.logo ? size * 1.15 : 0;
  const padX = size * 0.62;
  const h = Math.round(size * (opts.display ? 1.45 : 1.9));
  c.width = Math.ceil(tw + padX * 2 + iconW);
  c.height = h;
  ctx.font = f;
  try {
    (ctx as any).letterSpacing = opts.display ? "0px" : `${3 * PX}px`;
  } catch {
    /* fine */
  }
  if (opts.bg !== "transparent") {
    ctx.fillStyle = opts.bg;
    roundRect(ctx, 0, 0, c.width, h, h / 2);
    ctx.fill();
  }
  let x = padX;
  if (opts.logo) {
    const s = size * 0.95;
    ctx.save();
    roundRect(ctx, x, (h - s) / 2, s, s, s * 0.22);
    ctx.clip();
    ctx.drawImage(opts.logo, x, (h - s) / 2, s, s);
    ctx.restore();
    x += iconW;
  } else if (opts.icon) x += opts.icon(ctx, x, h / 2, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (opts.stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 8 * PX;
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, h / 2 + size * 0.04);
  }
  ctx.fillStyle = opts.ink;
  ctx.fillText(text, x, h / 2 + size * 0.04);
  return finish(c);
}

function clockIcon(ctx: CanvasRenderingContext2D, x: number, cy: number, s: number) {
  const r = s * 0.42;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.arc(x + r, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r, cy);
  ctx.lineTo(x + r, cy - r * 0.6);
  ctx.moveTo(x + r, cy);
  ctx.lineTo(x + r + r * 0.45, cy + r * 0.2);
  ctx.stroke();
  ctx.restore();
  return s * 1.15;
}

function emojiSticker(e: string): Bitmap {
  const size = 150 * PX;
  const c = document.createElement("canvas");
  c.width = Math.round(size * 1.25);
  c.height = Math.round(size * 1.25);
  const ctx = c.getContext("2d")!;
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(e, c.width / 2, c.height / 2 + size * 0.06);
  return finish(c);
}

export type StickerDef = { key: string; label: string; render: (logo: HTMLImageElement | null) => Bitmap };

/** The sticker tray, built from what's true right now. */
export function stickerDefs(ctx: DecorContext): StickerDef[] {
  const defs: StickerDef[] = [
    { key: "lockedin", label: "LOCKED IN", render: () => pillSticker("LOCKED IN", { bg: RED, ink: "#ffffff", display: true }) },
    { key: "time", label: ctx.time, render: () => pillSticker(ctx.time.toUpperCase(), { bg: "rgba(10,10,13,0.72)", ink: "#ffffff", icon: clockIcon }) },
    { key: "date", label: ctx.date, render: () => pillSticker(ctx.date.toUpperCase(), { bg: "#ffffff", ink: "#0a0a0a" }) },
    { key: "jf", label: "JF EFFECT", render: (logo) => pillSticker("JF EFFECT", { bg: "#0a0a0d", ink: "#ffffff", logo }) },
  ];
  if (ctx.workoutTitle) defs.push({ key: "workout", label: ctx.workoutTitle, render: () => pillSticker(ctx.workoutTitle!.toUpperCase().slice(0, 32), { bg: "rgba(255,255,255,0.92)", ink: "#0a0a0a" }) });
  defs.push(
    { key: "letsgo", label: "LET'S GO", render: () => pillSticker("LET'S GO", { bg: "transparent", ink: "#facc15", display: true, size: 120, stroke: "#0a0a0a" }) },
    { key: "nodaysoff", label: "NO DAYS OFF", render: () => pillSticker("NO DAYS OFF", { bg: "#ffffff", ink: RED, display: true, size: 70 }) },
    ...EMOJI.map((e) => ({ key: `emoji:${e}`, label: e, render: () => emojiSticker(e) })),
  );
  return defs;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draw the items on a card-sized context (W×H = the card). */
export function drawStickers(ctx: CanvasRenderingContext2D, items: StickerItem[], W = REF, H = CARD_H) {
  for (const it of items) {
    const w = (it.bw / PX) * (W / REF) * it.s;
    const h = (it.bh / PX) * (W / REF) * it.s;
    ctx.save();
    ctx.translate(it.x * W, it.y * H);
    ctx.rotate(it.r);
    ctx.drawImage(it.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/**
 * Bake card-space items into the photo itself (for the community post), via
 * the same cover crop the card uses. Longest side capped at 2048px.
 */
export function bakeStickers(src: CanvasImageSource & { width?: number; height?: number }, items: StickerItem[]): Promise<Blob | null> {
  const any = src as unknown as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const nw = any.naturalWidth || any.width || 1;
  const nh = any.naturalHeight || any.height || 1;
  const k = Math.min(1, 2048 / Math.max(nw, nh));
  const W = Math.round(nw * k);
  const H = Math.round(nh * k);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);
  // card → photo: the card shows the photo cover-cropped to 1080×1920
  const s = Math.max(REF / W, CARD_H / H);
  const ox = (REF - W * s) / 2;
  const oy = (CARD_H - H * s) / 2;
  for (const it of items) {
    const w = ((it.bw / PX) * it.s) / s;
    const h = ((it.bh / PX) * it.s) / s;
    ctx.save();
    ctx.translate((it.x * REF - ox) / s, (it.y * CARD_H - oy) / s);
    ctx.rotate(it.r);
    ctx.drawImage(it.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}

export type StickerRequest = { kind: "text" | "stickers"; n: number } | null;

/**
 * The editable layer over the card. The parent sizes it to the card (absolute
 * inset-0 inside the card box) and opens the text editor / tray via `request`.
 */
export function StickerLayer({
  items,
  setItems,
  width,
  height,
  context,
  request,
}: {
  items: StickerItem[];
  setItems: React.Dispatch<React.SetStateAction<StickerItem[]>>;
  /** On-screen size of the card. */
  width: number;
  height: number;
  context: DecorContext;
  request: StickerRequest;
}) {
  const [tray, setTray] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; text: string; style: number; color: string } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const stickers = useMemo(() => stickerDefs(context), [context]);

  useEffect(() => {
    void loadImage("/logo.png").then(setLogo);
  }, []);
  useEffect(() => {
    if (!request) return;
    if (request.kind === "text") setEditing({ id: null, text: "", style: 0, color: "#ffffff" });
    else setTray(true);
  }, [request]);

  const place = (cur: Item[]) => SLOTS[cur.length % SLOTS.length];
  const addSticker = (d: StickerDef) => {
    const b = d.render(logo);
    const id = nextId.current++;
    setItems((cur) => {
      const [x, y] = place(cur);
      return [...cur, { id, kind: "sticker", sticker: d.key, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, x, y, s: d.key.startsWith("emoji:") ? 0.9 : 1, r: 0 }];
    });
    setTray(false);
  };

  const saveText = () => {
    if (!editing) return;
    const text = editing.text.replace(/\s+$/g, "");
    if (!text.trim()) {
      if (editing.id != null) setItems((cur) => cur.filter((i) => i.id !== editing.id));
      setEditing(null);
      return;
    }
    const b = renderText(text, editing.style, editing.color);
    if (editing.id != null) {
      setItems((cur) => cur.map((i) => (i.id === editing.id ? { ...i, text, style: editing.style, color: editing.color, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh } : i)));
    } else {
      const id = nextId.current++;
      setItems((cur) => {
        const [x, y] = place(cur);
        return [...cur, { id, kind: "text", text, style: editing.style, color: editing.color, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, x, y, s: 1, r: 0 }];
      });
    }
    setEditing(null);
  };

  // ---- gestures: one finger drags, two pinch + rotate, drop on the bin deletes
  const g = useRef<{
    id: number;
    pointers: Map<number, { x: number; y: number }>;
    start: { x: number; y: number; s: number; r: number };
    p0: { x: number; y: number };
    pinch0?: { d: number; a: number };
    moved: boolean;
    t0: number;
  } | null>(null);

  const trashHit = (clientX: number, clientY: number) => {
    const b = root.current?.getBoundingClientRect();
    if (!b) return false;
    return Math.hypot(clientX - (b.left + b.width / 2), clientY - (b.bottom - 52)) < 60;
  };

  const addPointer = (e: React.PointerEvent, id: number) => {
    const st = g.current!;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()];
      const cur = items.find((i) => i.id === id)!;
      st.start = { x: cur.x, y: cur.y, s: cur.s, r: cur.r };
      st.p0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      st.pinch0 = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) };
      st.moved = true;
    }
  };

  const onItemDown = (e: React.PointerEvent, it: Item) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!g.current || g.current.id !== it.id) {
      g.current = { id: it.id, pointers: new Map(), start: { x: it.x, y: it.y, s: it.s, r: it.r }, p0: { x: e.clientX, y: e.clientY }, moved: false, t0: Date.now() };
    }
    addPointer(e, it.id);
    setDragging(it.id);
  };

  // While an item is held, the layer takes the whole card, so a second finger
  // anywhere pinches it (and the card underneath doesn't swipe).
  const onRootDown = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || st.pointers.size !== 1) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    addPointer(e, st.id);
  };

  const onMove = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !st.pointers.has(e.pointerId) || !width || !height) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...st.pointers.values()];
    let nx = st.start.x;
    let ny = st.start.y;
    let ns = st.start.s;
    let nr = st.start.r;
    if (pts.length >= 2 && st.pinch0) {
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      nx += (mid.x - st.p0.x) / width;
      ny += (mid.y - st.p0.y) / height;
      ns = Math.min(6, Math.max(0.25, st.start.s * (Math.hypot(b.x - a.x, b.y - a.y) / st.pinch0.d)));
      nr = st.start.r + (Math.atan2(b.y - a.y, b.x - a.x) - st.pinch0.a);
    } else {
      nx += (pts[0].x - st.p0.x) / width;
      ny += (pts[0].y - st.p0.y) / height;
    }
    if (Math.hypot(pts[0].x - st.p0.x, pts[0].y - st.p0.y) > 6) st.moved = true;
    setOverTrash(pts.length === 1 && trashHit(pts[0].x, pts[0].y));
    setItems((cur) => cur.map((i) => (i.id === st.id ? { ...i, x: nx, y: ny, s: ns, r: nr } : i)));
  };

  const onUp = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !st.pointers.has(e.pointerId)) return;
    e.stopPropagation();
    st.pointers.delete(e.pointerId);
    if (st.pointers.size === 1) {
      const [p] = [...st.pointers.values()];
      const cur = items.find((i) => i.id === st.id);
      if (cur) {
        st.start = { x: cur.x, y: cur.y, s: cur.s, r: cur.r };
        st.p0 = { x: p.x, y: p.y };
        st.pinch0 = undefined;
      }
      return;
    }
    if (st.pointers.size === 0) {
      const it = items.find((i) => i.id === st.id);
      if (trashHit(e.clientX, e.clientY)) setItems((cur) => cur.filter((i) => i.id !== st.id));
      else if (!st.moved && Date.now() - st.t0 < 300 && it?.kind === "text") setEditing({ id: it.id, text: it.text ?? "", style: it.style ?? 0, color: it.color ?? "#ffffff" });
      g.current = null;
      setDragging(null);
      setOverTrash(false);
    }
  };

  const k = width / REF;

  return (
    <>
      <div
        ref={root}
        className={cn("absolute inset-0 touch-none", dragging == null && "pointer-events-none")}
        onPointerDown={onRootDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {items.map((it) => (
          <img
            key={it.id}
            src={it.url}
            alt={it.text ?? it.sticker ?? ""}
            draggable={false}
            onPointerDown={(e) => onItemDown(e, it)}
            className={cn("pointer-events-auto absolute max-w-none cursor-grab touch-none select-none", dragging === it.id && overTrash && "opacity-50")}
            style={{ left: it.x * width, top: it.y * height, width: (it.bw / PX) * k * it.s, transform: `translate(-50%, -50%) rotate(${it.r}rad)` }}
          />
        ))}
        {dragging != null && (
          <div className={cn("pointer-events-none absolute bottom-6 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 transition-all", overTrash ? "scale-125 border-red-500 bg-red-500 text-white" : "border-white/70 bg-black/50 text-white")}>
            <Trash2 className="h-6 w-6" />
          </div>
        )}
      </div>

      {/* Text editor — over the whole screen (fixed inside the dialog) */}
      {editing && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/70 text-white backdrop-blur-sm" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <div className="flex items-center justify-between px-3">
            <button
              type="button"
              // keep the keyboard up: don't take focus from the text
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing({ ...editing, style: (editing.style + 1) % TEXT_STYLES.length })}
              className="h-10 rounded-full bg-white/15 px-4 text-[13px] font-black"
              aria-label="Text style"
            >
              Aa · {TEXT_STYLES[editing.style]}
            </button>
            <button type="button" onClick={saveText} className="inline-flex h-10 items-center gap-1 rounded-full bg-white px-4 text-[14px] font-black text-black">
              <Check className="h-4 w-4" /> Done
            </button>
          </div>
          {/* True size: the card's scale, font, padding and wrap width, so it looks
              exactly like it will on the card while you type. */}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-3 py-4">
            {(() => {
              const m = textMetrics(editing.style);
              const font = { fontFamily: m.family, fontWeight: m.weight, fontSize: m.size * k, lineHeight: m.lineH, textTransform: m.display ? ("uppercase" as const) : undefined };
              const look =
                editing.style === 1
                  ? { background: editing.color, color: readable(editing.color), borderRadius: m.radius * k }
                  : editing.style === 3
                    ? { color: editing.color, WebkitTextStroke: `${9 * k}px ${editing.color === "#000000" ? "#fff" : "#000"}`, paintOrder: "stroke fill" as const }
                    : { color: editing.color, textShadow: `0 ${3 * k}px ${14 * k}px rgba(0,0,0,0.45)` };
              return (
                <div className="inline-grid" style={{ ...look, maxWidth: (WRAP + m.padX * 2) * k, padding: `${m.padY * k}px ${m.padX * k}px` }}>
                  <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre-wrap text-center [overflow-wrap:anywhere]" style={font}>
                    {(editing.text || "Type something") + " "}
                  </span>
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, TEXT_MAX) })}
                    maxLength={TEXT_MAX}
                    rows={1}
                    cols={1}
                    placeholder="Type something"
                    aria-label="Text"
                    // inline font beats the global 16px input rule (iOS zoom guard)
                    style={{ ...font, color: "inherit" }}
                    className="col-start-1 row-start-1 h-full min-h-0 w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 text-center outline-none [overflow-wrap:anywhere] placeholder:text-current placeholder:opacity-40"
                  />
                </div>
              );
            })()}
          </div>
          {editing.text.length > TEXT_MAX - 60 && <div className="pb-2 text-center text-[11px] tabular-nums text-white/55">{editing.text.length}/{TEXT_MAX}</div>}
          <div className="flex justify-center gap-3 pb-6" role="group" aria-label="Text colour">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditing({ ...editing, color: c })}
                className={cn("h-9 w-9 rounded-full border-2", editing.color === c ? "scale-110 border-white" : "border-white/40")}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sticker tray */}
      {tray && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/50 text-white" onClick={() => setTray(false)}>
          <div className="max-h-[62%] overflow-y-auto rounded-t-[24px] bg-[#16161a] p-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="grid grid-cols-2 gap-2.5">
              {stickers
                .filter((s) => !s.key.startsWith("emoji:"))
                .map((s) => (
                  <StickerButton key={s.key} def={s} logo={logo} onPick={() => addSticker(s)} />
                ))}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2.5">
              {stickers
                .filter((s) => s.key.startsWith("emoji:"))
                .map((s) => (
                  <button key={s.key} type="button" onClick={() => addSticker(s)} className="grid h-16 place-items-center rounded-2xl bg-white/[0.06] text-[34px] active:scale-95" aria-label={`Sticker ${s.label}`}>
                    {s.label}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StickerButton({ def, logo, onPick }: { def: StickerDef; logo: HTMLImageElement | null; onPick: () => void }) {
  const url = useMemo(() => def.render(logo).url, [def, logo]);
  return (
    <button type="button" onClick={onPick} className="grid h-20 place-items-center rounded-2xl bg-white/[0.06] px-3 active:scale-95" aria-label={`Sticker ${def.label}`}>
      <img src={url} alt="" className="max-h-12 max-w-full object-contain" />
    </button>
  );
}
