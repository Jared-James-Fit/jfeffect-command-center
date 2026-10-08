import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Smile, Trash2, Type } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ensureDisplayFont } from "@/lib/workout-share-card";

/**
 * Instagram-style photo editing before a share: add text (4 styles, 5
 * colours) and stickers (LOCKED IN, the time, the date, JF EFFECT, the
 * workout, a couple of lines, emoji). Drag to move, pinch to resize and
 * rotate, drag onto the bin to delete, tap text to edit it. "Next" bakes
 * everything into the photo, so the feed, the cards and the Instagram story
 * all show it the same way.
 */

const REF = 1080;
/** Where new items land (fractions of the photo), so they don't stack. */
const SLOTS = [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.5, 0.18], [0.5, 0.84], [0.3, 0.42], [0.7, 0.58]] as const; // overlay sizes are designed against a 1080px-wide photo
const PX = 2; // bitmaps are rendered at 2x for sharp exports
const DISPLAY = `"Anton", "Impact", "Arial Narrow Bold", sans-serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif`;
const RED = "#ef3340";
export const TEXT_COLORS = ["#ffffff", "#000000", RED, "#facc15", "#22c55e"] as const;
export const TEXT_STYLES = ["Bold", "Box", "Display", "Outline"] as const;
const EMOJI = ["🔥", "💪", "🏋️", "⚡", "🎯", "😤", "🫡", "🏆"] as const;

export type DecorContext = { time: string; date: string; workoutTitle?: string | null };

type Item = {
  id: number;
  kind: "text" | "sticker";
  text?: string;
  style?: number;
  color?: string;
  sticker?: string;
  url: string;
  bw: number;
  bh: number;
  x: number;
  y: number;
  s: number;
  r: number;
};

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

/** Text in one of the styles, rendered to a bitmap. */
export function renderText(text: string, style: number, color: string): Bitmap {
  const lines = (text.trim() || " ").split(/\n/).slice(0, 6);
  const display = style === 2;
  const size = (display ? 104 : 68) * PX;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const f = display ? `400 ${size}px ${DISPLAY}` : `800 ${size}px ${SANS}`;
  ctx.font = f;
  const shown = display ? lines.map((l) => l.toUpperCase()) : lines;
  const lineH = size * (display ? 1.0 : 1.18);
  const padX = (style === 1 ? 34 : 18) * PX;
  const padY = (style === 1 ? 20 : 14) * PX;
  const w = Math.ceil(Math.max(...shown.map((l) => ctx.measureText(l).width)) + padX * 2);
  const h = Math.ceil(lineH * shown.length + padY * 2);
  c.width = Math.max(w, 2);
  c.height = Math.max(h, 2);
  ctx.font = f;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style === 1) {
    ctx.fillStyle = color;
    roundRect(ctx, 0, 0, c.width, c.height, 26 * PX);
    ctx.fill();
  }
  shown.forEach((l, i) => {
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

/** Bake the overlays into the photo. Longest side capped at 2048px. */
export async function composeDecorated(img: HTMLImageElement, items: Pick<Item, "url" | "bw" | "bh" | "x" | "y" | "s" | "r">[]): Promise<Blob | null> {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const k = Math.min(1, 2048 / Math.max(nw, nh));
  const W = Math.round(nw * k);
  const H = Math.round(nh * k);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  for (const it of items) {
    const bmp = await loadImage(it.url);
    if (!bmp) continue;
    const w = (it.bw / PX) * (W / REF) * it.s;
    const h = (it.bh / PX) * (W / REF) * it.s;
    ctx.save();
    ctx.translate(it.x * W, it.y * H);
    ctx.rotate(it.r);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}

export function PhotoDecorator({
  file,
  context,
  onBack,
  onDone,
}: {
  file: File | null;
  context: DecorContext;
  onBack: () => void;
  /** The photo to use: decorated, or the original when nothing was added. */
  onDone: (file: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [items, setItems] = useState<Item[]>([]);
  const [tray, setTray] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; text: string; style: number; color: string } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const nextId = useRef(1);
  const stickers = useMemo(() => stickerDefs(context), [context]);

  useEffect(() => {
    void ensureDisplayFont();
    void loadImage("/logo.png").then(setLogo);
  }, []);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let alive = true;
    void loadImage(url).then((i) => alive && setImg(i));
    setItems([]);
    return () => {
      alive = false;
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    };
  }, [file]);

  useEffect(() => {
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);

  // Where the photo sits inside the stage (object-contain).
  const rect = useMemo(() => {
    if (!img || !box.w || !box.h) return null;
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const k = Math.min(box.w / iw, box.h / ih);
    const w = iw * k;
    const h = ih * k;
    return { w, h, left: (box.w - w) / 2, top: (box.h - h) / 2 };
  }, [img, box]);

  const addSticker = (d: StickerDef) => {
    const b = d.render(logo);
    const id = nextId.current++;
    setItems((cur) => {
      const [x, y] = SLOTS[cur.length % SLOTS.length];
      return [...cur, { id, kind: "sticker", sticker: d.key, url: b.url, bw: b.bw, bh: b.bh, x, y, s: d.key.startsWith("emoji:") ? 0.9 : 1, r: 0 }];
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
      setItems((cur) => cur.map((i) => (i.id === editing.id ? { ...i, text, style: editing.style, color: editing.color, url: b.url, bw: b.bw, bh: b.bh } : i)));
    } else {
      const id = nextId.current++;
      setItems((cur) => {
        const [x, y] = SLOTS[cur.length % SLOTS.length];
        return [...cur, { id, kind: "text", text, style: editing.style, color: editing.color, url: b.url, bw: b.bw, bh: b.bh, x, y, s: 1, r: 0 }];
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
    if (!stage) return false;
    const b = stage.getBoundingClientRect();
    const tx = b.left + b.width / 2;
    const ty = b.bottom - 56;
    return Math.hypot(clientX - tx, clientY - ty) < 64;
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

  // Second finger anywhere on the photo pinches the item the first one holds.
  const onStageDown = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || st.pointers.size !== 1) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    addPointer(e, st.id);
  };

  const onMove = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !rect || !st.pointers.has(e.pointerId)) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...st.pointers.values()];
    let nx = st.start.x;
    let ny = st.start.y;
    let ns = st.start.s;
    let nr = st.start.r;
    if (pts.length >= 2 && st.pinch0) {
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      nx += (mid.x - st.p0.x) / rect.w;
      ny += (mid.y - st.p0.y) / rect.h;
      ns = Math.min(6, Math.max(0.25, st.start.s * (Math.hypot(b.x - a.x, b.y - a.y) / st.pinch0.d)));
      nr = st.start.r + (Math.atan2(b.y - a.y, b.x - a.x) - st.pinch0.a);
    } else {
      nx += (pts[0].x - st.p0.x) / rect.w;
      ny += (pts[0].y - st.p0.y) / rect.h;
    }
    if (Math.hypot(pts[0].x - st.p0.x, pts[0].y - st.p0.y) > 6) st.moved = true;
    setOverTrash(pts.length === 1 && trashHit(pts[0].x, pts[0].y));
    setItems((cur) => cur.map((i) => (i.id === st.id ? { ...i, x: nx, y: ny, s: ns, r: nr } : i)));
  };

  const onUp = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !st.pointers.has(e.pointerId)) return;
    st.pointers.delete(e.pointerId);
    if (st.pointers.size === 1) {
      // one finger left after a pinch: carry on dragging from here
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

  const fieldText = editing?.style === 2 ? "font-display text-[44px] uppercase leading-none" : "text-[30px] font-extrabold leading-tight";

  const next = async () => {
    if (!file || !img) return;
    if (!items.length) return onDone(file);
    setBusy(true);
    try {
      const blob = await composeDecorated(img, items);
      onDone(blob ? new File([blob], "jf-photo.jpg", { type: "image/jpeg" }) : file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onBack()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Edit photo</DialogTitle>
        <DialogDescription className="sr-only">Add text and stickers, then continue.</DialogDescription>

        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95" aria-label="Back to camera">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing({ id: null, text: "", style: 0, color: "#ffffff" })} className="grid h-11 w-11 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95" aria-label="Add text">
              <Type className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => setTray(true)} className="grid h-11 w-11 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95" aria-label="Add a sticker">
              <Smile className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div ref={setStage} className="relative min-h-0 flex-1 touch-none select-none" onPointerDown={onStageDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {img && rect && (
            <>
              <img src={img.src} alt="" className="pointer-events-none absolute rounded-2xl" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }} draggable={false} />
              {/* Not clipped, so a sticker can be dragged past the edge and back (the export crops it). */}
              <div className="absolute" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
                {items.map((it) => {
                  const w = (it.bw / PX) * (rect.w / REF) * it.s;
                  return (
                    <img
                      key={it.id}
                      src={it.url}
                      alt={it.text ?? it.sticker ?? ""}
                      draggable={false}
                      onPointerDown={(e) => onItemDown(e, it)}
                      className={cn("absolute max-w-none cursor-grab touch-none", dragging === it.id && overTrash && "opacity-50")}
                      style={{ left: it.x * rect.w, top: it.y * rect.h, width: w, transform: `translate(-50%, -50%) rotate(${it.r}rad)` }}
                    />
                  );
                })}
              </div>
            </>
          )}
          {dragging != null && (
            <div className={cn("pointer-events-none absolute bottom-6 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 transition-all", overTrash ? "scale-125 border-red-500 bg-red-500 text-white" : "border-white/70 bg-black/50 text-white")}>
              <Trash2 className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
          <span className="text-[12px] text-white/55">{items.length ? "Drag, pinch to resize, drop on the bin to delete" : "Add text or stickers, or keep it clean"}</span>
          <button type="button" disabled={busy || !img} onClick={() => void next()} className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-black text-black active:scale-95 disabled:opacity-60">
            {busy ? "…" : "Next"}
          </button>
        </div>

        {/* Text editor */}
        {editing && (
          <div className="absolute inset-0 z-30 flex flex-col bg-black/70 backdrop-blur-sm" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
            <div className="flex items-center justify-between px-3">
              <button
                type="button"
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
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <div
                className={cn("inline-grid max-w-full", editing.style === 1 && "rounded-2xl px-4 py-2")}
                style={editing.style === 1 ? { background: editing.color, color: readable(editing.color) } : { color: editing.color, WebkitTextStroke: editing.style === 3 ? "1.5px #000" : undefined }}
              >
                <span aria-hidden className={cn("invisible col-start-1 row-start-1 whitespace-pre-wrap break-words text-center", fieldText)}>
                  {(editing.text || "Type something") + " "}
                </span>
                <textarea
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, 120) })}
                  rows={1}
                  cols={1}
                  placeholder="Type something"
                  aria-label="Text"
                  // beats the global 16px input rule (iOS zoom guard); it's well over 16 anyway
                  style={{ fontSize: editing.style === 2 ? 44 : 30 }}
                  className={cn("col-start-1 row-start-1 h-full min-h-0 w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent p-0 text-center outline-none placeholder:text-current placeholder:opacity-40", fieldText)}
                />
              </div>
            </div>
            <div className="flex justify-center gap-3 pb-6" role="group" aria-label="Text colour">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
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
          <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/50" onClick={() => setTray(false)}>
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
      </DialogContent>
    </Dialog>
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
